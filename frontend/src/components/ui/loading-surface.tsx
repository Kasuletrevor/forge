import { LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

interface LoadingSurfaceProps {
  title?: string
  description?: string
  className?: string
  skeletonRows?: number
}

export function LoadingSurface({
  title = 'Loading',
  description,
  className,
  skeletonRows = 3,
}: LoadingSurfaceProps) {
  return (
    <div
      className={cn('rounded-3xl border border-forge-steel/30 bg-white/80 px-5 py-4', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 text-sm font-medium text-forge-night">
        <LoaderCircle className="size-4 animate-spin text-forge-ember" aria-hidden />
        <span>{title}</span>
      </div>
      {description ? <p className="mt-2 text-sm text-forge-night/70">{description}</p> : null}
      <div className="mt-4 space-y-2">
        {Array.from({ length: Math.max(1, skeletonRows) }).map((_, index) => (
          <div
            key={index}
            className="h-2.5 animate-pulse rounded-full bg-forge-steel/20"
            style={{ width: `${88 - index * 12}%` }}
          />
        ))}
      </div>
    </div>
  )
}

