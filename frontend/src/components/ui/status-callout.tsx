import type { ReactNode } from 'react'
import { CheckCircle2, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { cn } from '../../lib/utils'

type StatusTone = 'success' | 'error' | 'warning' | 'info'

interface StatusCalloutProps {
  tone?: StatusTone
  title: string
  description?: ReactNode
  className?: string
}

const toneStyles: Record<StatusTone, string> = {
  success: 'border-[#9dc6a3] bg-[#e7f3e9] text-[#234b2b]',
  error: 'border-[#c58f80] bg-[#f7e4dc] text-[#6d2a1f]',
  warning: 'border-[#dec3a6] bg-[#f8ede2] text-[#6b3d16]',
  info: 'border-forge-steel/30 bg-[#ece8e1] text-forge-night',
}

const toneIcons: Record<StatusTone, typeof CircleAlert> = {
  success: CheckCircle2,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
}

export function StatusCallout({
  tone = 'info',
  title,
  description,
  className,
}: StatusCalloutProps) {
  const Icon = toneIcons[tone]

  return (
    <div
      className={cn('rounded-3xl border px-5 py-4 text-sm', toneStyles[tone], className)}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          {description ? <div className="mt-2">{description}</div> : null}
        </div>
      </div>
    </div>
  )
}

