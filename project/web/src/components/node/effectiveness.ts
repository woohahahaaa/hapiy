// 节点"最终是否可用"的统一判定。各节点只判断自己：最终不可用即 60% 不透明度。
// 判定只含该节点自身的组成开关，不含上级链路（entry/slot 归属）。

export function providerCardActive(
  child: { readonly enabled: boolean; readonly providerStatus: boolean; readonly autoDisabled: boolean },
): boolean {
  return child.enabled && child.providerStatus && !child.autoDisabled
}

export function slotNodeActive(
  enabled: boolean | undefined,
  deadlineAt: number | null | undefined,
  externallyDisabled: boolean,
  now: number = Date.now(),
): boolean {
  if (externallyDisabled) return false
  if (enabled === false) return false
  return deadlineAt === null || deadlineAt === undefined || deadlineAt > now
}

export function entryActive(enabled: boolean, weight: number | undefined): boolean {
  return enabled && (weight ?? 1) > 0
}

export function itemActive(enabled: boolean): boolean {
  return enabled
}