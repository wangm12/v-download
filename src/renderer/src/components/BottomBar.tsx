import { Play, Pause, Settings, Trash2, ArrowDown, RefreshCw, Loader2 } from 'lucide-react'

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
  onSettings: () => void
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
  onSettings,
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
      className="h-10 flex-shrink-0 relative flex items-center px-4 bg-elevated border-t border-border"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onResumeAll}
          className={`p-1.5 rounded-md transition-colors ${
            hasResumable
              ? 'text-muted-foreground hover:text-accent-green hover:bg-surface'
              : 'text-muted-foreground/40 cursor-default'
          }`}
          title="Start all downloads"
          disabled={!hasResumable}
        >
          <Play className="w-4 h-4" />
        </button>
        <button
          onClick={onPauseAll}
          className={`p-1.5 rounded-md transition-colors ${
            hasActive
              ? 'text-muted-foreground hover:text-accent-amber hover:bg-surface'
              : 'text-muted-foreground/40 cursor-default'
          }`}
          title="Pause all downloads"
          disabled={!hasActive}
        >
          <Pause className="w-4 h-4" />
        </button>
        <button
          onClick={onClear}
          disabled={!hasDownloads}
          className={`p-1.5 rounded-md transition-colors ${
            hasDownloads
              ? 'text-muted-foreground hover:text-accent-coral hover:bg-surface'
              : 'text-muted-foreground/40 cursor-default'
          }`}
          title="Clear downloads"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{statusText}</span>
          {totalSpeed && (
            <span className="flex items-center gap-1 text-xs text-accent-green tabular-nums">
              <ArrowDown className="w-3 h-3" />
              {totalSpeed}
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {onSyncCookies && (
          <button
            type="button"
            onClick={onSyncCookies}
            disabled={syncCookiesBusy}
            className={`flex items-center gap-1.5 rounded-md pl-1.5 pr-2 py-1 transition-colors ${
              syncCookiesBusy
                ? 'text-accent-indigo cursor-wait ring-1 ring-inset ring-accent-indigo/35 bg-accent-indigo/5'
                : 'text-muted-foreground hover:text-accent-indigo hover:bg-surface'
            }`}
            title={syncTitle}
            aria-busy={syncCookiesBusy}
            aria-label={syncTitle}
          >
            {syncCookiesBusy ? (
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-accent-indigo" aria-hidden />
            ) : (
              <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
            )}
            {syncShortLabel && (
              <span className="text-[11px] font-medium text-accent-indigo tabular-nums max-w-[4.25rem] truncate">
                {syncShortLabel}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onSettings}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </footer>
  )
}
