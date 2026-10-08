import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

export interface MenuAction {
  label: string
  onSelect: () => void
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
}

export function ActionMenu({ actions }: { actions: MenuAction[] }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={t('ui.moreActions')} title={t('ui.moreActions')}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-button text-muted-foreground hover:bg-control hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={5} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
          className="z-[100] min-w-44 rounded-card border border-divider-strong bg-surface p-1 shadow-lg">
          {actions.map((action) => (
            <DropdownMenu.Item key={action.label} disabled={action.disabled} onSelect={action.onSelect}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-[13px] outline-none data-[highlighted]:bg-selection data-[disabled]:opacity-40 ${action.destructive ? 'text-error' : 'text-foreground'}`}>
              {action.icon}{action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
