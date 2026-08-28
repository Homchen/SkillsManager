import {useCallback, useEffect, useRef, useState} from 'react'

export type ToastTone = 'info' | 'success' | 'warn' | 'error'
export type ToastState = {message: string; tone: ToastTone}

export const APP_TOAST_DURATION_MS = 1500

type AppToastProps = {
  toast: ToastState | null
  onDismiss: () => void
  durationMs?: number
}

export function AppToast({
  toast,
  onDismiss,
  durationMs = APP_TOAST_DURATION_MS,
}: AppToastProps) {
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const startTimer = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      onDismiss()
    }, durationMs)
  }, [clearTimer, durationMs, onDismiss])

  useEffect(() => {
    if (!toast) {
      clearTimer()
      return
    }
    startTimer()
    return clearTimer
  }, [toast, startTimer, clearTimer])

  if (!toast) return null

  return (
    <div
      className={`app-toast app-toast-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
    >
      {toast.message}
    </div>
  )
}

export function useAppToast(durationMs = APP_TOAST_DURATION_MS) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])
  const showToast = useCallback((next: ToastState) => setToast(next), [])
  return {toast, showToast, dismissToast, durationMs}
}
