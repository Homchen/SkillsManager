//go:build !windows

package priv

// IsElevated reports elevated status; non-Windows builds treat the process as elevated.
func IsElevated() bool {
	return true
}
