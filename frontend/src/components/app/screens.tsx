import {
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import type {
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin, {
  type EventReceiveArg,
  type EventResizeDoneArg,
} from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import { PencilLine, Plus } from 'lucide-react'
import { RecurrenceBuilder } from '../recurrence-builder'
import { ScheduleWidget } from '../schedule-widget'
import { EmptyState } from '../ui/empty-state'
import type { RecurrenceState } from '../../lib/recurrence'
import type { TaskLane } from '../../lib/task-board'
import type {
  CalendarOccurrence,
  CreateEventRequest,
  EventType,
  HealthResponse,
  Project,
  ProjectRepoStatus,
  ProjectSummary,
  Task,
  TaskStatus,
  TodaySummary,
} from '../../types'
import {
  Field,
  ProjectRepoCard,
  Section,
  Select,
  Setting,
  Stat,
  TaskCard,
  TaskLaneCard,
  fmt,
} from './shared-ui'

interface TodayScreenProps {
  today: TodaySummary
  calendarEvents: CalendarOccurrence[]
  projectMap: Map<number, Project>
  onCompleteTask: (taskId: number) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
  onOpenCreateTask: () => void
}

export function TodayScreen({
  today,
  calendarEvents,
  projectMap,
  onCompleteTask,
  onEditTask,
  onDeleteTask,
  onOpenCreateTask,
}: TodayScreenProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr,0.9fr]">
      <Section
        title="Execution Queue"
        eyebrow="Today"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-forge-steel/20 bg-[#f7f2ea] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-forge-steel">
              {today.today_tasks.length} ready
            </span>
            <button className="forge-button forge-button-muted" onClick={onOpenCreateTask} type="button">
              <Plus className="size-3.5" />
              New task
            </button>
          </div>
        }
      >
        {today.today_tasks.length === 0 ? (
          <EmptyState
            title="No tasks are scheduled or due today."
            description="Capture a task or schedule work to populate today's queue."
            action={
              <button className="forge-button bg-forge-night text-white" onClick={onOpenCreateTask} type="button">
                <Plus className="size-3.5" />
                New task
              </button>
            }
          />
        ) : (
          today.today_tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              project={task.project_id ? projectMap.get(task.project_id) : undefined}
              onComplete={() => onCompleteTask(task.id)}
              onEdit={() => onEditTask(task)}
              onDelete={() => onDeleteTask(task)}
            />
          ))
        )}
      </Section>
      <div className="grid gap-5">
        <ScheduleWidget
          events={calendarEvents.map((event) => ({
            id: String(event.event_id),
            title: event.title,
            date: event.occurrence_start,
          }))}
        />
        <Section title="Overdue" eyebrow="Recovery">
          {today.overdue_tasks.length === 0 ? (
            <EmptyState title="No overdue tasks." compact />
          ) : (
            today.overdue_tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                project={task.project_id ? projectMap.get(task.project_id) : undefined}
                onComplete={() => onCompleteTask(task.id)}
                onEdit={() => onEditTask(task)}
                onDelete={() => onDeleteTask(task)}
                compact
              />
            ))
          )}
        </Section>
      </div>
    </div>
  )
}

interface ProjectsScreenProps {
  projectSummaries: ProjectSummary[]
  projectStatusMap: Map<number, ProjectRepoStatus>
  inlineProjectEdit: { id: number | null; name: string }
  setInlineProjectEdit: Dispatch<SetStateAction<{ id: number | null; name: string }>>
  onSaveInlineProjectName: (projectId: number) => Promise<void>
  onOpenProjectEditor: (project: Project) => void
  onOpenCreateProject: () => void
}

export function ProjectsScreen({
  projectSummaries,
  projectStatusMap,
  inlineProjectEdit,
  setInlineProjectEdit,
  onSaveInlineProjectName,
  onOpenProjectEditor,
  onOpenCreateProject,
}: ProjectsScreenProps) {
  return (
    <div className="grid gap-5">
      <Section
        title="Active Surfaces"
        eyebrow="Projects"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-forge-steel/20 bg-[#f7f2ea] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-forge-steel">
              {projectSummaries.length} live
            </span>
            <button className="forge-button bg-forge-night text-white border-none" onClick={onOpenCreateProject} type="button">
              <Plus className="size-3.5" />
              New Project
            </button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projectSummaries.map((summary) => (
            <article
              key={summary.project.id}
              className="rounded-[26px] border border-forge-steel/20 bg-[#f9f6f0] p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="h-3 w-20 rounded-full" style={{ backgroundColor: summary.project.color }} />
                <div className="flex gap-2">
                  <button
                    className="icon-button"
                    onClick={() => onOpenProjectEditor(summary.project)}
                    type="button"
                  >
                    <PencilLine className="size-4" />
                  </button>
                </div>
              </div>
              {inlineProjectEdit.id === summary.project.id ? (
                <input
                  autoFocus
                  className="forge-input mt-4 font-display text-2xl"
                  value={inlineProjectEdit.name}
                  onBlur={() => void onSaveInlineProjectName(summary.project.id)}
                  onChange={(event) =>
                    setInlineProjectEdit({ id: summary.project.id, name: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void onSaveInlineProjectName(summary.project.id)
                    }
                    if (event.key === 'Escape') {
                      setInlineProjectEdit({ id: null, name: '' })
                    }
                  }}
                />
              ) : (
                <button
                  className="mt-4 text-left font-display text-3xl text-forge-night"
                  onClick={() =>
                    setInlineProjectEdit({ id: summary.project.id, name: summary.project.name })
                  }
                  type="button"
                >
                  {summary.project.name}
                </button>
              )}
              <p className="mt-2 text-sm text-forge-night/70">
                {summary.project.description || 'No description yet.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-forge-steel">
                <span>{summary.project.status}</span>
                {summary.project.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-forge-paper px-3 py-1">
                    {tag}
                  </span>
                ))}
              </div>
              <ProjectRepoCard status={projectStatusMap.get(summary.project.id)} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Open" value={String(summary.open_task_count)} />
                <Stat label="Upcoming" value={String(summary.upcoming_event_count)} />
              </div>
            </article>
            ))}
        </div>
      </Section>
    </div>
  )
}

interface TasksScreenProps {
  taskLanes: TaskLane[]
  dragTaskId: number | null
  dragLaneProjectId: number | null | 'inbox'
  setDragLaneProjectId: Dispatch<SetStateAction<number | null | 'inbox'>>
  onMoveTaskToLane: (event: ReactDragEvent<HTMLDivElement>, projectId: number | null) => Promise<void>
  onTaskLaneDragEnd: () => void
  onTaskLaneDragStart: (event: ReactDragEvent<HTMLDivElement>, taskId: number) => void
  onRequestDeleteTask: (task: Task) => void
  onOpenTaskEditor: (task: Task) => void
  onOpenCreateTask: () => void
  taskSearch: string
  setTaskSearch: Dispatch<SetStateAction<string>>
  projectFilter: number | 'all' | 'inbox'
  setProjectFilter: Dispatch<SetStateAction<number | 'all' | 'inbox'>>
  statusFilter: TaskStatus | 'all'
  setStatusFilter: Dispatch<SetStateAction<TaskStatus | 'all'>>
  taskStatuses: Array<TaskStatus | 'all'>
  onClearDone: () => void
  tasks: Task[]
  projectSummaries: ProjectSummary[]
  projectMap: Map<number, Project>
  inlineTaskEdit: { id: number | null; title: string }
  setInlineTaskEdit: Dispatch<SetStateAction<{ id: number | null; title: string }>>
  onSaveInlineTaskTitle: (taskId: number) => Promise<void>
  onCompleteTask: (taskId: number) => void
}

export function TasksScreen({
  taskLanes,
  dragTaskId,
  dragLaneProjectId,
  setDragLaneProjectId,
  onMoveTaskToLane,
  onTaskLaneDragEnd,
  onTaskLaneDragStart,
  onRequestDeleteTask,
  onOpenTaskEditor,
  onOpenCreateTask,
  taskSearch,
  setTaskSearch,
  projectFilter,
  setProjectFilter,
  statusFilter,
  setStatusFilter,
  taskStatuses,
  onClearDone,
  tasks,
  projectSummaries,
  projectMap,
  inlineTaskEdit,
  setInlineTaskEdit,
  onSaveInlineTaskTitle,
  onCompleteTask,
}: TasksScreenProps) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-5">
        <Section
          title="Reassign by Drag"
          eyebrow="Board"
          action={
            <button className="forge-button border-none bg-forge-night text-white" onClick={onOpenCreateTask} type="button">
              <Plus className="size-3.5" />
              New Task
            </button>
          }
        >
          <div className="flex items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-forge-night/72">
              Drag operational tasks between Inbox and project lanes. The board follows the active task
              filter, and lane changes only render after the daemon API confirms the mutation.
            </p>
            <div className="rounded-full border border-forge-steel/20 bg-[#f6f0e6] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-forge-steel">
              Drag to Inbox or project
            </div>
          </div>
          <div className="mt-5 flex gap-4 overflow-x-auto pb-2">
            {taskLanes.map((lane) => {
              const isActiveDrop =
                dragTaskId !== null &&
                ((lane.projectId === null && dragLaneProjectId === 'inbox') ||
                  lane.projectId === dragLaneProjectId)

              return (
                <div
                  key={lane.id}
                  data-forge-task-lane={lane.id}
                  data-forge-project-id={lane.projectId ?? 'inbox'}
                  className={`min-h-[24rem] min-w-[18rem] flex-1 rounded-[28px] border p-4 transition ${
                    isActiveDrop
                      ? 'border-forge-ember bg-[#fff1e8] shadow-panel'
                      : 'border-forge-steel/20 bg-[#f8f4ed]'
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setDragLaneProjectId(lane.projectId === null ? 'inbox' : lane.projectId)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragLaneProjectId(lane.projectId === null ? 'inbox' : lane.projectId)
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      return
                    }
                    setDragLaneProjectId(null)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void onMoveTaskToLane(event, lane.projectId)
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="h-2.5 w-20 rounded-full" style={{ backgroundColor: lane.color }} />
                      <h3 className="mt-3 font-display text-2xl text-forge-night">{lane.title}</h3>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-forge-steel">
                      {lane.tasks.length} tasks
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {lane.tasks.length === 0 ? (
                      <EmptyState
                        title={dragTaskId !== null ? 'Drop a task here.' : 'No active tasks in this lane.'}
                        compact
                      />
                    ) : (
                      lane.tasks.map((task) => (
                        <TaskLaneCard
                          key={task.id}
                          task={task}
                          project={task.project_id ? projectMap.get(task.project_id) : undefined}
                          dragging={dragTaskId === task.id}
                          onDelete={() => onRequestDeleteTask(task)}
                          onDragEnd={onTaskLaneDragEnd}
                          onDragStart={(event) => onTaskLaneDragStart(event, task.id)}
                          onEdit={() => onOpenTaskEditor(task)}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        <Section title="Filtered Queue" eyebrow="Tasks">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Search" value={taskSearch} onChange={setTaskSearch} />
            <Select
              label="Project"
              value={String(projectFilter)}
              onChange={(value) =>
                setProjectFilter(value === 'all' || value === 'inbox' ? value : Number(value))
              }
              options={[
                { value: 'all', label: 'All projects' },
                { value: 'inbox', label: 'Inbox only' },
                ...projectSummaries.map((summary) => ({
                  value: String(summary.project.id),
                  label: summary.project.name,
                })),
              ]}
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as TaskStatus | 'all')}
              options={taskStatuses.map((status) => ({ value: status, label: status }))}
            />
            <button className="forge-button self-end" onClick={onClearDone} type="button">
              Clear done
            </button>
          </div>
          <div className="mt-5 space-y-3">
            {tasks.length === 0 ? (
              <EmptyState
                title="No tasks match this filter."
                description="Try widening the search or status filter."
              />
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  project={task.project_id ? projectMap.get(task.project_id) : undefined}
                  onComplete={task.status === 'done' ? undefined : () => onCompleteTask(task.id)}
                  onEdit={() => onOpenTaskEditor(task)}
                  onDelete={() => onRequestDeleteTask(task)}
                  compact
                  titleSlot={
                    inlineTaskEdit.id === task.id ? (
                      <input
                        autoFocus
                        className="forge-input mt-3"
                        value={inlineTaskEdit.title}
                        onBlur={() => void onSaveInlineTaskTitle(task.id)}
                        onChange={(event) =>
                          setInlineTaskEdit({ id: task.id, title: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void onSaveInlineTaskTitle(task.id)
                          }
                          if (event.key === 'Escape') {
                            setInlineTaskEdit({ id: null, title: '' })
                          }
                        }}
                      />
                    ) : undefined
                  }
                  onInlineEdit={() => setInlineTaskEdit({ id: task.id, title: task.title })}
                />
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

interface CalendarScreenProps {
  fullCalendarEvents: EventInput[]
  onTaskReceive: (arg: EventReceiveArg) => Promise<void>
  onEventDrop: (arg: EventDropArg) => Promise<void>
  onEventResize: (arg: EventResizeDoneArg) => Promise<void>
  onEventClick: (arg: EventClickArg) => void
  onCalendarRangeChange: (range: { start: string; end: string }) => void
  externalTasksRef: RefObject<HTMLDivElement | null>
  unscheduledTasks: Task[]
  projectMap: Map<number, Project>
  eventForm: CreateEventRequest
  setEventForm: Dispatch<SetStateAction<CreateEventRequest>>
  eventFormRecurrence: RecurrenceState
  setEventFormRecurrence: Dispatch<SetStateAction<RecurrenceState>>
  projectSummaries: ProjectSummary[]
  eventTypes: EventType[]
  onSaveEventForm: () => void
  isoToDatetimeLocal: (value: string | null) => string
  datetimeLocalToIso: (value: string) => string | null
}

export function CalendarScreen({
  fullCalendarEvents,
  onTaskReceive,
  onEventDrop,
  onEventResize,
  onEventClick,
  onCalendarRangeChange,
  externalTasksRef,
  unscheduledTasks,
  projectMap,
  eventForm,
  setEventForm,
  eventFormRecurrence,
  setEventFormRecurrence,
  projectSummaries,
  eventTypes,
  onSaveEventForm,
  isoToDatetimeLocal,
  datetimeLocalToIso,
}: CalendarScreenProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr,0.8fr]">
      <Section title="Block the Work" eyebrow="Calendar">
        <div className="grid gap-5 xl:grid-cols-[1.45fr,0.65fr]">
          <div className="overflow-hidden rounded-[28px] border border-forge-steel/20 bg-white p-3">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              initialView="timeGridWeek"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek',
              }}
              events={fullCalendarEvents}
              height={720}
              droppable
              editable
              allDaySlot={false}
              eventReceive={(arg) => void onTaskReceive(arg)}
              eventDrop={(arg) => void onEventDrop(arg)}
              eventResize={(arg) => void onEventResize(arg)}
              eventClick={onEventClick}
              datesSet={(arg: DatesSetArg) =>
                onCalendarRangeChange({
                  start: arg.start.toISOString(),
                  end: arg.end.toISOString(),
                })
              }
            />
          </div>
          <div ref={externalTasksRef} className="rounded-[28px] border border-forge-steel/20 bg-[#f8f4ed] p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-forge-steel">Drag Source</p>
            <h3 className="mt-2 font-display text-2xl">Unscheduled tasks</h3>
            <div className="mt-4 space-y-3">
              {unscheduledTasks.length === 0 ? (
                <EmptyState title="Nothing waiting for a work block." compact />
              ) : (
                unscheduledTasks.map((task) => (
                  <div
                    key={task.id}
                    data-task-id={task.id}
                    data-task-title={task.title}
                    className="cursor-grab rounded-3xl border border-forge-steel/20 bg-white px-4 py-3"
                  >
                    <div className="font-medium">{task.title}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-forge-steel">
                      {task.project_id
                        ? projectMap.get(task.project_id)?.name ?? `Project #${task.project_id}`
                        : 'Inbox task'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Section>
      <Section title="Create Event" eyebrow="Direct">
        <Field
          label="Title"
          value={eventForm.title}
          onChange={(value) => setEventForm({ ...eventForm, title: value })}
        />
        <Select
          label="Project"
          value={eventForm.project_id === null ? 'unassigned' : String(eventForm.project_id)}
          onChange={(value) =>
            setEventForm({
              ...eventForm,
              project_id: value === 'unassigned' ? null : Number(value),
            })
          }
          options={[
            { value: 'unassigned', label: 'Unassigned' },
            ...projectSummaries.map((summary) => ({
              value: String(summary.project.id),
              label: summary.project.name,
            })),
          ]}
        />
        <Field
          label="Start"
          value={isoToDatetimeLocal(eventForm.start_at)}
          onChange={(value) =>
            setEventForm({
              ...eventForm,
              start_at: datetimeLocalToIso(value) ?? eventForm.start_at,
            })
          }
          type="datetime-local"
        />
        <Field
          label="End"
          value={isoToDatetimeLocal(eventForm.end_at)}
          onChange={(value) =>
            setEventForm({
              ...eventForm,
              end_at: datetimeLocalToIso(value) ?? eventForm.end_at,
            })
          }
          type="datetime-local"
        />
        <Field
          label="Timezone"
          value={eventForm.timezone}
          onChange={(value) => setEventForm({ ...eventForm, timezone: value })}
          placeholder="UTC"
        />
        <Select
          label="Event Type"
          value={eventForm.event_type}
          onChange={(value) => setEventForm({ ...eventForm, event_type: value as EventType })}
          options={eventTypes.map((eventType) => ({ value: eventType, label: eventType }))}
        />
        <RecurrenceBuilder
          startValue={eventForm.start_at}
          endValue={eventForm.end_at}
          timeFormat="iso"
          value={eventFormRecurrence}
          onChange={setEventFormRecurrence}
          onEndValueChange={(value) => setEventForm({ ...eventForm, end_at: value })}
        />
        <button className="forge-button mt-4" onClick={onSaveEventForm} type="button">
          Create event
        </button>
      </Section>
    </div>
  )
}

interface SettingsScreenProps {
  apiBaseUrl: string
  runtimeHealth: HealthResponse | null
  eventTimezone: string
  calendarEventsCount: number
}

export function SettingsScreen({
  apiBaseUrl,
  runtimeHealth,
  eventTimezone,
  calendarEventsCount,
}: SettingsScreenProps) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <Section title="Local API" eyebrow="Runtime">
        <Setting label="Base URL" value={apiBaseUrl} />
        <Setting label="Mode" value="Loopback-only, local-first" />
        <Setting label="Status" value={runtimeHealth?.status ?? 'unknown'} />
        <Setting label="Started" value={runtimeHealth ? fmt(runtimeHealth.started_at) : 'Unavailable'} />
        <Setting
          label="First run"
          value={runtimeHealth ? (runtimeHealth.first_run ? 'yes' : 'no') : 'unknown'}
        />
      </Section>
      <Section title="Paths" eyebrow="Storage">
        <Setting label="Database" value={runtimeHealth?.paths.database ?? '~/.forge/forge.db'} />
        <Setting label="Config" value={runtimeHealth?.paths.config ?? '~/.forge/config.toml'} />
        <Setting label="Logs" value={runtimeHealth?.paths.logs ?? '~/.forge/logs/'} />
        <Setting label="Daemon log" value={runtimeHealth?.paths.daemon_log ?? '~/.forge/logs/forged.log'} />
      </Section>
      <Section title="Defaults" eyebrow="Environment">
        <Setting label="Timezone" value={eventTimezone} />
        <Setting label="Calendar span" value={`${calendarEventsCount} loaded events`} />
      </Section>
      <Section title="Keyboard" eyebrow="Workflow">
        <Setting label="1-5" value="Navigate Today, Projects, Tasks, Calendar, Settings" />
        <Setting label="Ctrl/Cmd+Enter" value="Save the active project, task, or event editor" />
        <Setting label="Escape" value="Cancel inline edits or close the active dialog" />
        <Setting label="Delete" value="Open delete confirmation for the active editor" />
      </Section>
    </div>
  )
}
