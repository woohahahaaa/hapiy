// Pure helpers for the JSON line editor gutter. Kept dependency-free so they
// can be unit-tested without a DOM.

export function splitJsonLines(text: string): string[] {
  return text.split('\n')
}

/** Number of hard `\n` lines. Empty text still occupies one (empty) line. */
export function lineCount(text: string): number {
  return splitJsonLines(text).length
}
