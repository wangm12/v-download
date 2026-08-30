import { AlertTriangle, CircleCheck, Trash2 } from 'lucide-react'
import { useDialogFocus } from '@/hooks/useDialogFocus'

interface ClearDialogProps {
  onClose: () => void
  onClearCompleted: () => void
  onClearAll: () => void
}

export function ClearDialog({ onClose, onClearCompleted, onClearAll }: ClearDialogProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)
  const handleClearCompleted = () => {
    onClearCompleted()
    onClose()
  }

  const handleClearAll = () => {
    onClearAll()
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
        aria-labelledby="clear-dialog-title"
        aria-describedby="clear-dialog-description"
        className="w-[340px] rounded-panel bg-background p-6 shadow-2xl ring-1 ring-inset ring-divider-strong"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-state-error-bg text-foreground flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 id="clear-dialog-title" className="text-lg font-semibold text-foreground mb-2">Clear Downloads</h2>
          <p id="clear-dialog-description" className="text-sm text-muted-foreground">
            This will remove tasks from the list. Downloaded files will not be deleted.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleClearCompleted}
            className="w-full min-h-11 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-action text-action-fg font-medium hover:bg-action-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <CircleCheck className="w-4 h-4" />
            Remove Completed Tasks
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="w-full min-h-11 flex items-center justify-center gap-2 py-2.5 rounded-button border border-dashed border-border-strong bg-control text-foreground font-medium hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Trash2 className="w-4 h-4" />
            Remove All Tasks
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
