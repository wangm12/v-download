import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { cn } from '@/lib/cn'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error'
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
        tone === 'neutral' && 'border-divider-subtle bg-control text-muted-foreground',
        tone === 'accent' && 'border-state-info-border bg-state-info-bg text-info',
        tone === 'success' && 'border-state-success-border bg-state-complete-bg text-success',
        tone === 'warning' && 'border-state-warning-border bg-state-warning-bg text-warning',
        tone === 'error' && 'border-dashed border-state-error-border bg-state-error-bg text-error',
        className
      )}
      {...props}
    />
  )
}

export function StatusPill({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: BadgeProps['tone']
  className?: string
}) {
  return (
    <Badge tone={tone} className={cn('normal-case tracking-normal', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </Badge>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-56 flex-col items-center justify-center px-6 text-center', className)}>
      {icon ? <div className="mb-4 text-muted-foreground" aria-hidden>{icon}</div> : null}
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function StatusBlock({
  children,
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  return (
    <div
      className={cn(
        'rounded-button px-3 py-2.5 text-sm leading-relaxed',
        tone === 'neutral' && 'bg-control text-muted-foreground',
        tone === 'success' && 'bg-state-complete-bg text-success',
        tone === 'warning' && 'border border-dashed border-state-warning-border bg-state-warning-bg text-warning',
        tone === 'error' && 'border border-dashed border-state-error-border bg-state-error-bg text-error',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export const DialogShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function DialogShell(
  { children, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'w-full overflow-hidden rounded-panel border border-divider-strong bg-window shadow-[0_28px_90px_rgb(0_0_0/0.48)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
