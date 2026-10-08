import { Trash2 } from 'lucide-react'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { useTranslation } from 'react-i18next'
import { DialogShell } from './ui'

interface DeleteSelectionDialogProps {
  count: number
  onClose: () => void
  onConfirm: () => void
}

export function DeleteSelectionDialog({ count, onClose, onConfirm }: DeleteSelectionDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="presentation">
      <DialogShell ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="delete-selection-dialog-title" aria-describedby="delete-selection-dialog-description"
        className="max-w-[400px] p-5" onClick={(event) => event.stopPropagation()}>
        <h2 id="delete-selection-dialog-title" className="text-base font-semibold">{t('ui.deleteSelection')}</h2>
        <p id="delete-selection-dialog-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(count === 1 ? 'ui.deleteSelectionBodyOne' : 'ui.deleteSelectionBody', { count })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="v-button-ghost">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} className="v-button-primary"><Trash2 className="h-4 w-4" aria-hidden />{t('queue.removeFromList')}</button>
        </div>
      </DialogShell>
    </div>
  )
}
