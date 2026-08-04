import { AlertTriangle, FileX, Trash2 } from 'lucide-react'
import { useDialogFocus } from '@/hooks/useDialogFocus'

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-delete-dialog-title"
        aria-describedby="playlist-delete-dialog-description"
        className="w-[360px] rounded-panel bg-background p-6 shadow-2xl ring-1 ring-inset ring-divider-strong"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-error/[0.12] text-error flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 id="playlist-delete-dialog-title" className="text-lg font-semibold text-foreground mb-2">Remove playlist</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">{playlistTitle}</span>
            {' · '}
            {videoCount} video{videoCount !== 1 ? 's' : ''}
          </p>
          <p id="playlist-delete-dialog-description" className="text-xs text-muted-foreground mt-3">
            Choose whether to keep downloaded files on disk or delete them as well.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleListOnly}
            className="w-full min-h-11 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-action text-action-fg font-medium hover:bg-action-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <FileX className="w-4 h-4" />
            Remove from list only
          </button>
          <button
            type="button"
            onClick={handleWithFiles}
            className="w-full min-h-11 flex items-center justify-center gap-2 py-2.5 rounded-button bg-error/10 text-error font-medium hover:bg-error/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Trash2 className="w-4 h-4" />
            Delete files and remove
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-11 py-2.5 rounded-lg bg-control text-foreground font-medium hover:bg-state-active-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
