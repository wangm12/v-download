import {
  COMPACT_HASH,
  COMPACT_WINDOW_TITLE,
  compactActiveDownloads,
  compactProgressLine,
  isCompactHash,
  oneShotClipboardFill
} from './compactViewPresentation'

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

equal(isCompactHash('#/compact'), true)
equal(isCompactHash('#/settings'), false)
equal(isCompactHash(''), false)
equal(COMPACT_HASH, '#/compact')
equal(COMPACT_WINDOW_TITLE, 'V-Download Mini')

equal(
  compactActiveDownloads([
    { status: 'downloading' },
    { status: 'complete' },
    { status: 'queued' },
    { status: 'error' },
    { status: 'resolving' }
  ]).map((item) => item.status),
  ['downloading', 'queued', 'resolving']
)

equal(compactProgressLine({ progress: 62, eta: '01:34 left' }), '62% 01:34 left')
equal(compactProgressLine({ progress: 38, eta: null }), '38%')

equal(oneShotClipboardFill('', 'https://www.youtube.com/watch?v=abc', (text) => text), 'https://www.youtube.com/watch?v=abc')
equal(oneShotClipboardFill('https://already.example/', 'https://www.youtube.com/watch?v=abc', (text) => text), 'https://already.example/')
equal(oneShotClipboardFill('', 'not a link', () => null), '')

console.log('compact view presentation tests passed')
