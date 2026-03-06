import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

type ActionVariant = 'danger' | 'warning' | 'success' | 'default'

const variantClasses: Record<ActionVariant, string> = {
  danger: 'hover:text-accent-coral',
  warning: 'hover:text-accent-amber',
  success: 'hover:text-accent-green',
  default: 'hover:text-foreground'
}

interface ActionButtonProps {
  icon: LucideIcon
  variant?: ActionVariant
  title?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  onClick: () => void
}

export function ActionButton({
  icon: Icon,
  variant = 'default',
  title,
  disabled,
  size = 'md',
  onClick
}: ActionButtonProps) {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const padding = size === 'sm' ? 'p-1' : 'p-1.5'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        padding,
        'rounded-md text-muted-foreground hover:bg-surface transition-colors',
        variantClasses[variant],
        disabled && 'opacity-30 cursor-default pointer-events-none'
      )}
    >
      <Icon className={iconSize} />
    </button>
  )
}
