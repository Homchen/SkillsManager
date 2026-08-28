// Package applog writes diagnostic logs for the desktop app.
package applog

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	defaultMaxSize    = 10 * 1024 * 1024
	defaultRetainDays = 7
	secretMinLen      = 8
)

type ctxKey struct{}

type Options struct {
	Dir        string
	Debug      bool
	MaxSize    int64
	RetainDays int
}

var (
	mu       sync.Mutex
	logger   *slog.Logger
	levelVar = new(slog.LevelVar)
	textW    *rotateWriter
	jsonW    *rotateWriter
	home     string
	secrets  []string
	dirPath  string
)

// DefaultDir returns ~/.skillsmanager/logs.
func DefaultDir() (string, error) {
	h, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(h, ".skillsmanager", "logs"), nil
}

func Dir() string {
	mu.Lock()
	defer mu.Unlock()
	return dirPath
}

func Init(dir string, debug bool) error {
	return InitWith(Options{Dir: dir, Debug: debug})
}

func InitWith(opts Options) error {
	mu.Lock()
	defer mu.Unlock()
	closeLocked()

	dir := strings.TrimSpace(opts.Dir)
	if dir == "" {
		return fmt.Errorf("日志目录为空")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
		return err
	}
	maxSize := opts.MaxSize
	if maxSize <= 0 {
		maxSize = defaultMaxSize
	}
	retain := opts.RetainDays
	if retain <= 0 {
		retain = defaultRetainDays
	}
	_ = purgeOldLocked(dir, retain)

	tw, err := newRotateWriter(dir, ".log", maxSize)
	if err != nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
		return err
	}
	jw, err := newRotateWriter(dir, ".jsonl", maxSize)
	if err != nil {
		_ = tw.Close()
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
		return err
	}
	if opts.Debug {
		levelVar.Set(slog.LevelDebug)
	} else {
		levelVar.Set(slog.LevelInfo)
	}
	handlerOpts := &slog.HandlerOptions{
		Level:       levelVar,
		ReplaceAttr: replaceAttr,
	}
	logger = slog.New(&fanoutHandler{handlers: []slog.Handler{
		slog.NewTextHandler(tw, handlerOpts),
		slog.NewJSONHandler(jw, handlerOpts),
	}})
	textW = tw
	jsonW = jw
	dirPath = dir
	if h, err := os.UserHomeDir(); err == nil {
		home = h
	}
	return nil
}

func Close() {
	mu.Lock()
	defer mu.Unlock()
	closeLocked()
}

func closeLocked() {
	if textW != nil {
		_ = textW.Close()
		textW = nil
	}
	if jsonW != nil {
		_ = jsonW.Close()
		jsonW = nil
	}
}

func SetDebug(debug bool) {
	if debug {
		levelVar.Set(slog.LevelDebug)
		return
	}
	levelVar.Set(slog.LevelInfo)
}

func SetSecrets(values ...string) {
	cleaned := make([]string, 0, len(values))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if len(v) < secretMinLen {
			continue
		}
		cleaned = append(cleaned, v)
	}
	mu.Lock()
	secrets = cleaned
	mu.Unlock()
}

func Logger() *slog.Logger {
	mu.Lock()
	defer mu.Unlock()
	if logger == nil {
		return slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return logger
}

func WithJobID(ctx context.Context, id string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, ctxKey{}, id)
}

func JobIDFrom(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

func NewJobID(prefix string) string {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "job"
	}
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().Unix()%0xffff)
	}
	return fmt.Sprintf("%s-%x", prefix, b)
}

func Info(msg string, args ...any) {
	Logger().Info(msg, args...)
}

func Warn(msg string, args ...any) {
	Logger().Warn(msg, args...)
}

func Error(msg string, args ...any) {
	Logger().Error(msg, args...)
}

func Debug(msg string, args ...any) {
	Logger().Debug(msg, args...)
}

func InfoContext(ctx context.Context, msg string, args ...any) {
	Logger().InfoContext(ctx, msg, withJob(ctx, args)...)
}

func WarnContext(ctx context.Context, msg string, args ...any) {
	Logger().WarnContext(ctx, msg, withJob(ctx, args)...)
}

func ErrorContext(ctx context.Context, msg string, args ...any) {
	Logger().ErrorContext(ctx, msg, withJob(ctx, args)...)
}

func DebugContext(ctx context.Context, msg string, args ...any) {
	Logger().DebugContext(ctx, msg, withJob(ctx, args)...)
}

func withJob(ctx context.Context, args []any) []any {
	if id := JobIDFrom(ctx); id != "" {
		return append([]any{"jobId", id}, args...)
	}
	return args
}

func Op(op string, fn func() error, args ...any) error {
	_, err := OpValue(op, func() (struct{}, error) {
		return struct{}{}, fn()
	}, args...)
	return err
}

func OpValue[T any](op string, fn func() (T, error), args ...any) (T, error) {
	all := append([]any{"op", op}, args...)
	start := time.Now()
	Info("op start", all...)
	v, err := fn()
	all = append(append([]any{}, all...), "durationMs", time.Since(start).Milliseconds())
	if err != nil {
		Error("op fail", append(all, "err", err)...)
		return v, err
	}
	Info("op ok", all...)
	return v, nil
}

func replaceAttr(_ []string, a slog.Attr) slog.Attr {
	switch a.Value.Kind() {
	case slog.KindString:
		return slog.String(a.Key, sanitize(a.Value.String()))
	case slog.KindAny:
		if err, ok := a.Value.Any().(error); ok && err != nil {
			return slog.String(a.Key, sanitize(err.Error()))
		}
	}
	return a
}

func sanitize(s string) string {
	if s == "" {
		return s
	}
	mu.Lock()
	h := home
	secs := append([]string(nil), secrets...)
	mu.Unlock()
	if h != "" {
		s = strings.ReplaceAll(s, h, "~")
		s = strings.ReplaceAll(s, filepath.ToSlash(h), "~")
	}
	for _, secret := range secs {
		if secret != "" && strings.Contains(s, secret) {
			s = strings.ReplaceAll(s, secret, "***")
		}
	}
	return s
}
