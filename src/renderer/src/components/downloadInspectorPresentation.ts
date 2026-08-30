export const DOWNLOAD_DETAILS_LABEL = 'Download details'
export const DOWNLOAD_DETAILS_RAIL_CLASS = 'lg:static lg:h-full lg:w-[328px] lg:shrink-0'

export function shouldRenderDownloadDetails(downloadId: string | null, collapsed: boolean): boolean {
  return Boolean(downloadId) && !collapsed
}

export function shouldOpenDownloadDetails(previousId: string | null, nextId: string | null): boolean {
  return Boolean(nextId) && previousId !== nextId
}

export function revealFolderLabel(platform?: string): string {
  return platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder'
}

export function getInspectorStatCells(input: {
  durationLabel: string | null
  sizeLabel: string | null
  formatLabel: string | null
}): Array<{ label: string; value: string }> {
  return [
    { label: 'Duration', value: input.durationLabel || '—' },
    { label: 'Size', value: input.sizeLabel || '—' },
    { label: 'Format', value: input.formatLabel || '—' }
  ]
}
