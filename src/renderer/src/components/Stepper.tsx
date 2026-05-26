import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { HoverHintWrap } from './HoverHintWrap'

interface StepperProps {
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
}

export function Stepper({ value, min, max, suffix = '', onChange }: StepperProps) {
  return (
    <div className="flex items-center gap-2">
      <HoverHintWrap text="Decrease">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label="Decrease"
          className={cn(
            'w-9 h-9 rounded-lg bg-surface border border-border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
            value <= min ? 'text-muted-foreground/30 cursor-default' : 'text-foreground hover:bg-elevated'
          )}
        >
          <ChevronDown className="w-4 h-4" aria-hidden />
        </button>
      </HoverHintWrap>
      <span className="w-12 text-center text-sm font-medium text-foreground">
        {value}{suffix}
      </span>
      <HoverHintWrap text="Increase">
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label="Increase"
          className={cn(
            'w-9 h-9 rounded-lg bg-surface border border-border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
            value >= max ? 'text-muted-foreground/30 cursor-default' : 'text-foreground hover:bg-elevated'
          )}
        >
          <ChevronUp className="w-4 h-4" aria-hidden />
        </button>
      </HoverHintWrap>
    </div>
  )
}
