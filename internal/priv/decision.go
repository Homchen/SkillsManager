package priv

// ElevatingArg is prepended when relaunching via runas so a failed elevation
// attempt (still unelevated, but with the sentinel) does not loop forever.
const ElevatingArg = "--skillsmanager-elevating"

// ElevateDecision is retained for tests documenting the on-demand elevation flow.
type ElevateDecision int

const (
	ElevateContinue ElevateDecision = iota
	ElevateRelaunch
	ElevateExit
)

// DecideRequestElevate maps elevation state + sentinel arg for on-demand UAC.
// Unlike the old startup path, unelevated processes without a sentinel relaunch
// only when the user explicitly requests elevation.
func DecideRequestElevate(elevated, hasElevatingArg bool) ElevateDecision {
	if elevated {
		return ElevateContinue
	}
	if hasElevatingArg {
		return ElevateExit
	}
	return ElevateRelaunch
}
