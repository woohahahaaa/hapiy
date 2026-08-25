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
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
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
          description="开启后，在转发拓扑中选中节点或插槽时，console 输出该节点/插槽的信息：所属 entry、自身启用状态、倒计时、绑定规则/供应商的启用与禁用判定及最终结论。"
          checked={loaded && nodeInfo}
          onChange={(v) => handleToggle(DEBUG_NODE_INFO_KEY, v)}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <DebugToggle
          title="节点流光 Debug"
          description="开启后，转发拓扑中每条流光动画在 console 输出调度信息：对应请求/工作流、当前激活的节点或连线、以及各节点与供应商记录的命中/未命中判定。"
          checked={loaded && flowLights}
          onChange={(v) => handleToggle(DEBUG_FLOW_LIGHTS_KEY, v)}
        />
      </div>
    </div>
  )
}