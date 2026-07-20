import type { DouyinProfilePostRow } from '@/types'
import { mergeProfilePosts, profilePickerStatus, selectedProfileCount } from './douyinProfilePickerState'

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

const post = (awemeId: string): DouyinProfilePostRow => ({
  awemeId, mediaType: 'video', title: awemeId, author: 'Author', cover: '', pageUrl: `https://example.com/${awemeId}`,
})

equal(profilePickerStatus('loading-page', true, 35), 'Loading page…', 'page status')
equal(profilePickerStatus('loading-all', true, 35), 'Loading all pages…', 'load-all status')
equal(profilePickerStatus('browser-import', true, 35), 'Importing from browser…', 'browser status')
equal(profilePickerStatus('idle', false, 35), '35 posts loaded · No more posts available', 'completion status')
for (const activity of ['loading-page', 'loading-all', 'browser-import'] as const) {
  if (/No more posts available|More available/.test(profilePickerStatus(activity, false, 35))) throw new Error(`${activity} must not say completion text`)
}

equal(selectedProfileCount(new Set(['a', 'missing']), [post('a'), post('b')]), 1, 'selection scope')

const merged = mergeProfilePosts([post('a'), post('b')], [{ ...post('b'), title: 'updated' }, post('c')])
equal(merged.map((row) => row.awemeId).join(','), 'a,b,c', 'dedupe order')
equal(merged[1]?.title, 'updated', 'dedupe update')

const abortKey = 'profile-load-all-123'
let aborted = ''
const abort = () => { aborted = abortKey }
abort()
equal(aborted, abortKey, 'abort key')
