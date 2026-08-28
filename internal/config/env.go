package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	openAIAPIKeyEnvName           = "OPENAI_API_KEY"
	microsoftTranslatorKeyEnvName = "MICROSOFT_TRANSLATOR_KEY"
)

// DefaultEnvPath returns ~/.skillsmanager/.env.
func DefaultEnvPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".skillsmanager", ".env"), nil
}

// LoadOpenAIAPIKey reads OPENAI_API_KEY from the default .env file.
func LoadOpenAIAPIKey() (string, error) {
	path, err := DefaultEnvPath()
	if err != nil {
		return "", err
	}
	return loadEnvValue(path, openAIAPIKeyEnvName)
}

// SaveOpenAIAPIKey writes OPENAI_API_KEY to the default .env file.
// An empty value removes the key from the file. Config.Save treats empty as
// "keep existing" and only deletes when the field is ClearSecret.
func SaveOpenAIAPIKey(apiKey string) error {
	path, err := DefaultEnvPath()
	if err != nil {
		return err
	}
	return upsertEnvValue(path, openAIAPIKeyEnvName, strings.TrimSpace(apiKey))
}

// LoadMicrosoftTranslatorKey reads MICROSOFT_TRANSLATOR_KEY from the default .env file.
func LoadMicrosoftTranslatorKey() (string, error) {
	path, err := DefaultEnvPath()
	if err != nil {
		return "", err
	}
	return loadEnvValue(path, microsoftTranslatorKeyEnvName)
}

// SaveMicrosoftTranslatorKey writes MICROSOFT_TRANSLATOR_KEY to the default .env file.
// An empty value removes the key from the file. Config.Save treats empty as
// "keep existing" and only deletes when the field is ClearSecret.
func SaveMicrosoftTranslatorKey(apiKey string) error {
	path, err := DefaultEnvPath()
	if err != nil {
		return err
	}
	return upsertEnvValue(path, microsoftTranslatorKeyEnvName, strings.TrimSpace(apiKey))
}

func loadEnvValue(path, key string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if strings.TrimSpace(name) != key {
			continue
		}
		return unquoteEnvValue(strings.TrimSpace(value)), nil
	}
	return "", scanner.Err()
}

func upsertEnvValue(path, key, value string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	var lines []string
	found := false
	if b, err := os.ReadFile(path); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" && len(lines) == 0 {
				continue
			}
			if !strings.HasPrefix(trimmed, "#") {
				if name, _, ok := strings.Cut(trimmed, "="); ok && strings.TrimSpace(name) == key {
					found = true
					if value == "" {
						continue
					}
					lines = append(lines, fmt.Sprintf("%s=%s", key, escapeEnvValue(value)))
					continue
				}
			}
			lines = append(lines, line)
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	if !found && value != "" {
		lines = append(lines, fmt.Sprintf("%s=%s", key, escapeEnvValue(value)))
	}

	// Trim trailing empty lines for stable files.
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	content := ""
	if len(lines) > 0 {
		content = strings.Join(lines, "\n") + "\n"
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

func unquoteEnvValue(value string) string {
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}

func escapeEnvValue(value string) string {
	if strings.ContainsAny(value, " \t#\"'") || strings.Contains(value, "\n") {
		escaped := strings.ReplaceAll(value, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		return `"` + escaped + `"`
	}
	return value
}
