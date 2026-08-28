package translator

import (
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"SkillsManager/internal/applog"
)

func TestRequestMicrosoftAndroidReturnsText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method=%s want POST", r.Method)
		}
		if r.URL.Query().Get("api-version") != "3.0" || r.URL.Query().Get("to") != "zh-CN" {
			t.Errorf("query=%s", r.URL.RawQuery)
		}
		if !strings.HasPrefix(r.Header.Get("X-MT-Signature"), clientName+"::") {
			t.Errorf("missing Microsoft signature: %q", r.Header.Get("X-MT-Signature"))
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != `[{"Text":"Hello"}]` {
			t.Errorf("body=%s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"translations":[{"text":"你好"}]}]`))
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/translate?api-version=3.0&to=zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	text, retry, err := requestMicrosoftAndroid(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`[{"Text":"Hello"}]`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry {
		t.Fatal("successful request must not retry")
	}
	if text != "你好" {
		t.Fatalf("text=%q want 你好", text)
	}
}

func TestRequestMicrosoftAndroidDoesNotRetryUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/translate?api-version=3.0&to=zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	_, retry, err := requestMicrosoftAndroid(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`[{"Text":"Hello"}]`),
	)
	if err == nil {
		t.Fatal("want authentication error")
	}
	if retry {
		t.Fatal("401 must not retry")
	}
}

func TestRequestMicrosoftAndroidRetriesTooManyRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/translate?api-version=3.0&to=zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	_, retry, err := requestMicrosoftAndroid(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`[{"Text":"Hello"}]`),
	)
	if err == nil {
		t.Fatal("want rate-limit error")
	}
	if !retry {
		t.Fatal("429 must be retryable")
	}
}

func TestRequestMicrosoftAzureUsesSubscriptionKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Ocp-Apim-Subscription-Key") != "test-key" {
			t.Errorf("key=%q", r.Header.Get("Ocp-Apim-Subscription-Key"))
		}
		if r.Header.Get("Ocp-Apim-Subscription-Region") != "eastasia" {
			t.Errorf("region=%q", r.Header.Get("Ocp-Apim-Subscription-Region"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"translations":[{"text":"你好"}]}]`))
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/translate?api-version=3.0&to=zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	text, retry, err := requestMicrosoftAzure(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`[{"Text":"Hello"}]`),
		"test-key",
		"eastasia",
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry || text != "你好" {
		t.Fatalf("text=%q retry=%v", text, retry)
	}
}

func TestTranslateMicrosoftAzureRequiresKey(t *testing.T) {
	_, err := Translate(context.Background(), Config{
		Engine:         EngineMicrosoft,
		TargetLanguage: "zh-CN",
	}, "Hello")
	if err == nil || !strings.Contains(err.Error(), "Subscription Key") {
		t.Fatalf("want key required error, got %v", err)
	}
}

func TestMicrosoftSignatureFormat(t *testing.T) {
	now := time.Date(2026, time.July, 24, 7, 0, 0, 0, time.UTC)
	signature, err := microsoftSignature(
		"api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-CN",
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(signature, "::")
	if len(parts) != 4 {
		t.Fatalf("signature parts=%d want 4: %q", len(parts), signature)
	}
	if parts[0] != clientName {
		t.Fatalf("client=%q", parts[0])
	}
	if _, err := base64.StdEncoding.DecodeString(parts[1]); err != nil {
		t.Fatalf("signature digest=%q: %v", parts[1], err)
	}
	if parts[2] != now.Format(http.TimeFormat) {
		t.Fatalf("time=%q", parts[2])
	}
	if len(parts[3]) != 32 {
		t.Fatalf("guid=%q", parts[3])
	}
}

func TestRequestOpenAITranslationRetriesTooManyRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/v1/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	_, retry, retryAfter, err := requestOpenAITranslation(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`{"model":"test-model"}`),
		"test-key",
	)
	if err == nil {
		t.Fatal("want rate-limit error")
	}
	if !retry {
		t.Fatal("429 must be retryable")
	}
	if retryAfter != openaiDefaultRetryAfter {
		t.Fatalf("retryAfter=%s want default %s", retryAfter, openaiDefaultRetryAfter)
	}
}

func TestRequestOpenAITranslationTrimsSpacePadding(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"  译文\n"}}]}`))
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/v1/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	text, retry, retryAfter, err := requestOpenAITranslation(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`{"model":"test-model"}`),
		"test-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry {
		t.Fatal("successful request must not retry")
	}
	if retryAfter != 0 {
		t.Fatalf("retryAfter=%s want 0", retryAfter)
	}
	if text != "译文\n" {
		t.Fatalf("text=%q want %q", text, "译文\n")
	}
}

func TestRequestOpenAITranslationReturnsText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method=%s want POST", r.Method)
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path=%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("authorization=%q", r.Header.Get("Authorization"))
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `"model":"test-model"`) {
			t.Errorf("body=%s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"译文"}}]}`))
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/v1/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	text, retry, retryAfter, err := requestOpenAITranslation(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`{"model":"test-model"}`),
		"test-key",
	)
	if err != nil {
		t.Fatal(err)
	}
	if retry {
		t.Fatal("successful request must not retry")
	}
	if retryAfter != 0 {
		t.Fatalf("retryAfter=%s want 0", retryAfter)
	}
	if text != "译文" {
		t.Fatalf("text=%q want 译文", text)
	}
}

func TestChatCompletionsURL(t *testing.T) {
	requestURL, err := chatCompletionsURL("https://example.com/v1/")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := requestURL.String(), "https://example.com/v1/chat/completions"; got != want {
		t.Fatalf("url=%q want %q", got, want)
	}
}

func TestChatCompletionsURLRejectsBlockedTargets(t *testing.T) {
	cases := []string{
		"http://169.254.169.254/latest/meta-data",
		"https://metadata.google.internal/",
		"https://user:pass@example.com/v1",
		"ftp://example.com/v1",
	}
	for _, raw := range cases {
		if _, err := chatCompletionsURL(raw); err == nil {
			t.Fatalf("expected rejection for %q", raw)
		}
	}
}

func TestIsBlockedOpenAIIP(t *testing.T) {
	if !isBlockedOpenAIIP(net.ParseIP("169.254.169.254")) {
		t.Fatal("metadata IP must be blocked")
	}
	if isBlockedOpenAIIP(net.ParseIP("127.0.0.1")) {
		t.Fatal("loopback should remain allowed for local models")
	}
	if isBlockedOpenAIIP(net.ParseIP("192.168.1.10")) {
		t.Fatal("private LAN should remain allowed for local models")
	}
}

// SKILL.md translation always follows a successful description call with an
// immediate body call. Gateways with a 1–2s RPM window return 429 on that
// second request; "翻译 description" is a single call and stays under the limit.
func TestParseRetryAfter(t *testing.T) {
	if got := parseRetryAfter("", 2*time.Second); got != 2*time.Second {
		t.Fatalf("empty=%s", got)
	}
	if got := parseRetryAfter("3", time.Second); got != 3*time.Second {
		t.Fatalf("seconds=%s", got)
	}
	if got := parseRetryAfter("999", time.Second); got != openaiMaxRetryAfter {
		t.Fatalf("capped=%s", got)
	}
	when := time.Now().UTC().Add(4 * time.Second).Format(http.TimeFormat)
	got := parseRetryAfter(when, time.Second)
	if got < 3*time.Second || got > 5*time.Second {
		t.Fatalf("http-date retry-after=%s", got)
	}
}

func TestHTTPResponseDetail(t *testing.T) {
	if got := httpResponseDetail(nil, "fallback"); got != "fallback" {
		t.Fatalf("empty=%q", got)
	}
	if got := httpResponseDetail([]byte("  rate limited  "), ""); got != "rate limited" {
		t.Fatalf("trim=%q", got)
	}
	long := strings.Repeat("x", 600)
	if got := httpResponseDetail([]byte(long), ""); len(got) != 500 {
		t.Fatalf("truncated len=%d", len(got))
	}
}

func TestRequestOpenAITranslationLogsRateLimitBody(t *testing.T) {
	dir := t.TempDir()
	if err := applog.Init(dir, false); err != nil {
		t.Fatal(err)
	}
	defer applog.Close()

	const body = `{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/v1/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	_, retry, _, err := requestOpenAITranslation(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`{"model":"test-model"}`),
		"test-key",
	)
	if err == nil || !retry {
		t.Fatalf("err=%v retry=%v", err, retry)
	}

	logged := readAppLog(t, dir)
	if !strings.Contains(logged, "openai rate limited") {
		t.Fatalf("missing rate-limit log:\n%s", logged)
	}
	if !strings.Contains(logged, "insufficient_quota") {
		t.Fatalf("missing 429 body:\n%s", logged)
	}
}

func readAppLog(t *testing.T, dir string) string {
	t.Helper()
	day := time.Now().Format("2006-01-02")
	b, err := os.ReadFile(filepath.Join(dir, "app-"+day+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestRequestOpenAITranslationTimesOutWhileReadingBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"译文"}}]}`))
		}
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/v1/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	_, retry, _, err := requestOpenAITranslation(
		context.Background(),
		openaiHTTPClient(200*time.Millisecond),
		requestURL,
		[]byte(`{"model":"test-model"}`),
		"test-key",
	)
	if err == nil {
		t.Fatal("want timeout while reading body")
	}
	if retry {
		t.Fatal("slow body must not retry into another full timeout")
	}
	if !strings.Contains(err.Error(), "请求超时") {
		t.Fatalf("err=%v", err)
	}
	if strings.Contains(err.Error(), "读取 OpenAI 翻译响应失败") {
		t.Fatalf("raw read error leaked: %v", err)
	}
}

func TestDisableOpenAIThinking(t *testing.T) {
	if !disableOpenAIThinking("api.deepseek.com", "deepseek-v4-flash") {
		t.Fatal("deepseek host+model")
	}
	if !disableOpenAIThinking("runapi.co", "deepseek-v4-flash") {
		t.Fatal("deepseek model via gateway")
	}
	if disableOpenAIThinking("runapi.co", "gpt-5.6-luna") {
		t.Fatal("non-deepseek must keep thinking unset")
	}
}

func TestTranslateOpenAICompatibleDisablesDeepSeekThinking(t *testing.T) {
	resetOpenAILimiterForTest()
	var got []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"译文"}}]}`))
	}))
	defer server.Close()

	cfg := Config{
		Engine:         EngineOpenAICompatible,
		TargetLanguage: "zh-CN",
		OpenAIBaseURL:  server.URL,
		OpenAIAPIKey:   "test-key",
		OpenAIModel:    "deepseek-v4-flash",
	}
	if _, err := translateOpenAICompatible(context.Background(), cfg, "text", "translate", 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `"thinking":{"type":"disabled"}`) {
		t.Fatalf("request body missing thinking off:\n%s", got)
	}
}

func TestTranslateOpenAICompatibleUsesConfiguredTemperature(t *testing.T) {
	resetOpenAILimiterForTest()
	var got []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"译文"}}]}`))
	}))
	defer server.Close()

	cfg := Config{
		Engine:            EngineOpenAICompatible,
		TargetLanguage:    "zh-CN",
		OpenAIBaseURL:     server.URL,
		OpenAIAPIKey:      "test-key",
		OpenAIModel:       "test-model",
		OpenAITemperature: 0.7,
	}
	if _, err := translateOpenAICompatible(context.Background(), cfg, "text", "translate", 5*time.Second); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `"temperature":0.7`) {
		t.Fatalf("request body missing temperature:\n%s", got)
	}
}

func TestOpenAITemperatureClamp(t *testing.T) {
	if got := openAITemperature(0); got != 0 {
		t.Fatalf("zero=%v", got)
	}
	if got := openAITemperature(0.2); got != 0.2 {
		t.Fatalf("default=%v", got)
	}
	if got := openAITemperature(1); got != 1 {
		t.Fatalf("max=%v", got)
	}
	if got := openAITemperature(-1); got != 0.2 {
		t.Fatalf("neg=%v", got)
	}
	if got := openAITemperature(1.5); got != 0.2 {
		t.Fatalf("high=%v", got)
	}
}

func TestRequestOpenAITranslationHonorsRetryAfterHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	requestURL, err := url.Parse(server.URL + "/v1/chat/completions")
	if err != nil {
		t.Fatal(err)
	}
	_, retry, retryAfter, err := requestOpenAITranslation(
		context.Background(),
		server.Client(),
		requestURL,
		[]byte(`{"model":"test-model"}`),
		"test-key",
	)
	if err == nil || !retry {
		t.Fatalf("err=%v retry=%v", err, retry)
	}
	if retryAfter != 7*time.Second {
		t.Fatalf("retryAfter=%s want 7s", retryAfter)
	}
}

func TestTranslateOpenAICompatibleRecoversFromBackToBackRateLimit(t *testing.T) {
	resetOpenAILimiterForTest()
	var mu sync.Mutex
	var lastSuccess time.Time
	minGap := 2 * time.Second

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		now := time.Now()
		if !lastSuccess.IsZero() && now.Sub(lastSuccess) < minGap {
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"rate limited"}}`))
			return
		}
		lastSuccess = now
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"译文"}}]}`))
	}))
	defer server.Close()

	cfg := Config{
		Engine:         EngineOpenAICompatible,
		TargetLanguage: "zh-CN",
		OpenAIBaseURL:  server.URL,
		OpenAIAPIKey:   "test-key",
		OpenAIModel:    "test-model",
	}
	ctx := context.Background()

	if _, err := translateOpenAICompatible(ctx, cfg, "short description", "translate desc", 5*time.Second); err != nil {
		t.Fatalf("description call: %v", err)
	}
	if _, err := translateOpenAICompatible(ctx, cfg, strings.Repeat("skill body ", 40), "translate body", 15*time.Second); err != nil {
		t.Fatalf("SKILL.md body call: %v", err)
	}
}

func resetOpenAILimiterForTest() {
	openaiLimiter.mu.Lock()
	openaiLimiter.next = time.Time{}
	openaiLimiter.mu.Unlock()
}
