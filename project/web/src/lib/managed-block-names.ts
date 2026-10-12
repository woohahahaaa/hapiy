import type { ManagedProviderView } from '@/lib/dashboard-api'

// collectManagedBlockNames 收集配置文件里「归托管所有」的 provider 块名。
//
// 托管块的归属只靠名字（根名，或根名+分组后缀）。除了当前分组，下面两类
// 也必须算作托管，否则它们会掉进普通供应商列表：
//   · 隐藏分组（hidden_groups）：分组失去全部成员后仍会占着文件里的块；
//   · 文件里根名形态（`根名` / `根名_…` / `根名-…`）的残块：改名、版本
//     回滚、删除旧托管行后再建同名行都会留下这种块，后端会在下一次同步时
//     清掉它们，清理之前不能让界面把它们当成普通供应商。
export function collectManagedBlockNames(
  managed: readonly ManagedProviderView[],
  fileProviderIds: readonly string[],
): ReadonlySet<string> {
  const names = new Set<string>()
  for (const mv of managed) {
    names.add(mv.name)
    for (const g of mv.groups) names.add(`${mv.name}${g.suffix}`)
    for (const g of mv.hidden_groups ?? []) names.add(`${mv.name}${g.suffix}`)
  }
  for (const id of fileProviderIds) {
    for (const mv of managed) {
      if (id === mv.name || id.startsWith(`${mv.name}_`) || id.startsWith(`${mv.name}-`)) {
        names.add(id)
        break
      }
    }
  }
  return names
}
