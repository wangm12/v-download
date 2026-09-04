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
import { useTranslation } from 'react-i18next'
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
        'inline-flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
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
  'group flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised/50 text-muted-foreground ring-1 ring-inset ring-divider-subtle transition-[background-color,box-shadow,transform] duration-panel ease-panel hover:bg-surface-hover hover:text-foreground hover:ring-border-strong active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus'

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mainView,
  prefSection,
  onSelectQueue,
  onSelectPrefSection
}: AppSidebarProps) {
  const { t } = useTranslation()
  const queueActive = mainView === 'downloads'
  const viewSubtitle = queueActive
    ? t('nav.downloads')
    : t('nav.applicationSettings')

  return (
    <aside
      className={cn(
        'flex min-h-0 shrink-0 flex-col self-stretch border-r border-border bg-sidebar py-4 overflow-x-hidden transition-[width,padding,gap] duration-panel ease-panel motion-reduce:transition-none',
        collapsed ? 'w-14 px-1.5 gap-2' : 'w-[244px] px-3 gap-4'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-2">
          <img
            src={APP_ICON_SRC}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 object-contain"
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
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 object-contain"
            draggable={false}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-foreground tracking-tight">V-Download</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {viewSubtitle}
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
                {t('nav.workspace')}
              </p>
              <div className="flex flex-col gap-0.5">
                <NavRow active={queueActive} onClick={onSelectQueue} icon={ListOrdered}>
                  {t('nav.downloads')}
                </NavRow>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground px-2 mb-1">
                {t('nav.preferences')}
              </p>
              <div className="flex flex-col gap-0.5">
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
            </div>
            <div className="mt-auto shrink-0">
              <NavRow
                active={mainView === 'preferences' && prefSection === PREF_SECTION_ADVANCED.id}
                onClick={() => onSelectPrefSection(PREF_SECTION_ADVANCED.id)}
                icon={SlidersHorizontal}
              >
                {PREF_SECTION_ADVANCED.label}
              </NavRow>
            </div>
          </nav>
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
              label={t('nav.downloads')}
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
            <div className="mt-auto shrink-0">
              <IconNavButton
                active={mainView === 'preferences' && prefSection === PREF_SECTION_ADVANCED.id}
                onClick={() => onSelectPrefSection(PREF_SECTION_ADVANCED.id)}
                icon={SlidersHorizontal}
                label={PREF_SECTION_ADVANCED.label}
              />
            </div>
          </nav>
        </div>
      )}
    </aside>
  )
}
