import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { motionPresets } from '../../lib/motion'
import type { Project, ProjectRepoStatus, Task } from '../../types'

export function fmt(value: string | null) {
  if (!value) {
    return 'Unscheduled'
  }
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function summarizeProjectRepoStatus(status: ProjectRepoStatus | undefined) {
  if (!status?.workdir_path) {
    return {
      eyebrow: 'Unlinked',
      detail: 'No local workdir linked',
      tone: 'neutral' as const,
    }
  }
  if (status.status_error) {
    return {
      eyebrow: 'Linked',
      detail: status.status_error,
      tone: 'warning' as const,
    }
  }
  if (!status.is_git_repo) {
    return {
      eyebrow: 'Linked',
      detail: 'Directory linked, not a git repo',
      tone: 'neutral' as const,
    }
  }
  return {
    eyebrow: status.branch ?? 'Detached',
    detail: status.dirty
      ? `${status.dirty_file_count} local change${status.dirty_file_count === 1 ? '' : 's'}`
      : 'Working tree clean',
    tone: status.dirty ? ('warning' as const) : ('healthy' as const),
  }
}

export function Section({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className={`${motionPresets.surfaceEnter} relative overflow-hidden rounded-[32px] border border-forge-steel/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(250,246,240,0.84))] p-5 shadow-panel sm:p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-forge-steel">{eyebrow}</p>
          <h3 className="mt-1.5 font-display text-[1.9rem] text-forge-night sm:text-3xl">{title}</h3>
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function TaskLaneCard({
  task,
  project,
  dragging,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
}: {
  task: Task
  project?: Project
  dragging: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      draggable
      data-forge-task-card={task.id}
      className={`${motionPresets.cardInteractive} group cursor-grab rounded-[28px] border px-4 py-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-panel ${
        dragging
          ? 'border-forge-ember/45 bg-[#f8dfd0] opacity-70'
          : 'border-forge-steel/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(250,246,240,0.96))]'
      }`}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-3 h-1.5 w-16 rounded-full" style={{ backgroundColor: project?.color ?? '#9a8b80' }} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-forge-paper px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-forge-steel">
              {task.status.replace('_', ' ')}
            </span>
            <span
              className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-forge-night"
              style={{
                backgroundColor: `${project?.color ?? '#8a7d68'}24`,
              }}
            >
              {task.priority}
            </span>
          </div>
          <div className="mt-3 text-[1.05rem] font-semibold leading-snug text-forge-night">{task.title}</div>
          <div className="mt-2 text-xs uppercase tracking-[0.18em] text-forge-steel">
            {task.project_id ? project?.name ?? `Project #${task.project_id}` : 'Inbox'} •{' '}
            {fmt(task.due_at ?? task.scheduled_start)}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="icon-button" type="button">
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Edit task</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[#8f3424] focus:bg-[#f6ddd6] focus:text-[#8f3424]"
              onSelect={onDelete}
            >
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function TaskCard({
  task,
  project,
  onComplete,
  onEdit,
  onDelete,
  onInlineEdit,
  titleSlot,
  compact = false,
}: {
  task: Task
  project?: Project
  onComplete?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onInlineEdit?: () => void
  titleSlot?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={`${motionPresets.cardInteractive} rounded-[24px] border border-forge-steel/20 bg-[#f9f6f0] p-4`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-3 h-1.5 w-16 rounded-full" style={{ backgroundColor: project?.color ?? '#9a8b80' }} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-forge-paper px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-forge-steel">
              {task.status.replace('_', ' ')}
            </span>
            <span
              className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.25em]"
              style={{ backgroundColor: `${project?.color ?? '#8a7d68'}22`, color: '#25211c' }}
            >
              {project?.name ?? 'Inbox'}
            </span>
          </div>
          {titleSlot ?? <div className="mt-3 text-[1.05rem] font-semibold leading-snug text-forge-night">{task.title}</div>}
          {!compact && task.description ? <p className="mt-2 text-sm text-forge-night/70">{task.description}</p> : null}
          {task.completed_at ? (
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-forge-steel">
              Completed {fmt(task.completed_at)}
            </p>
          ) : null}
        </div>
        <div className="text-right text-xs uppercase tracking-[0.2em] text-forge-steel">
          <div>{task.priority}</div>
          <div className="mt-2">{fmt(task.due_at ?? task.scheduled_start)}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {onComplete ? <button className="forge-button" onClick={onComplete} type="button">Mark done</button> : null}
        {onInlineEdit || onEdit || onDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="icon-button" type="button">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onInlineEdit ? (
                <DropdownMenuItem onSelect={onInlineEdit}>Rename inline</DropdownMenuItem>
              ) : null}
              {onEdit ? <DropdownMenuItem onSelect={onEdit}>Edit task</DropdownMenuItem> : null}
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-[#8f3424] focus:bg-[#f6ddd6] focus:text-[#8f3424]"
                    onSelect={onDelete}
                  >
                    Delete task
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
  placeholder,
  autoFocus = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  multiline?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <label className="block space-y-2 text-sm font-medium text-forge-night/80">
      <span>{label}</span>
      {multiline ? (
        <textarea
          autoFocus={autoFocus}
          className="forge-input min-h-28 resize-none"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          autoFocus={autoFocus}
          className="forge-input"
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  )
}

export function DirectoryField({
  label,
  value,
  onChange,
  onBrowse,
  onClear,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
  onClear: () => void
}) {
  return (
    <label className="block space-y-2 text-sm font-medium text-forge-night/80">
      <span>{label}</span>
        <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="forge-input flex-1"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="C:\\Users\\Trevor\\workspace\\Forge"
        />
        <button className="forge-button forge-button-muted whitespace-nowrap" onClick={onBrowse} type="button">
          Browse
        </button>
        {value ? (
          <button className="forge-button forge-button-muted whitespace-nowrap" onClick={onClear} type="button">
            Clear
          </button>
        ) : null}
      </div>
      <p className="text-xs uppercase tracking-[0.16em] text-forge-steel">
        Link a local directory so Forge can resolve repo context and shell location.
      </p>
    </label>
  )
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block space-y-2 text-sm font-medium text-forge-night/80">
      <span>{label}</span>
      <select className="forge-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ProjectRepoCard({ status }: { status?: ProjectRepoStatus }) {
  const summary = summarizeProjectRepoStatus(status)
  const toneClass =
    summary.tone === 'healthy'
      ? 'border-[#bed2bf] bg-[#eef5ed] text-[#284634]'
      : summary.tone === 'warning'
        ? 'border-[#dec3a6] bg-[#f8ede2] text-[#6b3d16]'
        : 'border-forge-steel/20 bg-white text-forge-night/80'

  return (
    <div className={`mt-4 rounded-[24px] border px-4 py-3.5 shadow-sm ${toneClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-[0.24em]">{summary.eyebrow}</span>
          <div className="mt-1 text-sm font-medium">{summary.detail}</div>
        </div>
        {status?.workdir_path ? (
          <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
            {status.is_git_repo ? 'Repo linked' : 'Folder linked'}
          </span>
        ) : null}
      </div>
      <div className="mt-2 truncate text-xs uppercase tracking-[0.16em]">
        {status?.workdir_path ?? 'Attach a workdir to enable repo-aware context'}
      </div>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.25em] text-forge-steel">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

export function ProjectRepoPanel({ status }: { status?: ProjectRepoStatus }) {
  const summary = summarizeProjectRepoStatus(status)
  const rows = [
    { label: 'State', value: summary.eyebrow },
    { label: 'Path', value: status?.workdir_path ?? 'Not linked' },
    { label: 'Branch', value: status?.branch ?? (status?.is_git_repo ? 'Detached' : 'Unavailable') },
    { label: 'Remote', value: status?.remote_url ?? 'Unavailable' },
    { label: 'Last commit', value: status?.last_commit_summary ?? 'Unavailable' },
  ]

  return (
    <div className="rounded-[24px] border border-forge-steel/20 bg-[#f7f2ea] p-4">
      <div className="text-[11px] uppercase tracking-[0.24em] text-forge-steel">Repo Status</div>
      <div className="mt-2 text-sm text-forge-night/75">{summary.detail}</div>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <span className="text-forge-night/65">{row.label}</span>
            <span className="text-left font-medium text-forge-night break-all sm:max-w-[18rem] sm:text-right">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Metric({
  label,
  value,
  subtle = false,
}: {
  label: string
  value: string
  subtle?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-[#c7b39c]">{label}</div>
      <div className={`mt-2 text-lg ${subtle ? 'text-[#dfd6ca]' : 'text-white'}`}>{value}</div>
    </div>
  )
}

export function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-forge-steel/18 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span className="text-sm text-forge-night/70">{label}</span>
      <span className="text-left text-sm font-medium text-forge-night break-all sm:max-w-[16rem] sm:text-right">{value}</span>
    </div>
  )
}
