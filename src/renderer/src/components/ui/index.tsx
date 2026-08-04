import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode
} from 'react'
import { cn } from '@/lib/cn'

export const Surface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Surface(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('v-surface rounded-card', className)} {...props} />
})

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  interactive?: boolean
}

export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { className, selected = false, interactive = false, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      data-selected={selected}
      className={cn(
        'v-list-row rounded-lg',
        interactive && 'cursor-pointer',
        className
      )}
      {...props}
    />
  )
})

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, tone = 'secondary', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-button px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
        tone === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-hover shadow-[0_8px_22px_rgb(var(--color-accent)/0.16)]',
        tone === 'secondary' && 'bg-control text-foreground hover:bg-surface-hover',
        tone === 'ghost' && 'text-muted-foreground hover:bg-control hover:text-foreground',
        tone === 'danger' && 'bg-state-error-bg text-foreground hover:bg-error/15',
        className
      )}
      {...props}
    />
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { className, ...props },
  ref
) {
  return <Button ref={ref} className={cn('h-10 w-10 shrink-0 px-0', className)} {...props} />
})

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error'
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
        tone === 'neutral' && 'bg-control text-muted-foreground',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'success' && 'bg-success/15 text-success',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'error' && 'bg-error/15 text-error',
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
      {icon ? <div className="mb-4 text-accent/80" aria-hidden>{icon}</div> : null}
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
        tone === 'success' && 'bg-success/[0.12] text-success',
        tone === 'warning' && 'bg-warning/[0.12] text-warning',
        tone === 'error' && 'bg-error/[0.12] text-error',
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
