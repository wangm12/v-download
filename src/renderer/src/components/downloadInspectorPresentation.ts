export const DOWNLOAD_DETAILS_LABEL = 'Download details'
export const DOWNLOAD_DETAILS_RAIL_CLASS = 'lg:static lg:h-full lg:w-[328px] lg:shrink-0'

export function inspectorDestination(filePath: string | null, outputDir: string | null | undefined, defaultDir: string) {
  const destination = filePath || outputDir || defaultDir
  const windowsPath = /^(?:[a-z]:[\\/]|\\\\)/i.test(destination)
  const separator = windowsPath ? /[\\/]/ : /\//
  const parts = destination.split(separator)
  const fileName = filePath ? parts.pop() : undefined
  const folder = filePath ? destination.slice(0, destination.length - (fileName?.length ?? 0)).replace(windowsPath ? /[\\/]+$/ : /\/+$/, '') : destination
  const root = windowsPath ? destination.slice(0, 3) : '/'
  return { destination, fileName, folderName: folder === '' || /^[a-z]:$/i.test(folder) ? root : folder.split(separator).filter(Boolean).slice(-2).join(windowsPath ? '\\' : '/') || folder }
}

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
    { label: 'Duration', value: input.durationLabel || '' },
    { label: 'Size', value: input.sizeLabel || '' },
    { label: 'Format', value: input.formatLabel || '' }
  ].filter((cell) => Boolean(cell.value))
}
