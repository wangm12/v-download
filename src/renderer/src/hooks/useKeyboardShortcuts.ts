import { useEffect } from 'react'

interface ShortcutHandlers {
  onPaste: () => void
}

export function useKeyboardShortcuts({ onPaste }: ShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        onPaste()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onPaste])
}
