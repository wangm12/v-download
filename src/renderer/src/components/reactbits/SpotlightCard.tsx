import { useCallback, type HTMLAttributes, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'

export function SpotlightCard({ className, onPointerMove, ...props }: HTMLAttributes<HTMLDivElement>) {
  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--v-spotlight-x', `${event.clientX - rect.left}px`)
    event.currentTarget.style.setProperty('--v-spotlight-y', `${event.clientY - rect.top}px`)
    onPointerMove?.(event)
  }, [onPointerMove])

  return <div {...props} onPointerMove={handlePointerMove} className={cn('v-spotlight-card', className)} />
}
