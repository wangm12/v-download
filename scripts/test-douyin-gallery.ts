import assert from 'node:assert/strict'
import {
  DOUYIN_POST_UNAVAILABLE_ERROR,
  buildDouyinGalleryFromItem,
  extFromImageUrl,
  isDouyinPostUnavailableError,
  parseDouyinPageHtml,
} from '../src/main/douyin'
import { htmlLooksHydrated } from '../src/main/douyinBrowserFetch'

const stillUrl = 'https://p3.example.com/tos-cn-i/example~tplv-aweme-images:q75.jpeg'
const motionUrl = 'https://v5.example.com/video/tos-cn-ve/example/?mime_type=video_mp4'

const motionItem = {
  awemeId: '7674114787417100774',
  authorInfo: { nickname: '沅沅' },
  images: [
    {
      urlList: [stillUrl],
      video: { playAddr: [{ src: motionUrl }] },
      livePhotoType: 1,
    },
  ],
}

const motionGallery = buildDouyinGalleryFromItem(motionItem, 'fallback')
assert.equal(motionGallery.kind, 'gallery')
assert.equal(motionGallery.id, '7674114787417100774')
assert.equal(motionGallery.author, '沅沅')
assert.deepEqual(motionGallery.imageUrls, [motionUrl])
assert.equal(motionGallery.cover, stillUrl)
assert.equal(extFromImageUrl(motionUrl), 'mp4')

const staticGallery = buildDouyinGalleryFromItem(
  { images: [{ url_list: ['https://p3.example.com/image.webp', stillUrl] }] },
  'fallback'
)
assert.deepEqual(staticGallery.imageUrls, [stillUrl])
assert.equal(extFromImageUrl(stillUrl), 'jpeg')
assert.equal(isDouyinPostUnavailableError(DOUYIN_POST_UNAVAILABLE_ERROR), true)
assert.equal(isDouyinPostUnavailableError('Chrome could not find media data for this Douyin page.'), false)

const flightPayload = `7:${JSON.stringify(['$', '$L9', null, { awemeId: motionItem.awemeId, aweme: { detail: motionItem } }])}`
const parsedFlight = parseDouyinPageHtml(
  `<script>self.__pace_f.push([1,${JSON.stringify(flightPayload)}])</script>`,
  motionItem.awemeId
)
assert.equal(parsedFlight.kind, 'gallery')
assert.deepEqual(parsedFlight.imageUrls, [motionUrl])

const staticFlightPayload = `6:${JSON.stringify(['$', '$L9', null, { images: [{ urlList: [stillUrl] }] }])}`
const preferredFlight = parseDouyinPageHtml(
  `<script>self.__pace_f.push([1,${JSON.stringify(staticFlightPayload)}])</script>` +
    `<script>self.__pace_f.push([1,${JSON.stringify(flightPayload)}])</script>`,
  motionItem.awemeId
)
assert.equal(preferredFlight.kind, 'gallery')
assert.deepEqual(preferredFlight.imageUrls, [motionUrl])

const staticRouterData = { loaderData: { staticItem: { images: [{ urlList: [stillUrl] }] } } }
const preferredAcrossSources = parseDouyinPageHtml(
  `<script>window._ROUTER_DATA = ${JSON.stringify(staticRouterData)}</script>` +
    `<script>self.__pace_f.push([1,${JSON.stringify(flightPayload)}])</script>`,
  motionItem.awemeId
)
assert.equal(preferredAcrossSources.kind, 'gallery')
assert.deepEqual(preferredAcrossSources.imageUrls, [motionUrl])

const earlyFlightHtml = `<html>${'self.__pace_f.push([1,"0:bootstrap"])'.repeat(8)}${'x'.repeat(9000)}</html>`
assert.equal(htmlLooksHydrated(earlyFlightHtml), false)
assert.equal(
  htmlLooksHydrated(
    `<html>${'self.__pace_f.push([1,"0:bootstrap"])'.repeat(8)}"awemeId":"${motionItem.awemeId}","images":[]${'x'.repeat(9000)}</html>`
  ),
  true
)

console.log('Douyin gallery motion tests passed')
