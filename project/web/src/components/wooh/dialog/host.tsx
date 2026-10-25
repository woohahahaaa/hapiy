import { createContext, useContext, type ReactNode } from 'react'

// DialogHostContext is the element dialogs are portalled into. The console
// layout sets it to the management panel (the area right of the agent chat and
// sidebar), so a modal — including a fullscreen one — covers that panel
// instead of the whole browser window. Without a host (login page, tests) the
// dialog falls back to document.body and viewport sizing.
const DialogHostContext = createContext<HTMLElement | null>(null)

export function DialogHostProvider({ host, children }: {
  readonly host: HTMLElement | null
  readonly children: ReactNode
}) {
  return <DialogHostContext.Provider value={host}>{children}</DialogHostContext.Provider>
}

export function useDialogHost(): HTMLElement | null {
  return useContext(DialogHostContext)
}
