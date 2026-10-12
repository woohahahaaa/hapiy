import type { EndpointRuleMap, ManagedAgentGroup, ManagedProviderOption } from '@/lib/dashboard-api'

// 托管 dialog 的分组结果：一个分组 = 配置文件里的一个 provider 块。
//
// 归类的「权威」在后端（`endpoint_rules`：哪些 endpoint 命中同一条
// Endpoint 规则、该规则的代表 endpoint 是谁）。前端只按 canonical 聚合，
// 不再自己重跑一遍通配匹配 —— 以前弹窗里现算一遍、保存后列表里又按存下来
// 的 endpoint 算一遍，两边一旦不一致就出现「预览和保存后不一样」。
export type ManagedEndpointGroup = {
  readonly endpoint: string
  readonly ruleIndex: number
  readonly ruleName: string | null
  readonly ruleTag: string | null
  /** 归纳进本组的 endpoint（同一条规则的 live endpoint，含本组自己的）。 */
  readonly hits: readonly string[]
  readonly providerNames: readonly string[]
  readonly modelNames: readonly string[]
  readonly noEndpointProviderIds?: readonly string[]
}

// groupKeyOf maps one endpoint to its group: the rule's canonical endpoint
// when a rule hits it, else the endpoint itself.
export function groupKeyOf(endpoint: string, rules: EndpointRuleMap): string {
  return rules[endpoint]?.canonical ?? endpoint
}

// deriveManagedEndpointGroups builds the dialog's group list from the
// checked providers. Stored groups keep their own endpoint and suffix —
// 重存不会把 provider 块改名（dsh 的 provider id 是永久的，改名等于换供应
// 商）—— 只有当同一规则下还存着另一个不同后缀的块时，才多出一行独立分组。
export function deriveManagedEndpointGroups(input: {
  readonly options: readonly ManagedProviderOption[]
  readonly checked: ReadonlySet<string>
  readonly storedGroups: readonly ManagedAgentGroup[]
  readonly rules: EndpointRuleMap
}): readonly ManagedEndpointGroup[] {
  type Acc = {
    endpoint: string
    ruleIndex: number
    ruleName: string | null
    ruleTag: string | null
    hits: string[]
    providers: string[]
    models: string[]
  }
  const byKey = new Map<string, Acc>()
  const noEndpoint = { providers: [] as string[], models: [] as string[], ids: [] as string[] }

  for (const opt of input.options) {
    if (!input.checked.has(opt.id) || !opt.status) continue
    if (opt.endpoints.length === 0) {
      for (const model of opt.models) if (!noEndpoint.models.includes(model)) noEndpoint.models.push(model)
      if (!noEndpoint.providers.includes(opt.name)) noEndpoint.providers.push(opt.name)
      if (!noEndpoint.ids.includes(opt.id)) noEndpoint.ids.push(opt.id)
      continue
    }
    const modelEndpoints = opt.model_endpoints ?? {}
    for (const endpoint of opt.endpoints) {
      const info = input.rules[endpoint]
      const key = info?.canonical ?? endpoint
      let cur = byKey.get(key)
      if (!cur) {
        cur = {
          endpoint: key,
          ruleIndex: info?.ruleIndex ?? -1,
          ruleName: info?.ruleName ?? null,
          ruleTag: info?.tag ?? null,
          hits: [],
          providers: [],
          models: [],
        }
        byKey.set(key, cur)
      }
      if (!cur.hits.includes(endpoint)) cur.hits.push(endpoint)
      if (!cur.providers.includes(opt.name)) cur.providers.push(opt.name)
      for (const model of opt.models) {
        const declared = modelEndpoints[model] ?? []
        // 模型设了明确 endpoint 才进对应组；空（不限）归入供应商的每个 endpoint
        if (declared.length > 0 && !declared.includes(endpoint)) continue
        if (!cur.models.includes(model)) cur.models.push(model)
      }
    }
  }

  // 存量分组：同一条规则下的第一个认领本组（并用它自己的 endpoint，保持
  // 块名和 baseURL 不变）；同后缀的第二条就是同一个块（后端写入时也会合
  // 并），忽略；不同后缀是另一个块，单独成组，避免保存时被删掉。
  const storedSuffix = new Map<string, string>()
  const extras: ManagedAgentGroup[] = []
  for (const stored of input.storedGroups) {
    const endpoint = (stored.endpoint ?? '').trim()
    if (endpoint === '' || endpoint === '__none__') continue
    const key = groupKeyOf(endpoint, input.rules)
    const cur = byKey.get(key)
    if (!cur) continue // 供应商没勾选 / 已删除：由调用方的「未配置 endpoint」逻辑兜底
    const suffix = (stored.suffix ?? '').trim()
    if (!storedSuffix.has(key)) {
      storedSuffix.set(key, suffix)
      cur.endpoint = endpoint
      continue
    }
    if (storedSuffix.get(key) === suffix) continue
    extras.push(stored)
  }

  const groups: ManagedEndpointGroup[] = []
  for (const acc of byKey.values()) {
    groups.push({
      endpoint: acc.endpoint,
      ruleIndex: acc.ruleIndex,
      ruleName: acc.ruleName,
      ruleTag: acc.ruleTag,
      hits: acc.hits.length > 0 ? acc.hits : [acc.endpoint],
      providerNames: acc.providers,
      modelNames: acc.models,
    })
  }
  for (const stored of extras) {
    const endpoint = stored.endpoint.trim()
    const info = input.rules[endpoint]
    const owner = byKey.get(groupKeyOf(endpoint, input.rules))
    groups.push({
      endpoint,
      ruleIndex: info?.ruleIndex ?? -1,
      ruleName: info?.ruleName ?? null,
      ruleTag: info?.tag ?? null,
      hits: owner && owner.hits.length > 0 ? owner.hits : [endpoint],
      providerNames: owner ? owner.providers : [],
      modelNames: owner ? owner.models : [],
    })
  }
  if (noEndpoint.providers.length > 0) {
    groups.push({
      endpoint: '__none__',
      ruleIndex: -1,
      ruleName: null,
      ruleTag: null,
      hits: [],
      providerNames: noEndpoint.providers,
      modelNames: noEndpoint.models,
      noEndpointProviderIds: noEndpoint.ids,
    })
  }
  return groups
}
