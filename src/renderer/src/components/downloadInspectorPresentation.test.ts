import {
  DOWNLOAD_DETAILS_LABEL,
  DOWNLOAD_DETAILS_RAIL_CLASS,
  shouldOpenDownloadDetails,
  shouldRenderDownloadDetails
} from './downloadInspectorPresentation'

const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

expect(DOWNLOAD_DETAILS_LABEL === 'Download details', 'details label must be user-facing')
expect(!shouldRenderDownloadDetails(null, false), 'no selection must hide details')
expect(shouldRenderDownloadDetails('download-1', false), 'selection must render details')
expect(!shouldRenderDownloadDetails('download-1', true), 'manual close must keep details hidden')
expect(shouldOpenDownloadDetails(null, 'download-1'), 'first selection must open details')
expect(!shouldOpenDownloadDetails('download-1', 'download-1'), 'rerender must not reopen details')
expect(shouldOpenDownloadDetails('download-1', 'download-2'), 'new selection must reopen details')
expect(
  !shouldRenderDownloadDetails('download-1', true) && !shouldOpenDownloadDetails('download-1', 'download-1'),
  'manual close followed by same-id rerender must stay closed'
)
expect(DOWNLOAD_DETAILS_RAIL_CLASS.includes('lg:w-[328px]'), 'desktop rail width policy missing')

console.log('Download details presentation state passed')
