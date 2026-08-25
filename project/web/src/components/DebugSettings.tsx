import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { dashboardApi } from '@/lib/dashboard-api'

export const DEBUG_FLOW_LIGHTS_KEY = 'debug_flow_lights'
export const DEBUG_NODE_INFO_KEY = 'debug_executor_node_info'

function DebugToggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        aria-label={title}
        className="shrink-0"
      />
    </div>
  )
}

export function DebugSettings() {
  const [flowLights, setFlowLights] = useState(false)
  const [nodeInfo, setNodeInfo] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void dashboardApi
      .getSettings()
      .then((settings) => {
        if (cancelled) return
        const find = (key: string) => settings.find((s) => s.key === key)?.value === 'true'
        setFlowLights(find(DEBUG_FLOW_LIGHTS_KEY))
        setNodeInfo(find(DEBUG_NODE_INFO_KEY))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = (key: string, next: boolean) => {
    if (key === DEBUG_FLOW_LIGHTS_KEY) setFlowLights(next)
    if (key === DEBUG_NODE_INFO_KEY) setNodeInfo(next)
    void dashboardApi.updateSetting(key, String(next)).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <DebugToggle
          title="节点信息 Debug"
          description={"选中节点/插槽后 console 输出其信息（示例）：\n\n" +
            "[ExecutorDebug] slot pslot-test (provider)\n" +
            "  ✓ entry: entry-test enabled=true weight=1\n" +
            "  ✓ slot:  pslot-test enabled=true deadline=常开\n" +
            "  ✗ 自身: prov-test enabled=false\n" +
            "  ✗ 规则: 多元探索 status=true autoDisabled=false workflow=true\n" +
            "  == 最终判定: 禁用 (provider)\n\n" +
            "选中单个条目时输出该条目的单条完整判定。"}
          checked={loaded && nodeInfo}
          onChange={(v) => handleToggle(DEBUG_NODE_INFO_KEY, v)}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <DebugToggle
          title="节点流光 Debug"
          description={"每次输出以下三类信息（示例）：\n\n" +
            "[流光Debug] 请求 b3f2.. model=deepseek-v4-flash provider=deepseek 路径来源=请求事实 path=entry-test→pslot-test→prov-xxx→…\n" +
            "[流光Debug] run#12 step 3/16 loop#0 激活节点 prov-xxx\n" +
            "[流光Debug] run#12 step 4/16 loop#0 激活连线 entry-test→pslot-test\n" +
            "[流光Debug] 校验 prov-xxx -> deepseek: status=true autoDisabled=false workflow=true   （命中）\n" +
            "[流光Debug] 跳过 logOutput-..: 节点开关已关闭   （未命中时给出原因：开关关闭/外部禁用/倒计时过期/供应商记录未匹配）"}
          checked={loaded && flowLights}
          onChange={(v) => handleToggle(DEBUG_FLOW_LIGHTS_KEY, v)}
        />
      </div>
    </div>
  )
}