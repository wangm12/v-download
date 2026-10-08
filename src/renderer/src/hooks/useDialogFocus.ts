import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'summary',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

export function visibleDialogControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => {
      if (element.tabIndex < 0 || element.getClientRects().length === 0) return false
      // Chromium can retain layout boxes for controls inside closed disclosures.
      for (let parent = element.parentElement; parent && parent !== dialog; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open && element.parentElement !== parent) return false
        if (parent instanceof HTMLDetailsElement && !parent.open && element.tagName !== 'SUMMARY') return false
      }
      return true
    })
}

/** Gives small custom dialogs the same Escape, focus-trap and focus-restore behavior. */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null)
  const closeRef = useRef(onClose)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusInitial = () => {
      const first = dialog ? visibleDialogControls(dialog)[0] : null
      ;(first || dialog)?.focus()
    }
    const frame = window.requestAnimationFrame(focusInitial)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = visibleDialogControls(dialog)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [])

  return dialogRef
}
