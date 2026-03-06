import { Play, Pause, Settings, Trash2, ArrowDown } from 'lucide-react'

interface BottomBarProps {
  statusText: string
  totalSpeed: string | null
  hasResumable: boolean
  hasActive: boolean
  hasDownloads: boolean
  onResumeAll: () => void
  onPauseAll: () => void
  onSettings: () => void
  onClear: () => void
}

export function BottomBar({ statusText, totalSpeed, hasResumable, hasActive, hasDownloads, onResumeAll, onPauseAll, onSettings, onClear }: BottomBarProps) {
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

      <button
        onClick={onSettings}
        className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>
    </footer>
  )
}
