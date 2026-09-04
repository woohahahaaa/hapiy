export function requestStartedAfterBoundary(startTime: string, boundaryMs: number | null): boolean {
  if (boundaryMs === null) return true
  const requestStartMs = Date.parse(startTime)
  return Number.isFinite(requestStartMs) && requestStartMs > boundaryMs
}
