import { useEffect } from 'react'

interface ShortcutHandlers {
  onPaste: () => void
  onOpenPreferences?: () => void
}

export function useKeyboardShortcuts({ onPaste, onOpenPreferences }: ShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        onPaste()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        if (!onOpenPreferences) return
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          return
        }
        e.preventDefault()
        onOpenPreferences()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onPaste, onOpenPreferences])
}
