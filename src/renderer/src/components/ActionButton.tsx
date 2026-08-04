import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { HoverHintWrap } from './HoverHintWrap'

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
    <HoverHintWrap text={title}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className={cn(
          padding,
          'rounded-button text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-[background-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
          disabled && 'opacity-30 cursor-default'
        )}
      >
        <Icon className={iconSize} aria-hidden />
      </button>
    </HoverHintWrap>
  )
}
