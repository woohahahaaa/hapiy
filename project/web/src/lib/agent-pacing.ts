import { dashboardApi } from '@/lib/dashboard-api'

// AGENT_STEP_GAP_MS is the minimum gap between two simulated user actions
// (open a dialog, fill, click save). Anything shorter reads as a single jump
// to the operator watching the console.
export const AGENT_STEP_GAP_MS = 300

export function agentPause(ms: number = AGENT_STEP_GAP_MS): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// reportAgentAction posts the outcome back to the chat turn. Failures are
// ignored: the backend times the wait out on its own.
export function reportAgentAction(
  id: string,
  result: { ok: boolean; message?: string; data?: Readonly<Record<string, unknown>> },
): void {
  if (id === '') return
  dashboardApi.reportChatUIAction(id, result).catch(() => {})
}
