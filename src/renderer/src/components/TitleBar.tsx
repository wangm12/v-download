import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Copy, Minus, Monitor, Moon, PanelRightClose, PanelRightOpen, Square, Sun, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ThemePreference } from '@/hooks/useThemePreference'
import { useTranslation } from 'react-i18next'
import { HoverHintWrap } from './HoverHintWrap'

const titleBarIconBtn =
  'group flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-raised/50 text-muted-foreground ring-1 ring-inset ring-divider-subtle transition-[background-color,box-shadow,transform] duration-panel ease-panel hover:bg-surface-hover hover:text-foreground hover:ring-border-strong data-[state=open]:ring-border-strong active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus'

const panelGlyph = 'h-[18px] w-[18px] shrink-0 text-foreground/80 group-hover:text-foreground'

const menuContentClass =
  'z-[200] min-w-[11.5rem] overflow-hidden rounded-lg bg-raised py-1 shadow-lg ring-1 ring-inset ring-divider-strong'

const menuItemClass =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-control data-[disabled]:opacity-40'

export interface TitleBarProps {
  title?: string
  /** macOS traffic-light gutter */
  trafficInset?: boolean
  showInspectorToggle?: boolean
  inspectorCollapsed?: boolean
  inspectorAvailable?: boolean
  onToggleInspector?: () => void
  themePreference: ThemePreference
  onThemePreference: (value: ThemePreference) => void
  resolvedTheme: 'dark' | 'light'
}

export function TitleBar({
  title = 'V-Download',
  trafficInset = false,
  showInspectorToggle = false,
  inspectorCollapsed = false,
  inspectorAvailable = true,
  onToggleInspector,
  themePreference,
  onThemePreference,
  resolvedTheme
}: TitleBarProps) {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (trafficInset) return
    let mounted = true
    window.api?.isWindowMaximized?.().then((max) => {
      if (mounted) setIsMaximized(Boolean(max))
    })
    const unsub = window.api?.onWindowMaximizeChanged?.((max) => {
      if (mounted) setIsMaximized(Boolean(max))
    })
    return () => {
      mounted = false
      unsub?.()
    }
  }, [trafficInset])

  const onMinimize = () => {
    void window.api?.minimizeWindow?.()
  }

  const onMaximize = () => {
    void window.api?.maximizeWindow?.().then((max) => setIsMaximized(Boolean(max)))
  }

  const onClose = () => {
    void window.api?.closeWindow?.()
  }

  return (
    <header
      className="relative flex h-[52px] shrink-0 items-stretch border-b border-border bg-window select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget && !trafficInset) {
          onMaximize()
        }
      }}
    >
      <div
        className={cn('flex h-full shrink-0 items-center', trafficInset ? 'w-[76px]' : 'w-3')}
        aria-hidden
      />

      <div className="pointer-events-none flex h-full min-w-0 flex-1 items-center justify-center px-2">
        <span className="truncate text-center text-[13px] font-semibold leading-none tracking-tight text-foreground">
          {title}
        </span>
      </div>

      <div
        className="flex h-full shrink-0 items-center gap-1 pr-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showInspectorToggle && inspectorAvailable && onToggleInspector && (
          <HoverHintWrap
            text={inspectorCollapsed ? t('inspector.showInspector') : t('inspector.hideInspector')}
            side="bottom"
          >
            <button
              type="button"
              onClick={onToggleInspector}
              className={titleBarIconBtn}
              aria-expanded={!inspectorCollapsed}
              aria-label={inspectorCollapsed ? t('inspector.showInspector') : t('inspector.hideInspector')}
            >
              {inspectorCollapsed ? (
                <PanelRightOpen className={panelGlyph} strokeWidth={1.65} aria-hidden />
              ) : (
                <PanelRightClose className={panelGlyph} strokeWidth={1.65} aria-hidden />
              )}
            </button>
          </HoverHintWrap>
        )}

        <ThemeMenuButton
          preference={themePreference}
          onChange={onThemePreference}
          resolvedTheme={resolvedTheme}
        />

        {!trafficInset && (
          <div className="flex h-full items-center gap-1 border-l border-border/50 pl-1.5 ml-0.5">
            <HoverHintWrap text={t('window.minimize', 'Minimize')} side="bottom">
              <button
                type="button"
                onClick={onMinimize}
                className={titleBarIconBtn}
                aria-label={t('window.minimize', 'Minimize')}
              >
                <Minus className="h-4 w-4" />
              </button>
            </HoverHintWrap>
            <HoverHintWrap
              text={isMaximized ? t('window.restore', 'Restore') : t('window.maximize', 'Maximize')}
              side="bottom"
            >
              <button
                type="button"
                onClick={onMaximize}
                className={titleBarIconBtn}
                aria-label={isMaximized ? t('window.restore', 'Restore') : t('window.maximize', 'Maximize')}
              >
                {isMaximized ? <Copy className="h-3.5 w-3.5 rotate-90" /> : <Square className="h-3.5 w-3.5" />}
              </button>
            </HoverHintWrap>
            <HoverHintWrap text={t('window.close', 'Close')} side="bottom">
              <button
                type="button"
                onClick={onClose}
                className={cn(titleBarIconBtn, 'hover:bg-destructive hover:text-destructive-foreground hover:ring-destructive')}
                aria-label={t('window.close', 'Close')}
              >
                <X className="h-4 w-4" />
              </button>
            </HoverHintWrap>
          </div>
        )}
      </div>
    </header>
  )
}

function ThemeMenuButton({
  preference,
  onChange,
  resolvedTheme
}: {
  preference: ThemePreference
  onChange: (v: ThemePreference) => void
  resolvedTheme: 'dark' | 'light'
}) {
  const { t } = useTranslation()
  const TriggerIcon =
    preference === 'device'
      ? resolvedTheme === 'light'
        ? Sun
        : Moon
      : preference === 'light'
        ? Sun
        : Moon

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={cn(titleBarIconBtn, 'relative')} aria-label={t('theme.themeMenu')}>
          <HoverHintWrap text={t('theme.appearance')} side="bottom" className="flex size-full items-center justify-center">
            <TriggerIcon className={panelGlyph} strokeWidth={1.65} aria-hidden />
          </HoverHintWrap>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContentClass} side="bottom" align="end" sideOffset={6}>
          <DropdownMenu.Label className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground">
            {t('theme.appearance')}
          </DropdownMenu.Label>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange('device')}>
            <Monitor className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{t('theme.system')}</span>
            {preference === 'device' ? <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange('dark')}>
            <Moon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{t('theme.dark')}</span>
            {preference === 'dark' ? <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange('light')}>
            <Sun className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{t('theme.light')}</span>
            {preference === 'light' ? <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden /> : null}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
