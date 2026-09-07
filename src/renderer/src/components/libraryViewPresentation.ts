export function libraryDeletePayload(
  mode: 'files' | 'works',
  selectedFiles: Array<{ path: string | null; downloadId: string | null }>
): { paths: string[]; recordIds: string[] } {
  const paths = selectedFiles.map((item) => item.path).filter((path): path is string => Boolean(path))
  if (mode === 'works') {
    return {
      paths,
      recordIds: selectedFiles.map((item) => item.downloadId).filter((id): id is string => Boolean(id))
    }
  }
  return {
    paths,
    recordIds: selectedFiles
      .filter((item) => item.downloadId && !item.path)
      .map((item) => item.downloadId as string)
  }
}
