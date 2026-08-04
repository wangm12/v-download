import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Globe,
  Settings,
  Download,
  LayoutGrid,
  SlidersHorizontal,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { PrefSection } from '@/preferencesNav'
import { PREF_SECTION_ADVANCED, PREF_SECTION_PRIMARY } from '@/preferencesNav'
import { HoverHintWrap } from './HoverHintWrap'

const APP_ICON_SRC = `${import.meta.env.BASE_URL}app-icon.png`

export type AppMainView = 'downloads' | 'preferences'

interface AppSidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  mainView: AppMainView
  prefSection: PrefSection
  onSelectQueue: () => void
  onSelectPrefSection: (id: PrefSection) => void
}

function prefPrimaryIcon(id: (typeof PREF_SECTION_PRIMARY)[number]['id']): LucideIcon {
  switch (id) {
    case 'general':
      return Settings
    case 'downloads':
      return Download
    case 'browser':
      return Globe
    case 'sites':
      return LayoutGrid
  }
  return Settings
}

function NavRow({
  active,
  onClick,
  children,
  icon: Icon
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  icon: LucideIcon
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left text-sm py-2 px-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar inline-flex items-center gap-2',
        active
          ? 'bg-action text-action-fg font-medium'
          : 'text-muted-foreground hover:bg-control hover:text-foreground'
      )}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden />
      {children}
    </button>
  )
}

function IconNavButton({
  active,
  onClick,
  icon: Icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
}) {
  return (
    <HoverHintWrap text={label} side="right">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-[transform,colors] duration-200 ease-out hover:scale-[1.04] active:scale-[0.96] motion-reduce:hover:scale-100 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          active
            ? 'bg-action text-action-fg'
            : 'text-muted-foreground hover:bg-control hover:text-foreground'
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </button>
    </HoverHintWrap>
  )
}

const panelIconClass = 'h-[18px] w-[18px] shrink-0 text-foreground/80 transition-[color,transform] duration-200 ease-out group-hover:text-foreground'

const toggleIconBtn =
  'group flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised/50 text-muted-foreground ring-1 ring-inset ring-divider-subtle transition-[background-color,box-shadow,transform] duration-panel ease-panel hover:bg-surface-hover hover:text-foreground hover:ring-accent/40 hover:shadow-[0_6px_18px_rgb(0_0_0/0.18)] active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus'

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mainView,
  prefSection,
  onSelectQueue,
  onSelectPrefSection
}: AppSidebarProps) {
  const queueActive = mainView === 'downloads'

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col border-r border-border bg-sidebar py-4 min-h-0 overflow-x-hidden transition-[width,padding,gap] duration-panel ease-panel motion-reduce:transition-none',
        collapsed ? 'w-14 px-1.5 gap-2' : 'w-[244px] px-3 gap-4'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <img
            src={APP_ICON_SRC}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-divider-subtle"
            draggable={false}
            role="presentation"
          />
          <HoverHintWrap text={collapsed ? 'Expand navigation' : 'Collapse navigation'} side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={toggleIconBtn}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              <PanelLeftOpen className={panelIconClass} strokeWidth={1.65} aria-hidden />
            </button>
          </HoverHintWrap>
        </div>
      ) : (
        <div className="flex w-full shrink-0 items-center gap-2 px-1">
          <img
            src={APP_ICON_SRC}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-divider-subtle"
            draggable={false}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-foreground tracking-tight">V-Download</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {queueActive ? 'Downloads' : 'Application settings'}
            </p>
          </div>
          <HoverHintWrap text="Collapse navigation" side="bottom">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className={toggleIconBtn}
              aria-expanded={!collapsed}
              aria-label="Collapse navigation"
            >
              <PanelLeftClose className={panelIconClass} strokeWidth={1.65} aria-hidden />
            </button>
          </HoverHintWrap>
        </div>
      )}

      {!collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 animate-panel-fade-in-from-left motion-reduce:animate-none">
          <nav className="flex flex-col flex-1 min-h-0 gap-3" aria-label="Home">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground px-2 mb-1">
                Download
              </p>
              <NavRow active={queueActive} onClick={onSelectQueue} icon={ListOrdered}>
                Downloads
              </NavRow>
            </div>

            <div className="flex flex-col flex-1 min-h-0 gap-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground px-2 mb-1 shrink-0">
                Preferences
              </p>
              <div className="flex flex-col gap-0.5 shrink-0">
                {PREF_SECTION_PRIMARY.map((item) => {
                  const Icon = prefPrimaryIcon(item.id)
                  const active = mainView === 'preferences' && prefSection === item.id
                  return (
                    <NavRow
                      key={item.id}
                      active={active}
                      onClick={() => onSelectPrefSection(item.id)}
                      icon={Icon}
                    >
                      {item.label}
                    </NavRow>
                  )
                })}
              </div>
              <div className="flex-1 min-h-2 shrink-0" aria-hidden />
              <div className="shrink-0">
                <NavRow
                  active={mainView === 'preferences' && prefSection === PREF_SECTION_ADVANCED.id}
                  onClick={() => onSelectPrefSection(PREF_SECTION_ADVANCED.id)}
                  icon={SlidersHorizontal}
                >
                  {PREF_SECTION_ADVANCED.label}
                </NavRow>
              </div>
            </div>
          </nav>

          <div className="mt-auto flex flex-col gap-2 shrink-0" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 animate-panel-fade-in motion-reduce:animate-none">
          <nav
            className="flex flex-1 min-h-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-1"
            aria-label="Home"
          >
            <IconNavButton
              active={queueActive}
              onClick={onSelectQueue}
              icon={ListOrdered}
              label="Downloads"
            />
            <div className="my-1 h-px w-7 shrink-0 bg-border" aria-hidden />
            {PREF_SECTION_PRIMARY.map((item) => {
              const Icon = prefPrimaryIcon(item.id)
              const active = mainView === 'preferences' && prefSection === item.id
              return (
                <IconNavButton
                  key={item.id}
                  active={active}
                  onClick={() => onSelectPrefSection(item.id)}
                  icon={Icon}
                  label={item.label}
                />
              )
            })}
            <div className="min-h-2 flex-1 shrink-0" aria-hidden />
            <IconNavButton
              active={mainView === 'preferences' && prefSection === PREF_SECTION_ADVANCED.id}
              onClick={() => onSelectPrefSection(PREF_SECTION_ADVANCED.id)}
              icon={SlidersHorizontal}
              label={PREF_SECTION_ADVANCED.label}
            />
          </nav>
        </div>
      )}
    </aside>
  )
}
