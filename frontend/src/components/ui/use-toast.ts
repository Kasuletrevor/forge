import * as React from 'react'

type ToastVariant = 'default' | 'destructive'

type ToastItem = {
  id: string
  title?: string
  description?: string
  action?: React.ReactNode
  variant?: ToastVariant
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ToastInput = Omit<ToastItem, 'id' | 'open' | 'onOpenChange'>

const TOAST_LIMIT = 4
const TOAST_REMOVE_DELAY = 250

const listeners = new Set<() => void>()
let memoryState: ToastItem[] = []

function emitChange() {
  listeners.forEach((listener) => listener())
}

function dismissToast(id: string) {
  memoryState = memoryState.map((toast) =>
    toast.id === id ? { ...toast, open: false } : toast,
  )
  emitChange()
  window.setTimeout(() => {
    memoryState = memoryState.filter((toast) => toast.id !== id)
    emitChange()
  }, TOAST_REMOVE_DELAY)
}

export function toast(input: ToastInput) {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`

  const item: ToastItem = {
    id,
    open: true,
    onOpenChange: (open) => {
      if (!open) {
        dismissToast(id)
      }
    },
    ...input,
  }

  memoryState = [item, ...memoryState].slice(0, TOAST_LIMIT)
  emitChange()

  return {
    id,
    dismiss: () => dismissToast(id),
  }
}

export function useToast() {
  const [toasts, setToasts] = React.useState(memoryState)

  React.useEffect(() => {
    const listener = () => setToasts([...memoryState])
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return {
    toasts,
    toast,
    dismiss: dismissToast,
  }
}
