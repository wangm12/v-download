import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface AnimatedListProps<T> {
  items: T[]
  getKey: (item: T, index: number) => string
  children: (item: T, index: number) => ReactNode
  animate?: boolean
  className?: string
}

/**
 * Local, dependency-free Animated List primitive. It follows the same
 * source-owned approach as React Bits while keeping the large queue free of
 * an animation runtime and layout work.
 */
export function AnimatedList<T>({
  items,
  getKey,
  children,
  animate = true,
  className
}: AnimatedListProps<T>) {
  const [ready, setReady] = useState(!animate)

  useEffect(() => {
    if (!animate) {
      setReady(true)
      return
    }
    setReady(false)
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [animate, items.length])

  return (
    <div className={cn('v-animated-list', className)} data-ready={ready}>
      {items.map((item, index) => (
        <div
          key={getKey(item, index)}
          className="v-animated-list-item"
          style={animate && index < 24 ? { animationDelay: `${Math.min(index, 23) * 18}ms` } : undefined}
        >
          {children(item, index)}
        </div>
      ))}
    </div>
  )
}
