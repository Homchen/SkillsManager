package translator

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"SkillsManager/internal/applog"
)

const (
	EngineMicrosoftAndroid = "microsoft_android" // no user key: Android client HMAC signature
	EngineMicrosoft        = "microsoft"         // Azure Translator subscription key
	EngineOpenAICompatible = "openai_compatible"
	apiHost                = "api.cognitive.microsofttranslator.com"
	clientName             = "MSTranslatorAndroidApp"

	openaiRateLimitAttempts = 5
	openaiDefaultRetryAfter = 2 * time.Second
	openaiMaxRetryAfter     = 60 * time.Second
	openaiDocumentTimeout   = 3 * time.Minute
	openaiTimeoutMessage    = "OpenAI 兼容翻译请求超时，请稍后重试或换更快的模型"
)

// Space OpenAI-compatible calls so SKILL.md's description+body pair (and the
// following document files) do not immediately trip a 1–2 req/s gateway limit.
var openaiMinInterval = time.Second

var openaiLimiter struct {
	mu   sync.Mutex
	next time.Time
}

	type Config struct {
		Engine                    string
		TargetLanguage            string
		MicrosoftTranslatorKey    string
		MicrosoftTranslatorRegion string
		OpenAIBaseURL             string
		OpenAIAPIKey              string
		OpenAIModel               string
		OpenAITemperature         float64
	}

// Embedded Android app signing key used by the no-subscription Microsoft path
// (MSTranslatorAndroidApp HMAC for X-MT-Signature).
var androidPrivateKey = []byte{
	0xa2, 0x29, 0x3a, 0x3d, 0xd0, 0xdd, 0x32, 0x73, 0x97, 0x7a, 0x64, 0xdb,
	0xc2, 0xf3, 0x27, 0xf5, 0xd7, 0xbf, 0x87, 0xd9, 0x45, 0x9d, 0xf0, 0x5a,
	0x09, 0x66, 0xc6, 0x30, 0xc6, 0x6a, 0xaa, 0x84, 0x9a, 0x41, 0xaa, 0x94,
	0x3a, 0xa8, 0xd5, 0x1a, 0x6e, 0x4d, 0xaa, 0xc9, 0xa3, 0x70, 0x12, 0x35,
	0xc7, 0xeb, 0x12, 0xf6, 0xe8, 0x23, 0x07, 0x9e, 0x47, 0x10, 0x95, 0x91,
	0x88, 0x55, 0xd8, 0x17,
}

// Translate sends text to the configured translation engine. Source language is
// detected by the engine automatically.
func Translate(ctx context.Context, cfg Config, text string) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", errors.New("没有可翻译的 description")
	}
	if strings.TrimSpace(cfg.TargetLanguage) == "" {
		return "", errors.New("未设置目标语言")
	}
	switch strings.TrimSpace(cfg.Engine) {
	case "", EngineMicrosoftAndroid:
		return translateMicrosoftAndroid(ctx, text, cfg.TargetLanguage)
	case EngineMicrosoft:
		return translateMicrosoftAzure(ctx, cfg, text)
	case EngineOpenAICompatible:
		return translateOpenAICompatible(ctx, cfg, text, fmt.Sprintf(
			"Translate the user's skill description into %s. Return only the translation. Preserve technical identifiers and Markdown formatting.",
			cfg.TargetLanguage,
		), 20*time.Second)
	default:
		return "", fmt.Errorf("不支持的翻译引擎：%s", cfg.Engine)
	}
}

// TranslateSkillDocument translates a protected documentation fragment. Full
// skill translation deliberately requires an instruction-following model: the
// Microsoft engine only accepts plain translation text and cannot honor the
// preservation constraints.
func TranslateSkillDocument(ctx context.Context, cfg Config, text, instruction string) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", errors.New("没有可翻译的文本")
	}
	if strings.TrimSpace(cfg.TargetLanguage) == "" {
		return "", errors.New("未设置目标语言")
	}
	if cfg.Engine != EngineOpenAICompatible {
		return "", errors.New("完整 skill 翻译仅支持 OpenAI 兼容引擎")
	}
	// Document chunks can be large. DeepSeek V4 thinking (on by default) keeps
	// the HTTP body open until reasoning finishes; 90s was not enough.
	return translateOpenAICompatible(ctx, cfg, text, instruction, openaiDocumentTimeout)
}

func translateMicrosoftAndroid(ctx context.Context, text, targetLanguage string) (string, error) {
	requestURL, body, err := microsoftTranslateRequest(text, targetLanguage)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		result, retry, err := requestMicrosoftAndroid(ctx, client, requestURL, body)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retry || attempt == 2 {
			return "", err
		}
		delay := time.Duration(attempt+1) * 500 * time.Millisecond
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(delay):
		}
	}
	return "", lastErr
}

func translateMicrosoftAzure(ctx context.Context, cfg Config, text string) (string, error) {
	key := strings.TrimSpace(cfg.MicrosoftTranslatorKey)
	if key == "" {
		return "", errors.New("请在设置中填写微软翻译 Subscription Key（Azure Translator）")
	}
	requestURL, body, err := microsoftTranslateRequest(text, cfg.TargetLanguage)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		result, retry, err := requestMicrosoftAzure(
			ctx,
			client,
			requestURL,
			body,
			key,
			strings.TrimSpace(cfg.MicrosoftTranslatorRegion),
		)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retry || attempt == 2 {
			return "", err
		}
		delay := time.Duration(attempt+1) * 500 * time.Millisecond
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(delay):
		}
	}
	return "", lastErr
}

func microsoftTranslateRequest(text, targetLanguage string) (*url.URL, []byte, error) {
	query := url.Values{
		"api-version": {"3.0"},
		"to":          {targetLanguage},
	}.Encode()
	requestURL := &url.URL{
		Scheme:   "https",
		Host:     apiHost,
		Path:     "/translate",
		RawQuery: query,
	}
	body, err := json.Marshal([]map[string]string{{"Text": text}})
	if err != nil {
		return nil, nil, fmt.Errorf("编码翻译请求失败：%w", err)
	}
	return requestURL, body, nil
}

func requestMicrosoftAndroid(
	ctx context.Context,
	client *http.Client,
	requestURL *url.URL,
	body []byte,
) (translation string, retry bool, err error) {
	signature, err := microsoftSignature(apiHost+requestURL.RequestURI(), time.Now().UTC())
	if err != nil {
		return "", false, fmt.Errorf("生成微软翻译签名失败：%w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), strings.NewReader(string(body)))
	if err != nil {
		return "", false, fmt.Errorf("创建翻译请求失败：%w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", clientName+"/1.0")
	req.Header.Set("X-MT-Signature", signature)
	return readMicrosoftTranslationResponse(ctx, client, req, "内置签名凭证可能已失效")
}

func requestMicrosoftAzure(
	ctx context.Context,
	client *http.Client,
	requestURL *url.URL,
	body []byte,
	subscriptionKey string,
	region string,
) (translation string, retry bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), strings.NewReader(string(body)))
	if err != nil {
		return "", false, fmt.Errorf("创建翻译请求失败：%w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Ocp-Apim-Subscription-Key", subscriptionKey)
	if region != "" {
		req.Header.Set("Ocp-Apim-Subscription-Region", region)
	}
	return readMicrosoftTranslationResponse(ctx, client, req, "请检查 Subscription Key 与区域")
}

func readMicrosoftTranslationResponse(
	ctx context.Context,
	client *http.Client,
	req *http.Request,
	authHint string,
) (translation string, retry bool, err error) {
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", false, ctx.Err()
		}
		return "", true, fmt.Errorf("请求微软翻译服务失败：%w", err)
	}
	defer resp.Body.Close()

	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if readErr != nil {
		return "", resp.StatusCode >= http.StatusInternalServerError, fmt.Errorf("读取翻译响应失败：%w", readErr)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		var result []struct {
			Translations []struct {
				Text string `json:"text"`
			} `json:"translations"`
		}
		if err := json.Unmarshal(responseBody, &result); err != nil {
			return "", false, fmt.Errorf("解析翻译响应失败：%w", err)
		}
		if len(result) == 0 || len(result[0].Translations) == 0 || result[0].Translations[0].Text == "" {
			return "", false, errors.New("微软翻译未返回译文")
		}
		return result[0].Translations[0].Text, false, nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return "", false, fmt.Errorf("微软翻译认证失败：%s", authHint)
	case http.StatusTooManyRequests:
		applog.WarnContext(ctx, "microsoft rate limited", "httpStatus", http.StatusTooManyRequests)
		return "", true, errors.New("微软翻译请求过于频繁，请稍后重试")
	default:
		detail := strings.TrimSpace(string(responseBody))
		if len(detail) > 500 {
			detail = detail[:500]
		}
		if detail == "" {
			detail = resp.Status
		}
		return "", resp.StatusCode >= http.StatusInternalServerError,
			fmt.Errorf("微软翻译失败（HTTP %d）：%s", resp.StatusCode, detail)
	}
}

func microsoftSignature(requestURI string, now time.Time) (string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	guid := hex.EncodeToString(random[:])
	dateTime := now.UTC().Format(http.TimeFormat)
	escapedURL := url.QueryEscape(requestURI)
	payload := strings.ToLower(clientName + escapedURL + dateTime + guid)

	mac := hmac.New(sha256.New, androidPrivateKey)
	_, _ = mac.Write([]byte(payload))
	digest := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("%s::%s::%s::%s", clientName, digest, dateTime, guid), nil
}

func translateOpenAICompatible(ctx context.Context, cfg Config, text, instruction string, timeout time.Duration) (string, error) {
	if strings.TrimSpace(cfg.OpenAIAPIKey) == "" {
		return "", errors.New("请在设置中填写 OpenAI 兼容接口的 API Key")
	}
	if strings.TrimSpace(cfg.OpenAIModel) == "" {
		return "", errors.New("请在设置中填写 OpenAI 兼容接口的模型名称")
	}
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	requestURL, err := chatCompletionsURL(cfg.OpenAIBaseURL)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(struct {
		Model       string          `json:"model"`
		Temperature float64         `json:"temperature"`
		Stream      bool            `json:"stream"`
		Thinking    *openaiThinking `json:"thinking,omitempty"`
		Messages    []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}{
		Model:       strings.TrimSpace(cfg.OpenAIModel),
		Temperature: openAITemperature(cfg.OpenAITemperature),
		Stream:      false,
		Thinking:    thinkingOff(requestURL.Hostname(), cfg.OpenAIModel),
		Messages: []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{
			{
				Role:    "system",
				Content: instruction,
			},
			{Role: "user", Content: text},
		},
	})
	if err != nil {
		return "", fmt.Errorf("编码 OpenAI 翻译请求失败：%w", err)
	}

	client := openaiHTTPClient(timeout)
	var lastErr error
	for attempt := 0; attempt < openaiRateLimitAttempts; attempt++ {
		if err := takeOpenAISlot(ctx); err != nil {
			return "", err
		}
		applog.DebugContext(ctx, "openai request",
			"kind", instructionKind(instruction),
			"chars", utf8.RuneCountInString(text),
			"model", strings.TrimSpace(cfg.OpenAIModel),
			"attempt", attempt+1,
		)
		result, retry, retryAfter, err := requestOpenAITranslation(
			ctx,
			client,
			requestURL,
			body,
			strings.TrimSpace(cfg.OpenAIAPIKey),
		)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retry || attempt == openaiRateLimitAttempts-1 {
			return "", err
		}
		delay := time.Duration(attempt+1) * 500 * time.Millisecond
		if retryAfter > 0 {
			delay = retryAfter
			if floor := openaiDefaultRetryAfter << attempt; delay < floor {
				delay = floor
			}
			if delay > openaiMaxRetryAfter {
				delay = openaiMaxRetryAfter
			}
		}
		postponeOpenAISlot(delay)
	}
	return "", lastErr
}

func takeOpenAISlot(ctx context.Context) error {
	openaiLimiter.mu.Lock()
	wait := time.Until(openaiLimiter.next)
	if wait < 0 {
		wait = 0
	}
	interval := openaiMinInterval
	if interval < 0 {
		interval = 0
	}
	openaiLimiter.next = time.Now().Add(wait + interval)
	openaiLimiter.mu.Unlock()
	if wait == 0 {
		return nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func postponeOpenAISlot(d time.Duration) {
	if d <= 0 {
		return
	}
	if d > openaiMaxRetryAfter {
		d = openaiMaxRetryAfter
	}
	until := time.Now().Add(d)
	openaiLimiter.mu.Lock()
	if until.After(openaiLimiter.next) {
		openaiLimiter.next = until
	}
	openaiLimiter.mu.Unlock()
}

func parseRetryAfter(header string, fallback time.Duration) time.Duration {
	header = strings.TrimSpace(header)
	if header == "" {
		return fallback
	}
	if secs, err := strconv.Atoi(header); err == nil {
		if secs <= 0 {
			return fallback
		}
		d := time.Duration(secs) * time.Second
		if d > openaiMaxRetryAfter {
			return openaiMaxRetryAfter
		}
		return d
	}
	when, err := http.ParseTime(header)
	if err != nil {
		return fallback
	}
	d := time.Until(when)
	if d <= 0 {
		return fallback
	}
	if d > openaiMaxRetryAfter {
		return openaiMaxRetryAfter
	}
	return d
}

func chatCompletionsURL(baseURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("OpenAI 兼容接口地址无效")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("OpenAI 兼容接口地址必须使用 HTTP 或 HTTPS")
	}
	if parsed.User != nil {
		return nil, errors.New("OpenAI 兼容接口地址不能包含用户名或密码")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" || isBlockedOpenAIHost(host) {
		return nil, errors.New("OpenAI 兼容接口地址主机不被允许")
	}
	if ip := net.ParseIP(host); ip != nil && isBlockedOpenAIIP(ip) {
		return nil, errors.New("OpenAI 兼容接口地址指向受限网络地址")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if !strings.HasSuffix(parsed.Path, "/chat/completions") {
		parsed.Path += "/chat/completions"
	}
	return parsed, nil
}

func openaiHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			if err := assertOpenAIDialHost(ctx, host); err != nil {
				return nil, err
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(host, port))
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("OpenAI 兼容接口重定向次数过多")
			}
			if err := assertOpenAIRequestURL(req.URL); err != nil {
				return err
			}
			if len(via) > 0 && !sameHTTPHost(via[0].URL, req.URL) {
				req.Header.Del("Authorization")
			}
			return nil
		},
	}
}

func assertOpenAIRequestURL(u *url.URL) error {
	if u == nil {
		return errors.New("OpenAI 兼容接口地址无效")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || isBlockedOpenAIHost(host) {
		return errors.New("OpenAI 兼容接口重定向到了受限主机")
	}
	if ip := net.ParseIP(host); ip != nil && isBlockedOpenAIIP(ip) {
		return errors.New("OpenAI 兼容接口重定向到了受限网络地址")
	}
	return nil
}

func assertOpenAIDialHost(ctx context.Context, host string) error {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" || isBlockedOpenAIHost(host) {
		return errors.New("OpenAI 兼容接口地址主机不被允许")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedOpenAIIP(ip) {
			return errors.New("OpenAI 兼容接口地址指向受限网络地址")
		}
		return nil
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("解析 OpenAI 兼容接口地址失败：%w", err)
	}
	if len(ips) == 0 {
		return errors.New("OpenAI 兼容接口地址无法解析")
	}
	for _, addr := range ips {
		if isBlockedOpenAIIP(addr.IP) {
			return errors.New("OpenAI 兼容接口地址解析到了受限网络地址")
		}
	}
	return nil
}

func isBlockedOpenAIHost(host string) bool {
	switch host {
	case "metadata.google.internal",
		"metadata.goog",
		"metadata",
		"kubernetes.default",
		"kubernetes.default.svc":
		return true
	default:
		return false
	}
}

func isBlockedOpenAIIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	// Cloud metadata / link-local; loopback and private LAN remain allowed for local models.
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		// 169.254.169.254 and the rest of link-local are covered above; also block CGNAT docs range abuse of metadata-style.
		if ip4[0] == 169 && ip4[1] == 254 {
			return true
		}
	}
	return false
}

func sameHTTPHost(a, b *url.URL) bool {
	if a == nil || b == nil {
		return false
	}
	return strings.EqualFold(a.Hostname(), b.Hostname()) && a.Port() == b.Port()
}

func requestOpenAITranslation(
	ctx context.Context,
	client *http.Client,
	requestURL *url.URL,
	body []byte,
	apiKey string,
) (translation string, retry bool, retryAfter time.Duration, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), strings.NewReader(string(body)))
	if err != nil {
		return "", false, 0, fmt.Errorf("创建 OpenAI 翻译请求失败：%w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	started := time.Now()
	resp, err := client.Do(req)
	durationMs := time.Since(started).Milliseconds()
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			return "", false, 0, context.Canceled
		}
		applog.WarnContext(ctx, "openai http error", "err", err, "durationMs", durationMs)
		if isHTTPTimeout(ctx, err) {
			return "", true, 0, errors.New(openaiTimeoutMessage)
		}
		return "", true, 0, fmt.Errorf("请求 OpenAI 兼容翻译服务失败：%w", err)
	}
	defer resp.Body.Close()

	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	durationMs = time.Since(started).Milliseconds()
	if readErr != nil {
		applog.WarnContext(ctx, "openai response read error",
			"err", readErr,
			"status", resp.StatusCode,
			"durationMs", durationMs,
			"host", requestURL.Hostname(),
			"contentType", resp.Header.Get("Content-Type"),
		)
		if isHTTPTimeout(ctx, readErr) {
			return "", false, 0, errors.New(openaiTimeoutMessage)
		}
		return "", resp.StatusCode >= http.StatusInternalServerError, 0, fmt.Errorf("读取 OpenAI 翻译响应失败：%w", readErr)
	}
	applog.DebugContext(ctx, "openai http",
		"status", resp.StatusCode,
		"durationMs", durationMs,
		"host", requestURL.Hostname(),
		"bytes", len(responseBody),
	)
	switch resp.StatusCode {
	case http.StatusOK:
		var result struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(responseBody, &result); err != nil {
			return "", false, 0, fmt.Errorf("解析 OpenAI 翻译响应失败：%w", err)
		}
		if len(result.Choices) == 0 {
			return "", false, 0, errors.New("OpenAI 兼容翻译未返回译文")
		}
		// Trim space/tab padding from model output, but keep newlines so chunk
		// boundaries (blank lines) survive reassembly.
		content := strings.Trim(result.Choices[0].Message.Content, " \t")
		if strings.TrimSpace(content) == "" {
			return "", false, 0, errors.New("OpenAI 兼容翻译未返回译文")
		}
		return content, false, 0, nil
	case http.StatusUnauthorized:
		return "", false, 0, errors.New("OpenAI 兼容接口认证失败：请检查 API Key")
	case http.StatusTooManyRequests:
		retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"), openaiDefaultRetryAfter)
		applog.WarnContext(ctx, "openai rate limited",
			"httpStatus", http.StatusTooManyRequests,
			"retryAfterMs", retryAfter.Milliseconds(),
			"durationMs", durationMs,
			"detail", httpResponseDetail(responseBody, ""),
		)
		return "", true, retryAfter, errors.New("OpenAI 兼容接口请求过于频繁，请稍后重试")
	default:
		detail := httpResponseDetail(responseBody, resp.Status)
		return "", resp.StatusCode >= http.StatusInternalServerError, 0,
			fmt.Errorf("OpenAI 兼容翻译失败（HTTP %d）：%s", resp.StatusCode, detail)
	}
}

type openaiThinking struct {
	Type string `json:"type"`
}

func thinkingOff(host, model string) *openaiThinking {
	if !disableOpenAIThinking(host, model) {
		return nil
	}
	return &openaiThinking{Type: "disabled"}
}

// openAITemperature clamps to the [0, 1] range used by AI translation settings.
// Invalid values fall back to 0.2 (same default as settings).
func openAITemperature(v float64) float64 {
	if v < 0 || v > 1 {
		return 0.2
	}
	return v
}

func disableOpenAIThinking(host, model string) bool {
	return strings.Contains(strings.ToLower(host), "deepseek") ||
		strings.Contains(strings.ToLower(model), "deepseek")
}

func isHTTPTimeout(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	var urlErr *url.Error
	return errors.As(err, &urlErr) && urlErr.Timeout()
}

func httpResponseDetail(body []byte, fallback string) string {
	detail := strings.TrimSpace(string(body))
	if len(detail) > 500 {
		detail = detail[:500]
	}
	if detail == "" {
		return fallback
	}
	return detail
}

func instructionKind(instruction string) string {
	switch {
	case strings.Contains(instruction, "YAML frontmatter"):
		return "description"
	case strings.Contains(instruction, "skill description"):
		return "description"
	default:
		return "document"
	}
}
