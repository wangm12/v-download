import { createContext, useContext, useCallback, type ReactNode } from 'react'
import type { DownloadActions } from '@/types'
import { useDownloads } from '@/hooks/useDownloads'

const DownloadActionsContext = createContext<DownloadActions | null>(null)

export function useDownloadActions(): DownloadActions {
  const ctx = useContext(DownloadActionsContext)
  if (!ctx) throw new Error('useDownloadActions must be used within DownloadActionsProvider')
  return ctx
}

interface Props {
  children: ReactNode
  refreshDownloads: () => Promise<void>
  removeDownload: (id: string) => void
  updateDownload: (id: string, updates: Record<string, unknown>) => void
}

export function DownloadActionsProvider({ children, refreshDownloads, removeDownload, updateDownload }: Props) {
  const cancel = useCallback(async (id: string) => {
    if (window.api) await window.api.cancelDownload(id)
    updateDownload(id, { status: 'cancelled' })
  }, [updateDownload])

  const pause = useCallback(async (id: string) => {
    if (window.api) await window.api.pauseDownload(id)
    updateDownload(id, { status: 'paused' })
  }, [updateDownload])

  const retry = useCallback(async (id: string) => {
    if (window.api) {
      await window.api.retryDownload(id)
      refreshDownloads()
    }
  }, [refreshDownloads])

  const remove = useCallback(async (id: string) => {
    if (window.api) await window.api.deleteTask(id)
    removeDownload(id)
  }, [removeDownload])

  const removeWithFiles = useCallback(async (id: string) => {
    if (window.api) await window.api.deleteTaskWithFiles(id)
    removeDownload(id)
  }, [removeDownload])

  const openFolder = useCallback((path: string) => {
    window.api?.openFileLocation(path)
  }, [])

  const openFile = useCallback((path: string) => {
    window.api?.openFile(path)
  }, [])

  const actions: DownloadActions = { cancel, pause, retry, remove, removeWithFiles, openFolder, openFile }

  return (
    <DownloadActionsContext.Provider value={actions}>
      {children}
    </DownloadActionsContext.Provider>
  )
}
