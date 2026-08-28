package applog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDualWriteAndRedact(t *testing.T) {
	dir := t.TempDir()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := InitWith(Options{Dir: dir, Debug: true, MaxSize: 1024 * 1024, RetainDays: 7}); err != nil {
		t.Fatal(err)
	}
	defer Close()
	SetSecrets("super-secret-token")

	Info("probe", "path", filepath.Join(home, "Documents", "x"), "token", "super-secret-token")

	text := readLog(t, dir, ".log")
	jsonl := readLog(t, dir, ".jsonl")
	for _, body := range []string{text, jsonl} {
		if !strings.Contains(body, "probe") {
			t.Fatalf("missing message:\n%s", body)
		}
		if strings.Contains(body, home) {
			t.Fatalf("home path leaked:\n%s", body)
		}
		if strings.Contains(body, "super-secret-token") {
			t.Fatalf("secret leaked:\n%s", body)
		}
		if !strings.Contains(body, "~") {
			t.Fatalf("expected ~ redaction:\n%s", body)
		}
		if !strings.Contains(body, "***") {
			t.Fatalf("expected secret mask:\n%s", body)
		}
	}
}

func TestDebugLevelGate(t *testing.T) {
	dir := t.TempDir()
	if err := Init(dir, false); err != nil {
		t.Fatal(err)
	}
	defer Close()
	Debug("hidden")
	Info("visible")
	body := readLog(t, dir, ".log")
	if strings.Contains(body, "hidden") {
		t.Fatalf("debug leaked at info:\n%s", body)
	}
	if !strings.Contains(body, "visible") {
		t.Fatalf("info missing:\n%s", body)
	}
	SetDebug(true)
	Debug("shown")
	body = readLog(t, dir, ".log")
	if !strings.Contains(body, "shown") {
		t.Fatalf("debug missing after enable:\n%s", body)
	}
}

func TestRotateAndRetain(t *testing.T) {
	dir := t.TempDir()
	if err := InitWith(Options{Dir: dir, MaxSize: 80, RetainDays: 7}); err != nil {
		t.Fatal(err)
	}
	defer Close()
	for i := 0; i < 40; i++ {
		Info("rotate-line", "i", i, "pad", strings.Repeat("x", 20))
	}
	matches, err := filepath.Glob(filepath.Join(dir, "app-*.log"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) < 2 {
		t.Fatalf("expected rotation, files=%v", matches)
	}

	oldName := filepath.Join(dir, "app-1999-01-01.log")
	if err := os.WriteFile(oldName, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	Close()
	if err := InitWith(Options{Dir: dir, MaxSize: 80, RetainDays: 7}); err != nil {
		t.Fatal(err)
	}
	defer Close()
	if _, err := os.Stat(oldName); !os.IsNotExist(err) {
		t.Fatalf("old log should be purged, err=%v", err)
	}
}

func TestJobIDRoundTrip(t *testing.T) {
	id := NewJobID("tr")
	if !strings.HasPrefix(id, "tr-") || len(id) < 6 {
		t.Fatalf("id=%q", id)
	}
	ctx := WithJobID(t.Context(), id)
	if JobIDFrom(ctx) != id {
		t.Fatalf("job=%q", JobIDFrom(ctx))
	}
}

func TestOpLogsFailure(t *testing.T) {
	dir := t.TempDir()
	if err := Init(dir, false); err != nil {
		t.Fatal(err)
	}
	defer Close()
	err := Op("DeleteSkill", func() error {
		return os.ErrNotExist
	}, "skillId", "demo")
	if err == nil {
		t.Fatal("want error")
	}
	body := readLog(t, dir, ".jsonl")
	if !strings.Contains(body, `"msg":"op start"`) || !strings.Contains(body, `"msg":"op fail"`) {
		t.Fatalf("op logs missing:\n%s", body)
	}
	if !strings.Contains(body, "demo") {
		t.Fatalf("skillId missing:\n%s", body)
	}
}

func readLog(t *testing.T, dir, ext string) string {
	t.Helper()
	day := time.Now().Format("2006-01-02")
	path := filepath.Join(dir, "app-"+day+ext)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
