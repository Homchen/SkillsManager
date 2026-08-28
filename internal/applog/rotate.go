package applog

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

var dayPrefixRE = regexp.MustCompile(`^app-(\d{4}-\d{2}-\d{2})`)

type rotateWriter struct {
	mu      sync.Mutex
	dir     string
	ext     string
	maxSize int64
	file    *os.File
	size    int64
	day     string
	index   int
}

func newRotateWriter(dir, ext string, maxSize int64) (*rotateWriter, error) {
	w := &rotateWriter{dir: dir, ext: ext, maxSize: maxSize}
	if err := w.reopenLocked(time.Now()); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *rotateWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	now := time.Now()
	if w.file == nil || w.day != now.Format("2006-01-02") || (w.maxSize > 0 && w.size+int64(len(p)) > w.maxSize && w.size > 0) {
		if err := w.reopenLocked(now); err != nil {
			return 0, err
		}
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}

func (w *rotateWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

func (w *rotateWriter) reopenLocked(now time.Time) error {
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
	day := now.Format("2006-01-02")
	index := 1
	if w.day == day {
		index = w.index + 1
	} else {
		index = nextAvailableIndex(w.dir, day, w.ext, w.maxSize)
	}
	name := rotateName(w.dir, day, w.ext, index)
	f, err := os.OpenFile(name, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	w.file = f
	w.size = info.Size()
	w.day = day
	w.index = index
	return nil
}

func rotateName(dir, day, ext string, index int) string {
	if index <= 1 {
		return filepath.Join(dir, "app-"+day+ext)
	}
	return filepath.Join(dir, fmt.Sprintf("app-%s.%d%s", day, index, ext))
}

func nextAvailableIndex(dir, day, ext string, maxSize int64) int {
	for i := 1; i < 1000; i++ {
		name := rotateName(dir, day, ext, i)
		info, err := os.Stat(name)
		if os.IsNotExist(err) {
			return i
		}
		if err == nil && (maxSize <= 0 || info.Size() < maxSize) {
			return i
		}
	}
	return 1
}

func purgeOldLocked(dir string, retainDays int) error {
	cutoff := time.Now().AddDate(0, 0, -retainDays)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		m := dayPrefixRE.FindStringSubmatch(name)
		if m == nil {
			continue
		}
		day, err := time.ParseInLocation("2006-01-02", m[1], time.Local)
		if err != nil {
			continue
		}
		if !day.Before(cutoff.Truncate(24 * time.Hour)) {
			continue
		}
		_ = os.Remove(filepath.Join(dir, name))
	}
	return nil
}
