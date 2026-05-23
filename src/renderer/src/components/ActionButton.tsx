import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ActionButtonProps {
  icon: LucideIcon
  title?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  onClick: () => void
}

export function ActionButton({ icon: Icon, title, disabled, size = 'md', onClick }: ActionButtonProps) {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const padding = size === 'sm' ? 'p-1' : 'p-1.5'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        padding,
        'rounded-md text-muted-foreground hover:text-foreground hover:bg-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        disabled && 'opacity-30 cursor-default pointer-events-none'
      )}
    >
      <Icon className={iconSize} />
    </button>
  )
}
