import type { ReactNode } from 'react'
import { CircleDot } from 'lucide-react'
import { cn } from '../../lib/utils'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-[24px] border border-dashed border-forge-steel/25 bg-[#f7f2ea]',
        compact ? 'p-4' : 'px-5 py-6',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-forge-ember" aria-hidden>
          {icon ?? <CircleDot className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-forge-night/80">{title}</p>
          {description ? <p className="mt-1 text-sm text-forge-night/65">{description}</p> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  )
}

