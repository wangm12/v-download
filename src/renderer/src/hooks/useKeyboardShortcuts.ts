import { useEffect } from 'react'
import {
  isDeleteSelectionShortcut,
  isEditableTarget,
  isFindShortcut,
  isRefreshShortcut
} from '@/utils/selection'

interface ShortcutHandlers {
  onPaste: () => void
  onOpenPreferences?: () => void
  onFocusSearch?: () => void
  onRefresh?: () => void
  onSelectAll?: () => void
  onClearSelection?: () => void
  onDeleteSelection?: () => void
  selectionEnabled?: boolean
}

export function useKeyboardShortcuts({
  onPaste,
  onOpenPreferences,
  onFocusSearch,
  onRefresh,
  onSelectAll,
  onClearSelection,
  onDeleteSelection,
  selectionEnabled = false
}: ShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        // Text controls own Cmd/Ctrl+V. Otherwise this app-level action
        // would steal a normal paste into the downloads search field.
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onPaste()
        return
      }
      if (selectionEnabled && onFocusSearch && isFindShortcut(e)) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onFocusSearch()
        return
      }
      if (selectionEnabled && onRefresh && isRefreshShortcut(e)) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onRefresh()
        return
      }
      if (selectionEnabled && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onSelectAll?.()
        return
      }
      if (selectionEnabled && e.key === 'Escape') {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onClearSelection?.()
        return
      }
      if (selectionEnabled && onDeleteSelection && isDeleteSelectionShortcut(e)) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onDeleteSelection()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        if (!onOpenPreferences) return
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        onOpenPreferences()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    onPaste,
    onOpenPreferences,
    onFocusSearch,
    onRefresh,
    onSelectAll,
    onClearSelection,
    onDeleteSelection,
    selectionEnabled
  ])
}
