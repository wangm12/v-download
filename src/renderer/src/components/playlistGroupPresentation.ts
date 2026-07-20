export const COLLECTION_PREVIEW_LIMIT = 4
export const COLLECTION_VISIBLE_LIMIT = 5

export function getCollectionPresentation(
  total: number,
  completed: number,
  representativeCount: number
) {
  const remaining = Math.max(0, total - completed)
  return {
    remaining,
    overflowCount: Math.max(0, total - representativeCount),
    hasMoreItems: total > COLLECTION_VISIBLE_LIMIT,
    defaultExpanded: total <= COLLECTION_VISIBLE_LIMIT
  } as const
}

export function getDisclosureState(expanded: boolean, showAll: boolean) {
  return {
    expanded,
    showAll,
    visibleCount: showAll ? Infinity : COLLECTION_VISIBLE_LIMIT
  }
}
