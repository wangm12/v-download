import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Bot,
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
import { PREF_SECTION_ADVANCED, PREF_SECTION_MCP, PREF_SECTION_PRIMARY } from '@/preferencesNav'
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

function prefPrimaryIcon(id: (typeof PREF_SECTION_PRIMARY)[number]): LucideIcon {
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
  icon: Icon,
  collapsed,
  hint
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  icon: LucideIcon
  collapsed: boolean
  hint: string
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? hint : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center rounded-lg text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
        collapsed ? 'mx-auto h-9 w-9 shrink-0 justify-center p-0' : 'w-full gap-2 px-2 py-1.5',
        active
          ? 'bg-action text-action-fg font-medium'
          : 'text-muted-foreground hover:bg-control hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span
        className={cn(
          'min-w-0 truncate transition-[opacity,width] duration-panel ease-panel motion-reduce:transition-none',
          collapsed ? 'w-0 opacity-0' : 'flex-1 opacity-100'
        )}
      >
        {children}
      </span>
    </button>
  )

  if (collapsed) {
    return (
      <HoverHintWrap text={hint} side="right">
        {button}
      </HoverHintWrap>
    )
  }
  return button
}

const panelIconClass =
  'h-[18px] w-[18px] shrink-0 text-foreground/80 transition-[color,transform] duration-200 ease-out group-hover:text-foreground'

const toggleIconBtn =
  'group flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised/50 text-muted-foreground ring-1 ring-inset ring-divider-subtle transition-[background-color,box-shadow,transform] duration-panel ease-panel hover:bg-surface-hover hover:text-foreground hover:ring-border-strong active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus'

function SectionLabel({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <p
      className={cn(
        'overflow-hidden px-2 text-[10px] font-semibold uppercase tracking-wider text-tertiary-foreground transition-[opacity,max-height,margin] duration-panel ease-panel motion-reduce:transition-none',
        collapsed ? 'mb-0 max-h-0 opacity-0' : 'mb-1 max-h-8 opacity-100'
      )}
    >
      {children}
    </p>
  )
}

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
  const viewSubtitle = queueActive ? t('nav.downloads') : t('nav.applicationSettings')
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse')

  return (
    <aside
      className={cn(
        'flex min-h-0 shrink-0 flex-col self-stretch border-r border-border bg-sidebar px-1.5 py-4 [contain:layout] motion-reduce:transition-none',
        'overflow-x-hidden transition-[width] duration-panel ease-panel',
        collapsed ? 'w-14' : 'w-[244px]'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div
        className={cn(
          'flex shrink-0 gap-2',
          collapsed ? 'flex-col items-center' : 'flex-row items-center px-1'
        )}
      >
        <img
          src={APP_ICON_SRC}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 object-contain"
          draggable={false}
          role="presentation"
        />
        <div
          className={cn(
            'min-w-0 overflow-hidden transition-[opacity,max-width,flex] duration-panel ease-panel motion-reduce:transition-none',
            collapsed ? 'max-w-0 flex-[0] opacity-0' : 'max-w-[10rem] flex-1 opacity-100'
          )}
        >
          <p className="truncate text-sm font-semibold leading-tight tracking-tight text-foreground">V-Download</p>
          <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">{viewSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={toggleIconBtn}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
        >
          {collapsed ? (
            <PanelLeftOpen className={panelIconClass} strokeWidth={1.65} aria-hidden />
          ) : (
            <PanelLeftClose className={panelIconClass} strokeWidth={1.65} aria-hidden />
          )}
        </button>
      </div>

      <nav
        className={cn(
          'mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto',
          collapsed && 'items-center'
        )}
        aria-label={t('nav.home')}
      >
        <div>
          <SectionLabel collapsed={collapsed}>{t('nav.workspace')}</SectionLabel>
          <div className="flex flex-col gap-0.5">
            <NavRow
              collapsed={collapsed}
              hint={t('nav.downloads')}
              active={queueActive}
              onClick={onSelectQueue}
              icon={ListOrdered}
            >
              {t('nav.downloads')}
            </NavRow>
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>{t('nav.preferences')}</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {PREF_SECTION_PRIMARY.map((item) => {
              const Icon = prefPrimaryIcon(item)
              const active = mainView === 'preferences' && prefSection === item
              return (
                <NavRow
                  key={item}
                  collapsed={collapsed}
                  hint={t(`nav.${item}`)}
                  active={active}
                  onClick={() => onSelectPrefSection(item)}
                  icon={Icon}
                >
                  {t(`nav.${item}`)}
                </NavRow>
              )
            })}
          </div>
        </div>
        <div className="mt-auto shrink-0 flex flex-col gap-0.5">
          <NavRow
            collapsed={collapsed}
            hint={t('nav.mcp')}
            active={mainView === 'preferences' && prefSection === PREF_SECTION_MCP}
            onClick={() => onSelectPrefSection(PREF_SECTION_MCP)}
            icon={Bot}
          >
            {t('nav.mcp')}
          </NavRow>
          <NavRow
            collapsed={collapsed}
            hint={t('nav.advanced')}
            active={mainView === 'preferences' && prefSection === PREF_SECTION_ADVANCED}
            onClick={() => onSelectPrefSection(PREF_SECTION_ADVANCED)}
            icon={SlidersHorizontal}
          >
            {t('nav.advanced')}
          </NavRow>
        </div>
      </nav>
    </aside>
  )
}
