export const DOWNLOAD_DETAILS_LABEL = 'Download details'
export const DOWNLOAD_DETAILS_RAIL_CLASS = 'lg:static lg:h-full lg:w-[328px] lg:shrink-0'

export function shouldRenderDownloadDetails(downloadId: string | null, collapsed: boolean): boolean {
  return Boolean(downloadId) && !collapsed
}

export function shouldOpenDownloadDetails(previousId: string | null, nextId: string | null): boolean {
  return Boolean(nextId) && previousId !== nextId
}
