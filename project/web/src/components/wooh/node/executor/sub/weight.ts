export const WEIGHT_DEBOUNCE_MS = 400

export function clampWeight(raw: string): number | null {
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return null
  const clamped = Math.min(1, Math.max(0, parsed))
  return Math.round(clamped * 100) / 100
}