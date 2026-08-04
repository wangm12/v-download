export interface SelectionModifiers {
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
}

export interface SelectionState<T> {
  selected: Set<T>
  anchor: T | null
}

function hasPrimaryModifier(modifiers: SelectionModifiers): boolean {
  return Boolean(modifiers.metaKey || modifiers.ctrlKey)
}

function rangeBetween<T>(orderedIds: readonly T[], first: T, last: T): T[] {
  const firstIndex = orderedIds.indexOf(first)
  const lastIndex = orderedIds.indexOf(last)
  if (firstIndex < 0 || lastIndex < 0) return [last]
  const start = Math.min(firstIndex, lastIndex)
  const end = Math.max(firstIndex, lastIndex)
  return orderedIds.slice(start, end + 1)
}

/**
 * Applies Finder-style selection to an ordered list of selectable IDs.
 * Clicking the only selected item again clears the selection so a plain click
 * can be used to reverse a single selection.
 */
export function applySelectionClick<T>(
  orderedIds: readonly T[],
  selected: ReadonlySet<T>,
  anchor: T | null,
  id: T,
  modifiers: SelectionModifiers = {}
): SelectionState<T> {
  const next = new Set(selected)
  const additive = hasPrimaryModifier(modifiers)

  if (modifiers.shiftKey) {
    const range = rangeBetween(orderedIds, anchor ?? id, id)
    if (!additive) next.clear()
    for (const rangeId of range) next.add(rangeId)
    return { selected: next, anchor: anchor ?? id }
  }

  if (additive) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { selected: next, anchor: id }
  }

  if (next.size === 1 && next.has(id)) {
    return { selected: new Set<T>(), anchor: null }
  }

  return { selected: new Set([id]), anchor: id }
}

export function selectAllInOrder<T>(orderedIds: readonly T[], anchor: T | null = null): SelectionState<T> {
  return {
    selected: new Set(orderedIds),
    anchor: anchor && orderedIds.includes(anchor) ? anchor : orderedIds.at(-1) ?? null
  }
}

export function clearSelection<T>(): SelectionState<T> {
  return { selected: new Set<T>(), anchor: null }
}

export function retainSelection<T>(selected: ReadonlySet<T>, allowed: ReadonlySet<T>): Set<T> {
  return new Set(Array.from(selected).filter((id) => allowed.has(id)))
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null
  return Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable)
  )
}

export function isSelectAllShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a'
}

export function isFindShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f'
}

export function isRefreshShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r'
}

/** macOS Delete is reported as Backspace; forward Delete is reported as Delete. */
export function isDeleteSelectionShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return Boolean(
    (event.metaKey || event.ctrlKey) &&
      (event.key === 'Backspace' || event.key === 'Delete')
  )
}
