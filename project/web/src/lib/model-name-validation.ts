export type ModelNameCandidate = {
  readonly model: string
  readonly aliases: readonly string[]
}

export type StoredModelNames = ModelNameCandidate & {
  readonly id: string
}

export type ModelNameConflict = {
  readonly name: string
  readonly source: 'current' | 'history'
}

function normalize(name: string): string {
  return name.trim().toLocaleLowerCase()
}

export function getModelNameConflicts(
  candidate: ModelNameCandidate,
  historical: readonly StoredModelNames[],
  currentId: string | null,
): readonly ModelNameConflict[] {
  const currentNames = [candidate.model, ...candidate.aliases]
    .map((name) => ({ original: name.trim(), normalized: normalize(name) }))
    .filter((name) => name.normalized.length > 0)
  const conflicts: ModelNameConflict[] = []
  const currentSet = new Set<string>()
  for (const name of currentNames) {
    if (currentSet.has(name.normalized)) {
      conflicts.push({ name: name.original, source: 'current' })
    }
    currentSet.add(name.normalized)
  }

  const historicalSet = new Set<string>()
  for (const entry of historical) {
    if (entry.id === currentId) continue
    for (const name of [entry.model, ...entry.aliases]) {
      const normalized = normalize(name)
      if (normalized.length > 0) historicalSet.add(normalized)
    }
  }
  for (const name of currentNames) {
    if (historicalSet.has(name.normalized)) {
      conflicts.push({ name: name.original, source: 'history' })
    }
  }
  return conflicts
}
