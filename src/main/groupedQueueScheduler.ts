import { getQueueConcurrencyPolicy, type QueueSpeedMode, type QueueConcurrencyPolicy } from '@v-download/shared'

export { getQueueConcurrencyPolicy, type QueueSpeedMode, type QueueConcurrencyPolicy }

export interface SchedulerTask {
  id: string
  playlistId: string | null
  playlistIndex: number | null
  status?: 'queued' | 'downloading' | 'complete' | 'error' | 'interrupted' | 'cancelled' | 'paused'
}

function effectiveIndividualLimit(mode: QueueSpeedMode, configured?: number): number {
  const presetLimit = mode === 'gentle' ? 1 : 3
  return Math.min(presetLimit, Math.max(1, Math.floor(Number(configured) || presetLimit)))
}

function orderQueue(tasks: readonly SchedulerTask[]): SchedulerTask[] {
  const groups = new Map<string, SchedulerTask[]>()
  const groupOrder: string[] = []
  const individuals: SchedulerTask[] = []
  for (const task of tasks) {
    if (task.playlistId == null) individuals.push(task)
    else {
      if (!groups.has(task.playlistId)) { groups.set(task.playlistId, []); groupOrder.push(task.playlistId) }
      groups.get(task.playlistId)!.push(task)
    }
  }
  const orderedGroups = groupOrder.flatMap((id) => groups.get(id)!.sort((a, b) => (a.playlistIndex ?? Number.MAX_SAFE_INTEGER) - (b.playlistIndex ?? Number.MAX_SAFE_INTEGER)))
  return [...orderedGroups, ...individuals]
}

/** Pure admission planner. `active` and `queued` are snapshots; returned ids are start order. */
export function planQueueAdmissions(
  active: readonly SchedulerTask[],
  queued: readonly SchedulerTask[],
  mode: QueueSpeedMode,
  configuredIndividualLimit?: number,
): string[] {
  const policy = getQueueConcurrencyPolicy(mode)
  const individualLimit = effectiveIndividualLimit(mode, configuredIndividualLimit)
  const activeTasks = active.filter((task) => task.status == null || task.status === 'downloading')
  const queuedTasks = queued.filter((task) => task.status == null || task.status === 'queued')
  const activeIndividuals = activeTasks.filter((task) => task.playlistId == null).length
  const activeByCollection = new Map<string, number>()
  for (const task of activeTasks) {
    if (task.playlistId != null) activeByCollection.set(task.playlistId, (activeByCollection.get(task.playlistId) ?? 0) + 1)
  }
  const result: string[] = []
  const admittedCollections = new Set(activeByCollection.keys())
  const initiallyActiveCollections = new Set(activeByCollection.keys())
  const remaining = orderQueue(queuedTasks)

  const admit = (task: SchedulerTask): boolean => {
    if (task.playlistId == null) {
      if (activeIndividuals + result.filter((id) => queued.find((q) => q.id === id)?.playlistId == null).length >= individualLimit) return false
      result.push(task.id)
      return true
    }
    const count = activeByCollection.get(task.playlistId) ?? 0
    if (count >= policy.collectionLimit) return false
    if (!admittedCollections.has(task.playlistId)) {
      if (admittedCollections.size >= policy.activeCollectionLimit) return false
      admittedCollections.add(task.playlistId)
    }
    activeByCollection.set(task.playlistId, count + 1)
    result.push(task.id)
    return true
  }

  // Existing collection groups get first access to their free child slots.
  for (const task of remaining) {
    if (task.playlistId != null && activeByCollection.has(task.playlistId)) admit(task)
  }
  // Individuals have their own pool and are never blocked by collection work.
  for (const task of remaining) {
    if (task.playlistId == null) admit(task)
  }
  // Then open new collection groups, retaining playlist order within each group.
  for (const task of remaining) {
    if (task.playlistId != null && !initiallyActiveCollections.has(task.playlistId)) admit(task)
  }
  return result
}
