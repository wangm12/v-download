import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Monitor, Moon, PanelRightClose, PanelRightOpen, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ThemePreference } from '@/hooks/useThemePreference'
import { HoverHintWrap } from './HoverHintWrap'

const titleBarIconBtn =
  'group flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-transparent bg-raised/50 text-muted-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,background-color,box-shadow,transform] duration-panel ease-panel hover:border-border-strong hover:bg-control hover:text-foreground hover:shadow-[0_2px_8px_rgba(0,0,0,0.22)] data-[state=open]:border-border-strong active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus'

const panelGlyph = 'h-[18px] w-[18px] shrink-0 text-foreground/80 group-hover:text-foreground'

const menuContentClass =
  'z-[200] min-w-[11.5rem] overflow-hidden rounded-lg border border-border bg-raised py-1 shadow-lg'

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
  return (
    <header
      className="relative flex h-[52px] shrink-0 items-stretch border-b border-border bg-window"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
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
            text={inspectorCollapsed ? 'Show download details' : 'Hide download details'}
            side="bottom"
          >
            <button
              type="button"
              onClick={onToggleInspector}
              className={titleBarIconBtn}
              aria-expanded={!inspectorCollapsed}
              aria-label={inspectorCollapsed ? 'Show download details' : 'Hide download details'}
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
        <button type="button" className={cn(titleBarIconBtn, 'relative')} aria-label="Theme menu">
          <HoverHintWrap text="Appearance" side="bottom" className="flex size-full items-center justify-center">
            <TriggerIcon className={panelGlyph} strokeWidth={1.65} aria-hidden />
          </HoverHintWrap>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContentClass} side="bottom" align="end" sideOffset={6}>
          <DropdownMenu.Label className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground">
            Appearance
          </DropdownMenu.Label>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange('dark')}>
            <Moon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Dark</span>
            {preference === 'dark' ? <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange('light')}>
            <Sun className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Light</span>
            {preference === 'light' ? <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden /> : null}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => onChange('device')}>
            <Monitor className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Use device setting</span>
            {preference === 'device' ? <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden /> : null}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
