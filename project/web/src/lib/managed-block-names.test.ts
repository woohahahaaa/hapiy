import { describe, expect, it } from 'vitest'
import { collectManagedBlockNames } from '@/lib/managed-block-names'
import type { ManagedAgentGroup, ManagedProviderView } from '@/lib/dashboard-api'

function view(partial: {
  name: string
  groups?: readonly { endpoint: string; suffix: string }[]
  hiddenGroups?: readonly { endpoint: string; suffix: string }[]
}): ManagedProviderView {
  return {
    name: partial.name,
    groups: (partial.groups ?? []) as unknown as readonly ManagedAgentGroup[],
    hidden_groups: (partial.hiddenGroups ?? []) as unknown as readonly ManagedAgentGroup[],
  } as unknown as ManagedProviderView
}

describe('collectManagedBlockNames', () => {
  it('认领根名与各分组后缀拼出的块名', () => {
    const names = collectManagedBlockNames(
      [view({ name: 'hapiy', groups: [{ endpoint: '/chat/completions', suffix: '_c' }, { endpoint: '/v1/responses', suffix: '_r' }] })],
      ['hapiy_c', 'hapiy_r'],
    )
    expect(names.has('hapiy')).toBe(true)
    expect(names.has('hapiy_c')).toBe(true)
    expect(names.has('hapiy_r')).toBe(true)
  })

  it('隐藏分组的块也算托管（分组没成员但块还留在文件里）', () => {
    const names = collectManagedBlockNames(
      [view({ name: 'hapiy', hiddenGroups: [{ endpoint: '/chat/completions', suffix: '_chat_completions' }] })],
      ['hapiy_chat_completions'],
    )
    expect(names.has('hapiy_chat_completions')).toBe(true)
  })

  it('根名形态的残块算托管（改名/回滚留下的旧名字）', () => {
    const names = collectManagedBlockNames(
      [view({ name: 'hapiy', groups: [{ endpoint: '/chat/completions', suffix: '_c' }] })],
      ['hapiy_c', 'hapiy-old', 'hapiy_chat_completions'],
    )
    expect(names.has('hapiy-old')).toBe(true)
    expect(names.has('hapiy_chat_completions')).toBe(true)
  })

  it('不相干的块不算托管（前缀相同但没有分隔符 / 其它根名）', () => {
    const names = collectManagedBlockNames(
      [view({ name: 'hapiy' })],
      ['hapiyopenai', 'wooh-openai-c', 'wooh-openai-r'],
    )
    expect(names.has('hapiyopenai')).toBe(false)
    expect(names.has('wooh-openai-c')).toBe(false)
    expect(names.has('wooh-openai-r')).toBe(false)
  })
})
