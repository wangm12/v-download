import { CircleCheck, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { DialogShell } from './ui'

interface ClearDialogProps {
  onClose: () => void
  onClearCompleted: () => void
  onClearAll: () => void
}

export function ClearDialog({ onClose, onClearCompleted, onClearAll }: ClearDialogProps) {
  const { t } = useTranslation()
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <DialogShell
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-dialog-title"
        aria-describedby="clear-dialog-description"
        className="max-w-[400px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5">
          <h2 id="clear-dialog-title" className="text-base font-semibold text-foreground mb-2">{t('clear.title')}</h2>
          <p id="clear-dialog-description" className="text-sm text-muted-foreground">
            {t('clear.description')}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleClearCompleted}
            className="v-button-primary w-full"
          >
            <CircleCheck className="w-4 h-4" />
            {t('clear.removeCompleted')}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="v-button-secondary w-full"
          >
            <Trash2 className="w-4 h-4" />
            {t('clear.removeAll')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="v-button-ghost w-full"
          >
            {t('clear.cancel')}
          </button>
        </div>
      </DialogShell>
    </div>
  )
}
