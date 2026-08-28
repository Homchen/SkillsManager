//go:build windows

package priv

import "golang.org/x/sys/windows"

// IsElevated reports whether the current process token has elevated privileges.
func IsElevated() bool {
	var token windows.Token
	err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token)
	if err != nil {
		return false
	}
	defer token.Close()
	return token.IsElevated()
}
