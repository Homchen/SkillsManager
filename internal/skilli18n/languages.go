package skilli18n

import "strings"

// Language is a supported skill locale shown in the UI.
type Language struct {
	Tag   string
	Label string // Chinese display name
}

// SupportedLanguages is the fixed first-party locale list.
var SupportedLanguages = []Language{
	{Tag: "zh-CN", Label: "简体中文"},
	{Tag: "zh-TW", Label: "繁体中文"},
	{Tag: "en", Label: "英语"},
	{Tag: "ja", Label: "日语"},
	{Tag: "ko", Label: "韩语"},
	{Tag: "fr", Label: "法语"},
	{Tag: "de", Label: "德语"},
	{Tag: "es", Label: "西班牙语"},
	{Tag: "pt", Label: "葡萄牙语"},
	{Tag: "ru", Label: "俄语"},
	{Tag: "ar", Label: "阿拉伯语"},
}

// IsSupported reports whether tag is in the fixed language list.
func IsSupported(tag string) bool {
	tag = strings.TrimSpace(tag)
	for _, lang := range SupportedLanguages {
		if lang.Tag == tag {
			return true
		}
	}
	return false
}

// LabelOf returns the Chinese label for a language tag, or the tag itself.
func LabelOf(tag string) string {
	tag = strings.TrimSpace(tag)
	for _, lang := range SupportedLanguages {
		if lang.Tag == tag {
			return lang.Label
		}
	}
	if tag == "" {
		return "未指定语言"
	}
	return tag
}

// ValidateLanguage returns an error when tag is empty or unsupported.
func ValidateLanguage(tag string) error {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return errEmptyLanguage
	}
	if !IsSupported(tag) {
		return errUnsupportedLanguage(tag)
	}
	return nil
}
