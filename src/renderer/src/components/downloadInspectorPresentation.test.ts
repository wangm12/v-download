import {
  DOWNLOAD_DETAILS_LABEL,
  DOWNLOAD_DETAILS_RAIL_CLASS,
  getInspectorStatCells,
  inspectorDestination,
  revealFolderLabel,
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
expect(revealFolderLabel('darwin') === 'Reveal in Finder', 'macOS must use Finder wording')
expect(revealFolderLabel('win32') === 'Show in folder', 'Windows must use folder wording')
expect(
  JSON.stringify(getInspectorStatCells({ durationLabel: '12:01', sizeLabel: null, formatLabel: 'mp4 · 1080' })) ===
    JSON.stringify([
      { label: 'Duration', value: '12:01' },
      { label: 'Format', value: 'mp4 · 1080' }
    ]),
  'inspector stats must omit unknown metrics'
)

expect(getInspectorStatCells({ durationLabel: null, sizeLabel: null, formatLabel: null }).length === 0, 'no metadata must render no metrics')

const pendingDestination = inspectorDestination(null, '/custom/plan/author', '/default/changed')
expect(pendingDestination.destination === '/custom/plan/author' && pendingDestination.folderName === 'plan/author', 'effective task folder must win over global preferences before a file is published')
expect(inspectorDestination('/published/final/movie.mp4', '/custom/plan', '/default').folderName === 'published/final', 'published file is authoritative after completion')
expect(inspectorDestination(null, undefined, '/legacy/default').destination === '/legacy/default', 'legacy payload fallback must remain compatible')
expect(inspectorDestination('C:\\Saved\\Author\\movie.mp4', 'D:\\old', 'D:\\default').folderName === 'Saved\\Author', 'Windows path display must retain its directory')
expect(inspectorDestination('/media/name\\with-backslash/file.mp4', null, '').folderName === 'media/name\\with-backslash', 'POSIX backslashes are filename characters')
expect(inspectorDestination('/movie.mp4', null, '').folderName === '/', 'filesystem root must remain visible')
expect(inspectorDestination('C:\\movie.mp4', null, '').folderName === 'C:\\', 'Windows root must remain visible')

console.log('Download details presentation state passed')
