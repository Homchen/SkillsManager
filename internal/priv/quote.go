package priv

import "strings"

// quoteArgs joins args for ShellExecute lpParameters using Windows rules:
// quote when needed; escape embedded quotes; double trailing backslashes before '"'.
func quoteArgs(args []string) string {
	parts := make([]string, 0, len(args))
	for _, a := range args {
		parts = append(parts, quoteArg(a))
	}
	return strings.Join(parts, " ")
}

func quoteArg(s string) string {
	if s == "" {
		return `""`
	}
	if !strings.ContainsAny(s, " \t\"") {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 2)
	b.WriteByte('"')
	nBackslash := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\':
			nBackslash++
		case '"':
			for j := 0; j < 2*nBackslash+1; j++ {
				b.WriteByte('\\')
			}
			b.WriteByte('"')
			nBackslash = 0
		default:
			for j := 0; j < nBackslash; j++ {
				b.WriteByte('\\')
			}
			nBackslash = 0
			b.WriteByte(s[i])
		}
	}
	for j := 0; j < 2*nBackslash; j++ {
		b.WriteByte('\\')
	}
	b.WriteByte('"')
	return b.String()
}
