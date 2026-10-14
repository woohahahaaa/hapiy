import type { ReactNode } from 'react'

// The relay renders one line per configured rule, leading with the verdict,
// e.g. "[请求改写] 命中·生效：改温度（原因）". This splits those lines and
// colours the verdict so a scan down the column shows how each rule went.
// The verdict tokens mirror the backend's service.RuleNote.verdict(); keep the
// two in sync when the wording changes.
const VERDICT_CLASS: Record<string, string> = {
  '命中·生效': 'text-emerald-700 dark:text-emerald-300',
  '命中·部分生效': 'text-amber-700 dark:text-amber-300',
  '命中·未生效': 'text-orange-700 dark:text-orange-300',
  '命中·出错': 'text-destructive',
  '未命中': 'text-muted-foreground',
}

// Longest alternatives first so 命中·部分生效 wins over its 命中·生效 prefix.
const VERDICT_RE = /^(\[[^\]]*\]\s*)(命中·部分生效|命中·生效|命中·未生效|命中·出错|未命中)(.*)$/

// RuleNoteLines renders relay rule-outcome text with colour-coded verdicts.
// Lines that do not carry a verdict (other event details) pass through plain,
// so callers can feed any detail text.
export function RuleNoteLines({ text, className = '' }: {
  readonly text: string
  readonly className?: string
}): ReactNode {
  const lines = text.split('\n').filter((line) => line !== '')
  if (lines.length === 0) return null
  return (
    <div className={`flex flex-col ${className}`}>
      {lines.map((line, index) => {
        const match = VERDICT_RE.exec(line)
        if (match === null) {
          return (
            <div key={index} className="break-words whitespace-pre-wrap">
              {line}
            </div>
          )
        }
        return (
          <div key={index} className="break-words whitespace-pre-wrap">
            <span className="text-muted-foreground">{match[1]}</span>
            <span className={VERDICT_CLASS[match[2]] ?? ''}>{match[2]}</span>
            {match[3]}
          </div>
        )
      })}
    </div>
  )
}
