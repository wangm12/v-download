import { Play, Pause, Trash2, ArrowDown, RefreshCw, Loader2 } from 'lucide-react'
import { HoverHintWrap } from './HoverHintWrap'
import type { CSSProperties } from 'react'

interface BottomBarProps {
  statusText: string
  totalSpeed: string | null
  hasResumable: boolean
  hasActive: boolean
  hasDownloads: boolean
  onResumeAll: () => void
  onPauseAll: () => void
  onSyncCookies?: () => void
  /** True while waiting for the browser / extension to finish syncing */
  syncCookiesBusy?: boolean
  /** Finer phase for tooltip / short label */
  syncCookiesPhase?: 'opening' | 'waiting' | null
  onClear: () => void
}

export function BottomBar({
  statusText,
  totalSpeed,
  hasResumable,
  hasActive,
  hasDownloads,
  onResumeAll,
  onPauseAll,
  onSyncCookies,
  syncCookiesBusy = false,
  syncCookiesPhase = null,
  onClear,
}: BottomBarProps) {
  const syncTitle =
    syncCookiesPhase === 'opening'
      ? 'Opening browser…'
      : syncCookiesPhase === 'waiting'
        ? 'Waiting for Chrome — finish the sync tab or leave Chrome open'
        : 'Sync cookies from Chrome (all supported sites)'
  const syncShortLabel =
    syncCookiesPhase === 'opening' ? 'Opening…' : syncCookiesPhase === 'waiting' ? 'Waiting…' : null
  return (
    <footer
      className="h-11 flex-shrink-0 relative flex items-center px-4 bg-window border-t border-divider-subtle"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <div className="flex items-center gap-2">
        <HoverHintWrap text="Start all downloads">
          <button
            type="button"
            onClick={onResumeAll}
            className={`min-h-11 min-w-11 p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
              hasResumable
                ? 'text-muted-foreground hover:text-foreground hover:bg-control'
                : 'text-muted-foreground/40 cursor-default'
            }`}
            aria-label="Start all downloads"
            disabled={!hasResumable}
          >
            <Play className="w-4 h-4" aria-hidden />
          </button>
        </HoverHintWrap>
        <HoverHintWrap text="Pause all downloads">
          <button
            type="button"
            onClick={onPauseAll}
            className={`min-h-11 min-w-11 p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
              hasActive
                ? 'text-muted-foreground hover:text-foreground hover:bg-control'
                : 'text-muted-foreground/40 cursor-default'
            }`}
            aria-label="Pause all downloads"
            disabled={!hasActive}
          >
            <Pause className="w-4 h-4" aria-hidden />
          </button>
        </HoverHintWrap>
        <HoverHintWrap text="Clear downloads">
          <button
            type="button"
            onClick={onClear}
            disabled={!hasDownloads}
            className={`min-h-11 min-w-11 p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
              hasDownloads
                ? 'text-muted-foreground hover:text-foreground hover:bg-control'
                : 'text-muted-foreground/40 cursor-default'
            }`}
            aria-label="Clear downloads"
          >
            <Trash2 className="w-4 h-4" aria-hidden />
          </button>
        </HoverHintWrap>
      </div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex min-w-0 max-w-[45%] items-center gap-3">
          <span className="truncate text-xs text-muted-foreground">{statusText}</span>
          {totalSpeed && (
            <span className="flex items-center gap-1 text-xs text-foreground tabular-nums">
              <ArrowDown className="w-3 h-3 text-muted-foreground" />
              {totalSpeed}
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {onSyncCookies && (
          <HoverHintWrap text={syncTitle}>
            <button
              type="button"
              onClick={onSyncCookies}
              disabled={syncCookiesBusy}
              className={`min-h-11 min-w-11 max-w-full flex items-center justify-center gap-1.5 rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${
                syncCookiesBusy
                  ? 'text-foreground cursor-wait ring-1 ring-inset ring-accent/35 bg-selection'
                  : 'text-muted-foreground hover:text-foreground hover:bg-control active:text-foreground'
              }`}
              aria-busy={syncCookiesBusy}
              aria-label={syncTitle}
            >
              {syncCookiesBusy ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin text-foreground" aria-hidden />
              ) : (
                <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
              )}
              {syncShortLabel && (
                <span className="text-[11px] font-medium text-foreground tabular-nums max-w-[4.25rem] truncate">
                  {syncShortLabel}
                </span>
              )}
            </button>
          </HoverHintWrap>
        )}
      </div>
    </footer>
  )
}
