import { AlertTriangle, Trash2 } from 'lucide-react'
import { useDialogFocus } from '@/hooks/useDialogFocus'

interface DeleteSelectionDialogProps {
  count: number
  onClose: () => void
  onConfirm: () => void
}

export function DeleteSelectionDialog({ count, onClose, onConfirm }: DeleteSelectionDialogProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)

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
        aria-labelledby="delete-selection-dialog-title"
        aria-describedby="delete-selection-dialog-description"
        className="w-[360px] rounded-panel bg-background p-6 shadow-2xl ring-1 ring-inset ring-divider-strong"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/[0.12] text-error">
            <AlertTriangle className="h-6 w-6" aria-hidden />
          </div>
          <h2 id="delete-selection-dialog-title" className="mb-2 text-lg font-semibold text-foreground">
            Remove selected downloads?
          </h2>
          <p id="delete-selection-dialog-description" className="text-sm leading-relaxed text-muted-foreground">
            This will remove {count} download{count === 1 ? '' : 's'} from the queue. Downloaded files will stay on disk.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-button bg-error/10 py-2.5 font-medium text-error transition-colors hover:bg-error/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove from list
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-lg bg-control py-2.5 font-medium text-foreground transition-colors hover:bg-state-active-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
