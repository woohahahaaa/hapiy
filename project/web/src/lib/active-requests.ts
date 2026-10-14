import type { ActiveRequest } from './dashboard-api'

// 活动监视列表排序：活跃（未结束）的请求始终置顶，非活跃的排在下面；
// 两个分组内部都按开始时间倒序，越新的越靠上。此前只按开始时间排序，
// 保留时间调长后活跃请求会被新结束的请求挤到中间，因此单独抽出便于测试。
export function sortActiveRequests(rows: readonly ActiveRequest[]): ActiveRequest[] {
  return [...rows].sort((a, b) => {
    const aActive = a.endTime === null
    const bActive = b.endTime === null
    if (aActive !== bActive) return aActive ? -1 : 1
    return a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0
  })
}
