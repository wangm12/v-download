import { FileX, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { DialogShell } from './ui'

interface PlaylistDeleteDialogProps {
  playlistTitle: string
  videoCount: number
  onClose: () => void
  onRemoveListOnly: () => void
  onRemoveWithFiles: () => void
}

export function PlaylistDeleteDialog({
  playlistTitle,
  videoCount,
  onClose,
  onRemoveListOnly,
  onRemoveWithFiles
}: PlaylistDeleteDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)
  const handleListOnly = () => {
    onRemoveListOnly()
    onClose()
  }

  const handleWithFiles = () => {
    onRemoveWithFiles()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <DialogShell
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-delete-dialog-title"
        aria-describedby="playlist-delete-dialog-description"
        className="max-w-[400px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5">
          <h2 id="playlist-delete-dialog-title" className="text-base font-semibold text-foreground mb-2">{t('playlist.deleteTitle')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">{playlistTitle}</span>
            {' · '}
            {t(videoCount === 1 ? 'playlist.deleteCountOne' : 'playlist.deleteCount', { count: videoCount })}
          </p>
          <p id="playlist-delete-dialog-description" className="text-xs text-muted-foreground mt-3">
            {t('playlist.deleteBody')}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleListOnly}
            className="v-button-primary w-full"
          >
            <FileX className="w-4 h-4" />
            {t('playlist.removeListOnly')}
          </button>
          <button
            type="button"
            onClick={handleWithFiles}
            className="v-button-secondary w-full"
          >
            <Trash2 className="w-4 h-4" />
            {t('playlist.deleteFilesAndRemove')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="v-button-ghost w-full"
          >
            {t('common.cancel')}
          </button>
        </div>
      </DialogShell>
    </div>
  )
}
