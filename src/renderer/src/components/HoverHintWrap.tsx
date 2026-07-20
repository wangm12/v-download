import type {
  CSSProperties,
  ForwardedRef,
  MouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from 'react'
import {
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

const SHOW_DELAY_MS = 200
const LEAVE_DELAY_MS = 80
const GAP_PX = 8
const VIEW_PAD = 8

const TIP_HIDDEN: CSSProperties = {
  position: 'fixed',
  visibility: 'hidden',
  left: 0,
  top: 0,
  transform: 'translate(-50%, -100%)',
  zIndex: 99_999,
  maxWidth: `min(20rem, calc(100vw - ${VIEW_PAD * 2}px))`
}

function setForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value)
  else if (ref) (ref as MutableRefObject<T | null>).current = value
}

export interface HoverHintWrapProps {
  /** Visible hint text; when empty, children render unchanged. */
  text: string | undefined
  /** Where the tooltip appears relative to the trigger. */
  side?: 'top' | 'bottom' | 'right' | 'left'
  className?: string
  children: ReactElement
}

function computeTipStyle(
  anchor: DOMRect,
  tip: HTMLDivElement,
  side: 'top' | 'bottom' | 'right' | 'left'
): CSSProperties {
  const pad = VIEW_PAD
  const gap = GAP_PX

  let left = anchor.left + anchor.width / 2
  let top = anchor.top - gap
  let transform = 'translate(-50%, -100%)'
  let placement: 'top' | 'bottom' | 'right' | 'left' =
    side === 'bottom' ? 'bottom' : side === 'right' ? 'right' : side === 'left' ? 'left' : 'top'

  if (placement === 'bottom') {
    top = anchor.bottom + gap
    transform = 'translate(-50%, 0)'
  } else if (placement === 'right') {
    left = anchor.right + gap
    top = anchor.top + anchor.height / 2
    transform = 'translate(0, -50%)'
  } else if (placement === 'left') {
    left = anchor.left - gap
    top = anchor.top + anchor.height / 2
    transform = 'translate(-100%, -50%)'
  }

  const th = tip.offsetHeight

  if (placement === 'top' && anchor.top - gap - th < pad) {
    placement = 'bottom'
    top = anchor.bottom + gap
    transform = 'translate(-50%, 0)'
  }

  if (placement === 'top' || placement === 'bottom') {
    const w = tip.offsetWidth
    const centerX = anchor.left + anchor.width / 2
    const minCenter = pad + w / 2
    const maxCenter = globalThis.window.innerWidth - pad - w / 2
    left = Math.min(Math.max(centerX, minCenter), maxCenter)
  }

  if (placement === 'right' || placement === 'left') {
    const h = tip.offsetHeight
    const midY = anchor.top + anchor.height / 2
    const minMid = pad + h / 2
    const maxMid = globalThis.window.innerHeight - pad - h / 2
    top = Math.min(Math.max(midY, minMid), maxMid)
  }

  return {
    position: 'fixed',
    left,
    top,
    transform,
    zIndex: 99_999,
    visibility: 'visible',
    maxWidth: `min(20rem, calc(100vw - ${pad * 2}px))`
  }
}

/**
 * Hover hint portaled to `document.body` with `position: fixed`.
 * Delayed leave avoids pointer leave/re-enter glitches; doc capture closes stray open state.
 */
export const HoverHintWrap = forwardRef<HTMLSpanElement, HoverHintWrapProps>(function HoverHintWrap(
  { text, side = 'top', className, children },
  forwardedRef
) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const showTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const lastPointerRef = useRef({ x: 0, y: 0 })

  const [open, setOpen] = useState(false)
  const [tipStyle, setTipStyle] = useState<CSSProperties>(TIP_HIDDEN)

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current != null) {
      globalThis.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }, [])

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current != null) {
      globalThis.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    clearShowTimer()
    clearLeaveTimer()
    setOpen(false)
  }, [clearLeaveTimer, clearShowTimer])

  const primeAndScheduleOpen = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement> | MouseEvent<HTMLSpanElement>) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
      clearLeaveTimer()
      clearShowTimer()
      showTimerRef.current = globalThis.setTimeout(() => {
        showTimerRef.current = null
        setOpen(true)
      }, SHOW_DELAY_MS)
    },
    [clearLeaveTimer, clearShowTimer]
  )

  const scheduleClose = useCallback(() => {
    clearShowTimer()
    clearLeaveTimer()
    leaveTimerRef.current = globalThis.setTimeout(() => {
      leaveTimerRef.current = null
      const anchor = anchorRef.current
      if (!anchor) {
        setOpen(false)
        return
      }
      const { x, y } = lastPointerRef.current
      const r = anchor.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return
      setOpen(false)
    }, LEAVE_DELAY_MS)
  }, [clearLeaveTimer, clearShowTimer])

  const openNow = useCallback(() => {
    clearShowTimer()
    clearLeaveTimer()
    setOpen(true)
  }, [clearLeaveTimer, clearShowTimer])

  const syncPosition = useCallback(() => {
    const anchor = anchorRef.current
    const tip = tooltipRef.current
    if (!anchor || !tip) return
    setTipStyle(computeTipStyle(anchor.getBoundingClientRect(), tip, side))
  }, [side])

  useLayoutEffect(() => {
    if (!open || !text) return
    const tip = tooltipRef.current
    const anchor = anchorRef.current
    if (!tip || !anchor) return
    setTipStyle(computeTipStyle(anchor.getBoundingClientRect(), tip, side))
  }, [open, text, side])

  useEffect(() => {
    if (!open) {
      setTipStyle(TIP_HIDDEN)
      return
    }
    const onScrollOrResize = () => syncPosition()
    globalThis.window.addEventListener('scroll', onScrollOrResize, true)
    globalThis.window.addEventListener('resize', onScrollOrResize)
    return () => {
      globalThis.window.removeEventListener('scroll', onScrollOrResize, true)
      globalThis.window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, syncPosition])

  useEffect(() => {
    const track = (e: globalThis.PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
    }
    globalThis.window.addEventListener('pointermove', track, { passive: true })
    return () => globalThis.window.removeEventListener('pointermove', track)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDocPointerDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node | null
      if (anchorRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [open, close])

  if (!text || !isValidElement(children)) {
    return children
  }

  const portal =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={tooltipRef}
            role="tooltip"
            style={tipStyle}
            className={cn(
              'pointer-events-none',
              'block w-max whitespace-normal text-balance text-left text-xs leading-snug text-foreground',
              'rounded-md border border-border bg-elevated px-2.5 py-1.5 shadow-lg'
            )}
          >
            {text}
          </div>,
          document.body
        )
      : null

  return (
    <span
      ref={(el) => {
        anchorRef.current = el
        setForwardedRef(forwardedRef, el)
      }}
      className={cn('relative inline-flex', className)}
      onPointerEnter={primeAndScheduleOpen}
      onPointerLeave={scheduleClose}
      onMouseEnter={primeAndScheduleOpen}
      onMouseLeave={scheduleClose}
      onFocusCapture={openNow}
      onBlurCapture={(e) => {
        const rt = e.relatedTarget as Node | null
        globalThis.queueMicrotask(() => {
          if (!anchorRef.current?.contains(rt)) close()
        })
      }}
    >
      {children}
      {portal}
    </span>
  )
})
