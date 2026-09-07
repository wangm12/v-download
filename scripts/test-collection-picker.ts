import assert from 'node:assert/strict'
import { shouldOpenCollectionPicker } from '../src/renderer/src/utils/collectionPicker'

assert.equal(
  shouldOpenCollectionPicker('https://www.youtube.com/watch?v=5fyy9t7v304&list=PLtest'),
  false,
  'watch URL with list= is a single video'
)
assert.equal(
  shouldOpenCollectionPicker('https://youtu.be/5fyy9t7v304?list=PLtest'),
  false
)
assert.equal(
  shouldOpenCollectionPicker('https://www.youtube.com/shorts/5fyy9t7v304'),
  false
)
assert.equal(
  shouldOpenCollectionPicker('https://www.youtube.com/playlist?list=PLtest'),
  true,
  'playlist page still opens the picker'
)
assert.equal(
  shouldOpenCollectionPicker('https://space.bilibili.com/123'),
  true
)

console.log('collection picker tests passed')
