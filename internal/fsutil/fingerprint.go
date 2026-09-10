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
	return dirsDiffer(roots, dirContentFingerprint)
}

// SkillDirsStatDiffer is a cheaper scan-path check: file list + sizes, plus
// a content hash of SKILL.md only. Other files are not read. mtime is ignored
// so copies with identical bytes but different timestamps still match.
// Walk / skip / error rules match SkillDirsContentDiffer.
func SkillDirsStatDiffer(roots []string) bool {
	return dirsDiffer(roots, dirStatFingerprint)
}

func dirsDiffer(roots []string, fingerprint func(string) (string, error)) bool {
	if len(roots) < 2 {
		return false
	}
	base, err := fingerprint(roots[0])
	if err != nil {
		return true
	}
	for _, root := range roots[1:] {
		fp, err := fingerprint(root)
		if err != nil || fp != base {
			return true
		}
	}
	return false
}

func dirContentFingerprint(root string) (string, error) {
	type fileEntry struct {
		rel  string
		hash string
	}
	var files []fileEntry
	err := walkSkillFiles(root, func(rel, path string, d os.DirEntry) error {
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

func dirStatFingerprint(root string) (string, error) {
	type fileEntry struct {
		rel  string
		size int64
		hash string
	}
	var files []fileEntry
	err := walkSkillFiles(root, func(rel, path string, d os.DirEntry) error {
		info, err := d.Info()
		if err != nil {
			return err
		}
		ent := fileEntry{rel: rel, size: info.Size()}
		if d.Name() == "SKILL.md" {
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(b)
			ent.hash = hex.EncodeToString(sum[:])
		}
		files = append(files, ent)
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].rel < files[j].rel })
	h := sha256.New()
	for _, f := range files {
		fmt.Fprintf(h, "%s\n%d\n%s\n", f.rel, f.size, f.hash)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func walkSkillFiles(root string, fn func(rel, path string, d os.DirEntry) error) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
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
		return fn(filepath.ToSlash(rel), path, d)
	})
}
