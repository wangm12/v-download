import { AlertTriangle, CircleCheck, Trash2 } from 'lucide-react'

interface ClearDialogProps {
  onClose: () => void
  onClearCompleted: () => void
  onClearAll: () => void
}

export function ClearDialog({ onClose, onClearCompleted, onClearAll }: ClearDialogProps) {
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
    >
      <div
        className="w-[340px] bg-background rounded-2xl shadow-2xl p-6 border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full border border-dashed border-border-strong bg-state-error-bg flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Clear Downloads</h2>
          <p className="text-sm text-muted-foreground">
            This will remove tasks from the list. Downloaded files will not be deleted.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleClearCompleted}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-action text-action-fg font-medium hover:bg-action-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <CircleCheck className="w-4 h-4" />
            Remove Completed Tasks
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border-strong bg-transparent text-foreground font-medium hover:bg-state-error-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <Trash2 className="w-4 h-4" />
            Remove All Tasks
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-control text-foreground font-medium hover:bg-state-active-bg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
