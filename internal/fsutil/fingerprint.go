package fsutil

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// SkillDirsContentDiffer reports whether any pair among roots differs in
// file list or file contents. Symlinks are ignored; directories matching
// ShouldSkipDir are not walked. Fewer than two roots never differ.
// A fingerprint error is treated as different.
func SkillDirsContentDiffer(roots []string) bool {
	if len(roots) < 2 {
		return false
	}
	base, err := dirFingerprint(roots[0])
	if err != nil {
		return true
	}
	for _, root := range roots[1:] {
		fp, err := dirFingerprint(root)
		if err != nil || fp != base {
			return true
		}
	}
	return false
}

func dirFingerprint(root string) (string, error) {
	type fileEntry struct {
		rel  string
		hash string
	}
	var files []fileEntry
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if path != root && ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		files = append(files, fileEntry{rel: rel, hash: hex.EncodeToString(sum[:])})
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].rel < files[j].rel })
	h := sha256.New()
	for _, f := range files {
		fmt.Fprintf(h, "%s\n%s\n", f.rel, f.hash)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
