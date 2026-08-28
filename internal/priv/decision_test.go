package priv

import "testing"

func TestDecideRequestElevate(t *testing.T) {
	cases := []struct {
		name            string
		elevated        bool
		hasElevatingArg bool
		want            ElevateDecision
	}{
		{"already elevated", true, false, ElevateContinue},
		{"elevated with sentinel", true, true, ElevateContinue},
		{"user requested relaunch", false, false, ElevateRelaunch},
		{"tried but still not elevated", false, true, ElevateExit},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DecideRequestElevate(tc.elevated, tc.hasElevatingArg)
			if got != tc.want {
				t.Fatalf("DecideRequestElevate(%v,%v)=%v want %v", tc.elevated, tc.hasElevatingArg, got, tc.want)
			}
		})
	}
}
