import { createContext, useContext, useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Download, DownloadActions } from '@/types'

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
  removeDownloads: (ids: string[]) => void
  downloadAgain: (download: Download) => void
}

export function DownloadActionsProvider({ children, refreshDownloads, removeDownload, removeDownloads, downloadAgain }: Props) {
  const { t } = useTranslation()
  const [deleteError, setDeleteError] = useState('')
  const reportDeleteError = useCallback((error: unknown) => {
    const message = error instanceof Error && error.message ? error.message : String(error || '')
    setDeleteError(message || t('ui.actionFailed'))
  }, [t])

  const cancel = useCallback(async (id: string) => {
    if (!window.api) return
    setDeleteError('')
    try {
      const result = await window.api.cancelDownload(id)
      if (!result.cancelled) {
        setDeleteError(t('ui.cancelFailed'))
      }
    } catch (error) {
      reportDeleteError(error)
    } finally {
      await refreshDownloads()
    }
  }, [refreshDownloads, reportDeleteError, t])

  const pause = useCallback(async (id: string) => {
    if (!window.api) return
    setDeleteError('')
    try {
      const result = await window.api.pauseDownload(id)
      if (!result.paused) {
        setDeleteError(t('ui.pauseFailed'))
      }
    } catch (error) {
      reportDeleteError(error)
    } finally {
      await refreshDownloads()
    }
  }, [refreshDownloads, reportDeleteError, t])

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
    if (!window.api) return
    setDeleteError('')
    try {
      await window.api.deleteTaskWithFiles(id)
      removeDownload(id)
    } catch (error) {
      reportDeleteError(error)
      await refreshDownloads()
    }
  }, [refreshDownloads, removeDownload, reportDeleteError])

  const removeMany = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (uniqueIds.length === 0) return
    removeDownloads(uniqueIds)
    try {
      if (window.api?.deleteTasks) {
        await window.api.deleteTasks(uniqueIds)
      } else if (window.api) {
        for (const id of uniqueIds) await window.api.deleteTask(id)
      }
    } catch {
      await refreshDownloads()
    }
  }, [removeDownloads, refreshDownloads])

  const removeManyWithFiles = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (uniqueIds.length === 0) return
    setDeleteError('')
    try {
      if (window.api?.deleteTasksWithFiles) {
        await window.api.deleteTasksWithFiles(uniqueIds)
      } else if (window.api) {
        for (const id of uniqueIds) await window.api.deleteTaskWithFiles(id)
      }
      removeDownloads(uniqueIds)
    } catch (error) {
      // The main process keeps records whose files could not be safely removed.
      // Refresh the queue so successful and partial bulk deletes are reflected.
      reportDeleteError(error)
      await refreshDownloads()
    }
  }, [removeDownloads, refreshDownloads, reportDeleteError])

  const openFolder = useCallback((path: string) => {
    window.api?.openFileLocation(path)
  }, [])

  const openFile = useCallback((path: string) => {
    window.api?.openFile(path)
  }, [])

  const actions: DownloadActions = { cancel, pause, retry, remove, removeWithFiles, removeMany, removeManyWithFiles, openFolder, openFile, downloadAgain }

  return (
    <DownloadActionsContext.Provider value={actions}>
      {children}
      {deleteError && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed bottom-4 left-4 right-4 z-[80] mx-auto flex max-w-3xl items-start justify-between gap-4 rounded-panel border border-state-error-border bg-state-error-bg px-4 py-3 text-sm text-foreground shadow-lg"
        >
          <p className="min-w-0 whitespace-pre-wrap leading-relaxed">{deleteError}</p>
          <button
            type="button"
            onClick={() => setDeleteError('')}
            className="shrink-0 rounded-button px-2 py-1 font-medium text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {t('common.dismiss')}
          </button>
        </div>
      )}
    </DownloadActionsContext.Provider>
  )
}
