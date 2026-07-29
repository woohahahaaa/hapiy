import { useState, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ToastState {
  id: number
  message: string
  variant: 'error' | 'info'
}

let toastListener: ((t: ToastState) => void) | null = null
let nextId = 1

export function toast(message: string, variant: 'error' | 'info' = 'info'): void {
  if (toastListener) {
    toastListener({ id: nextId++, message, variant })
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastState[]>([])

  toastListener = useCallback((t: ToastState) => {
    setToasts((prev) => [...prev, t])
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id))
    }, 3000)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={
            t.variant === 'error'
              ? 'flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-md'
              : 'flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary shadow-md'
          }
        >
          {t.variant === 'error' && <AlertTriangle className="size-4" />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
