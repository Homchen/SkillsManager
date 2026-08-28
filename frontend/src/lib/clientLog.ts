import {LogClientEvent} from '../../wailsjs/go/main/App'

export function logClientWarn(message: string, detail = '') {
  void LogClientEvent('warn', message, detail).catch(() => {
    // Logging must never block the UI.
  })
}

export function logClientError(message: string, detail = '') {
  void LogClientEvent('error', message, detail).catch(() => {
    // Logging must never block the UI.
  })
}
