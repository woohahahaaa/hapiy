import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { JsonHighlight } from '@/components/JsonHighlight'
import { dashboardApi } from '@/lib/dashboard-api'
import type { RewriteRule, ResponseRewriteRule } from '@/lib/dashboard-api'

const SAMPLE_BODY = JSON.stringify(
  {
    messages: [{ role: 'user', content: '你好' }],
  },
  null,
  2,
)

interface RewriteTestDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly rules: readonly RewriteRule[] | readonly ResponseRewriteRule[]
  readonly type: 'rewrite' | 'rewrite-response'
  readonly preselectedRuleId: string | null
  /** When true, the rule selector is disabled and the title shows the rule
   * name. When combined with multiple rules, all rules are executed in
   * sequence (each rule's output becomes the next rule's input). */
  readonly readonlyRule?: boolean
  /** Whether to show the rule selector in the top area. Show in policy table
   * page; hide when opened from a slot node. */
  readonly showSelector?: boolean
  /** Dialog width preset. Defaults to 'full' (fullscreen). */
  readonly width?: 'sm' | 'md' | 'full'
  /** Dialog height preset. 'auto' (default) limits max-height to 85vh and
   * lets content scroll internally. 'full' means fullscreen. */
  readonly height?: 'auto' | 'full'
}

export function RewriteTestDialog({
  open,
  onClose,
  rules,
  type,
  preselectedRuleId,
  readonlyRule = false,
  showSelector = true,
  width = 'full',
  height = 'full',
}: RewriteTestDialogProps) {
  const { t } = useTranslation('rewrite')
  const [selectedRuleId, setSelectedRuleId] = useState<string>(
    preselectedRuleId ?? rules[0]?.id ?? '',
  )
  const [inputBody, setInputBody] = useState(SAMPLE_BODY)
  const [result, setResult] = useState<{ original: unknown; modified: unknown } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const handleRunTest = async () => {
    if (readonlyRule && rules.length > 0) {
      // 串行模式：依次执行所有规则
      setLoading(true)
      setError(null)
      setResult(null)
      let parsed: unknown
      try {
        parsed = JSON.parse(inputBody)
      } catch {
        setError(t('testDialog.invalidJson'))
        setLoading(false)
        return
      }
      let currentBody = parsed
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        setProgress(t('testDialog.progress', { current: i + 1, total: rules.length, name: rule.name }))
        try {
          const res = await dashboardApi.testRewriteRule(type, rule.id, currentBody)
          currentBody = res.modified
        } catch (err) {
          setError(t('testDialog.ruleFailed', { index: i + 1, name: rule.name, error: err instanceof Error ? err.message : t('testDialog.unknownError') }))
          setLoading(false)
          setProgress(null)
          return
        }
      }
      setResult({ original: parsed, modified: currentBody })
      setLoading(false)
      setProgress(null)
      return
    }

    // 单条规则模式
    if (!selectedRuleId) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(inputBody)
      } catch {
        setError(t('testDialog.invalidJson'))
        setLoading(false)
        return
      }
      const res = await dashboardApi.testRewriteRule(type, selectedRuleId, parsed)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('testDialog.testFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent width={width} height={height} bare showCloseButton={false} className="flex flex-col !gap-0 overflow-hidden">
        <DialogHeader className="flex shrink-0 flex-row items-center border-b border-border px-6 py-4">
          <DialogTitle className="text-base">
            {readonlyRule ? t('testDialog.titleSlot') : t('testDialog.title')}
          </DialogTitle>
          <DialogCloseButton className="ml-auto -mr-2" />
        </DialogHeader>

        {showSelector && (<>
          <div className="flex shrink-0 items-center gap-3 px-6 py-3">
            <span className="text-sm font-medium text-nowrap">{t('testDialog.selectRule')}</span>
            <Select
              value={selectedRuleId}
              onValueChange={readonlyRule ? undefined : setSelectedRuleId}
            >
              <SelectTrigger className="flex-1" disabled={readonlyRule}>
                <SelectValue placeholder={t('testDialog.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {rules.map((rule) => (
                    <SelectItem key={rule.id} value={rule.id}>
                      <span className={`font-mono text-xs ${readonlyRule ? 'text-muted-foreground' : ''}`}>{rule.name}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {readonlyRule && rules.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {t('testDialog.sequentialHint', { count: rules.length })}
              </span>
            )}
          </div>
        </>)}

        {readonlyRule && rules.length > 0 && (
          <div className="shrink-0 px-6 pb-2">
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <span className="text-xs font-medium text-muted-foreground">{t('testDialog.executionOrder')}</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {rules.map((rule, i) => (
                  <span key={rule.id} className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 font-mono text-xs text-foreground">
                    {i + 1}. {rule.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-4 px-6 pb-4">
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="mb-1 text-xs font-medium text-muted-foreground">{t('testDialog.input')}</span>
            <textarea
              className="flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre"
              value={inputBody}
              onChange={(e) => setInputBody(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="mb-1 text-xs font-medium text-muted-foreground">{t('testDialog.result')}</span>
            {progress ? (
              <div className="flex flex-1 items-center justify-center rounded-md border border-border text-xs text-muted-foreground">
                {progress}
              </div>
            ) : error ? (
              <div className="flex-1 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                <pre className="font-mono text-xs text-destructive whitespace-pre-wrap break-all">{error}</pre>
              </div>
            ) : result ? (
              <JsonHighlight value={result.modified} className="flex-1 whitespace-pre-wrap break-all" />
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                {t('testDialog.emptyResult')}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-3">
          <Button disabled={loading || (readonlyRule ? rules.length === 0 : !selectedRuleId)} onClick={handleRunTest}>
            {loading ? t('testDialog.running') : t('testDialog.runTest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}