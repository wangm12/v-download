import {
  getCollectionPresentation,
  getDisclosureState
} from './playlistGroupPresentation'

const equal = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(actual)}`
    )
}

const deepEqual = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label}: values differ`)
}

const cases: Array<[string, () => void]> = [
  [
    'collection preview shows remaining items after four thumbnails',
    () => {
      equal(
        getCollectionPresentation(8, 2, 4).overflowCount,
        4,
        '8-item overflow'
      )
      equal(
        getCollectionPresentation(345, 4, 4).overflowCount,
        341,
        '345-item overflow'
      )
    }
  ],
  [
    'collection without thumbnails still reports all items as overflow',
    () => {
      const presentation = getCollectionPresentation(6, 0, 4)
      equal(presentation.overflowCount, 2, 'fallback overflow')
      equal(presentation.hasMoreItems, true, 'more items')
    }
  ],
  [
    'five-item boundary is expanded and has no more items',
    () => {
      const presentation = getCollectionPresentation(5, 3, 2)
      equal(presentation.defaultExpanded, true, 'default expanded')
      equal(presentation.hasMoreItems, false, 'no more items')
      equal(presentation.remaining, 2, 'remaining')
    }
  ],
  [
    'status and remaining values are derived from counts',
    () => {
      deepEqual(
        getCollectionPresentation(10, 10, 4),
        {
          remaining: 0,
          overflowCount: 6,
          hasMoreItems: true,
          defaultExpanded: false
        },
        'complete presentation'
      )
    }
  ],
  [
    'disclosure keeps the preview capped until show all is explicitly requested',
    () => {
      equal(
        getDisclosureState(false, false).visibleCount,
        5,
        'collapsed preview'
      )
      equal(getDisclosureState(true, false).visibleCount, 5, 'expanded preview')
      equal(getDisclosureState(true, true).visibleCount, Infinity, 'show all')
    }
  ]
]

for (const [name, run] of cases) {
  run()
  console.log(`PASS ${name}`)
}
