//go:build !windows

package priv

// EnsureElevated is a no-op on non-Windows platforms.
func EnsureElevated() {}

// RequestElevation is a no-op on non-Windows platforms (treated as already elevated).
func RequestElevation() error {
	return nil
}
