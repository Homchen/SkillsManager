package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalizePathNotExist(t *testing.T) {
	err := &os.PathError{
		Op:   "GetFileAttributesEx",
		Path: `C:\Users\Administrator\.skills\.system\imagegen`,
		Err:  errors.New("The system cannot find the path specified."),
	}
	got := localizeError(err)
	if !strings.Contains(got, "路径不存在") {
		t.Fatalf("got %q", got)
	}
	if strings.Contains(got, "cannot find") {
		t.Fatalf("still english: %q", got)
	}
}

func TestLocalizeWrappedChineseContext(t *testing.T) {
	pathErr := &os.PathError{
		Op:   "GetFileAttributesEx",
		Path: filepath.Join("hub", ".system", "imagegen"),
		Err:  errors.New("The system cannot find the path specified."),
	}
	err := fmt.Errorf("构建技能 .system/imagegen 的冲突失败：%w", pathErr)
	got := localizeError(err)
	if !strings.Contains(got, "构建技能") {
		t.Fatalf("lost context: %q", got)
	}
	if !strings.Contains(got, "路径不存在") {
		t.Fatalf("missing cn path: %q", got)
	}
	if strings.Contains(got, "cannot find") {
		t.Fatalf("still english: %q", got)
	}
}
