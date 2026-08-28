package priv

import "testing"

func TestQuoteArgs(t *testing.T) {
	cases := []struct {
		in   []string
		want string
	}{
		{[]string{ElevatingArg}, ElevatingArg},
		{[]string{`C:\Program Files\app`}, `"C:\Program Files\app"`},
		{[]string{`say "hi"`}, `"say \"hi\""`},
		// Trailing backslash before closing quote must be doubled.
		{[]string{`C:\Program Files\`}, `"C:\Program Files\\"`},
		{[]string{""}, `""`},
	}
	for _, tc := range cases {
		got := quoteArgs(tc.in)
		if got != tc.want {
			t.Fatalf("quoteArgs(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}
