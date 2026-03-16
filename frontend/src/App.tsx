import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import type { EventClickArg, EventDropArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin, {
  Draggable,
  type EventReceiveArg,
  type EventResizeDoneArg,
} from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import timeGridPlugin from '@fullcalendar/timegrid'
import {
  CalendarRange,
  CircleDot,
  ClipboardList,
  FolderKanban,
  LoaderCircle,
  MoreHorizontal,
  Orbit,
  PencilLine,
  Settings2,
} from 'lucide-react'
import { forgeApi, resolveApiBaseUrl } from './api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { RecurrenceBuilder } from './components/recurrence-builder'
import { ScheduleWidget } from './components/schedule-widget'
import { ColorPicker } from './components/color-picker'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { useToast } from './components/ui/use-toast'
import {
  normalizeRRule,
  validateEventMutationDraft,
} from './lib/event-validation'
import { isTypingTarget, screenFromShortcut, type ShortcutScreen } from './lib/keyboard'
import { invalidateForgeQueries } from './lib/query'
import {
  buildRRule,
  createDefaultRecurrenceState,
  recurrenceStateFromRule,
  type RecurrenceState,
} from './lib/recurrence'
import { buildTaskLanes } from './lib/task-board'
import type {
  CreateEventRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  EventRecord,
  EventType,
  HealthResponse,
  Project,
  ProjectRepoStatus,
  ProjectStatus,
  Task,
  TaskListQuery,
  TaskPriority,
  TaskStatus,
  UpdateEventRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from './types'

type Screen = ShortcutScreen

interface ProjectEditorState {
  id: number
  name: string
  description: string
  color: string
  status: ProjectStatus
  tags: string
  workdir_path: string
}

interface TaskEditorState {
  id: number
  title: string
  description: string
  project_id: string
  priority: TaskPriority
  due_at: string
  estimate_minutes: string
  tags: string
  notes: string
  status: TaskStatus
}

interface EventEditorState {
  id: number
  title: string
  description: string
  project_id: string
  linked_task_id: number | null
  start_at: string
  end_at: string
  timezone: string
  event_type: EventType
  rrule: string
  notes: string
}

interface DeleteIntent {
  kind: 'project' | 'task' | 'event'
  id: number
  title: string
  description: string
}

const screens: Array<{ id: Screen; label: string; icon: typeof Orbit }> = [
  { id: 'today', label: 'Today', icon: Orbit },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'calendar', label: 'Calendar', icon: CalendarRange },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

const taskStatuses: Array<TaskStatus | 'all'> = [
  'all',
  'todo',
  'scheduled',
  'in_progress',
  'blocked',
  'done',
  'canceled',
]
const taskPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const projectStatuses: ProjectStatus[] = ['active', 'paused', 'archived']
const eventTypes: EventType[] = [
  'meeting',
  'work_block',
  'research',
  'implementation',
  'admin',
  'review',
  'personal',
  'other',
]

function fmt(value: string | null) {
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

function datetimeLocalToIso(value: string) {
  return value ? new Date(value).toISOString() : null
}

function isoToDatetimeLocal(value: string | null) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function parseTags(input: string) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

async function pickLocalDirectory() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error('Native directory picker is only available in the desktop app.')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string | null>('pick_directory')
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

export default function App() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [screen, setScreen] = useState<Screen>('today')
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:37241')
  const [startupError, setStartupError] = useState<string | null>(null)
  const [taskSearch, setTaskSearch] = useState('')
  const deferredTaskSearch = useDeferredValue(taskSearch)
  const [projectFilter, setProjectFilter] = useState<number | 'all' | 'inbox'>('all')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [dragTaskId, setDragTaskId] = useState<number | null>(null)
  const [dragLaneProjectId, setDragLaneProjectId] = useState<number | null | 'inbox'>(null)
  const [calendarRange, setCalendarRange] = useState({
    start: new Date().toISOString(),
    end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
  })
  const externalTasksRef = useRef<HTMLDivElement | null>(null)
  const screenButtonRefs = useRef<Record<Screen, HTMLButtonElement | null>>({
    today: null,
    projects: null,
    tasks: null,
    calendar: null,
    settings: null,
  })

  const [projectForm, setProjectForm] = useState<CreateProjectRequest>({
    name: '',
    description: '',
    status: 'active',
    tags: [],
    color: '#6f8466',
    workdir_path: null,
  })
  const [taskForm, setTaskForm] = useState<CreateTaskRequest>({
    title: '',
    description: '',
    project_id: null,
    status: 'todo',
    priority: 'medium',
    due_at: null,
    scheduled_start: null,
    scheduled_end: null,
    estimate_minutes: 60,
    tags: [],
    notes: '',
    source: 'ui',
  })
  const [eventForm, setEventForm] = useState<CreateEventRequest>({
    title: '',
    description: '',
    project_id: null,
    linked_task_id: null,
    start_at: new Date().toISOString(),
    end_at: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    event_type: 'implementation',
    rrule: null,
    recurrence_exceptions: [],
    notes: '',
  })
  const [eventFormRecurrence, setEventFormRecurrence] = useState<RecurrenceState>(() =>
    createDefaultRecurrenceState(new Date().toISOString()),
  )
  const [projectEditor, setProjectEditor] = useState<ProjectEditorState | null>(null)
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false)
  const [taskEditor, setTaskEditor] = useState<TaskEditorState | null>(null)
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false)
  const [eventEditor, setEventEditor] = useState<EventEditorState | null>(null)
  const [eventEditorRecurrence, setEventEditorRecurrence] = useState<RecurrenceState | null>(null)
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null)
  const [inlineProjectEdit, setInlineProjectEdit] = useState<{ id: number | null; name: string }>({
    id: null,
    name: '',
  })
  const [inlineTaskEdit, setInlineTaskEdit] = useState<{ id: number | null; title: string }>({
    id: null,
    title: '',
  })

  useEffect(() => {
    resolveApiBaseUrl()
      .then((baseUrl) => {
        setApiBaseUrl(baseUrl)
        setStartupError(null)
      })
      .catch((error) => {
        setStartupError(error instanceof Error ? error.message : String(error))
      })
  }, [])

  const projectsQuery = useQuery({
    queryKey: ['projects', apiBaseUrl],
    queryFn: () => forgeApi.listProjects(apiBaseUrl),
  })

  const projectStatusesQuery = useQuery({
    queryKey: ['project-statuses', apiBaseUrl],
    queryFn: () => forgeApi.listProjectStatuses(apiBaseUrl, true),
    enabled: Boolean(apiBaseUrl) && !startupError,
  })

  const tasksQuery = useQuery({
    queryKey: ['tasks', apiBaseUrl, projectFilter, statusFilter, deferredTaskSearch],
    queryFn: () => {
      const query: TaskListQuery = { search: deferredTaskSearch || undefined }
      if (projectFilter === 'inbox') {
        query.inbox_only = true
      } else if (typeof projectFilter === 'number') {
        query.project_id = projectFilter
      }
      if (statusFilter !== 'all') {
        query.status = statusFilter
      }
      return forgeApi.listTasks(apiBaseUrl, query)
    },
  })

  const eventsQuery = useQuery({
    queryKey: ['events', apiBaseUrl],
    queryFn: () => forgeApi.listEvents(apiBaseUrl),
  })

  const todayQuery = useQuery({
    queryKey: ['today', apiBaseUrl],
    queryFn: () => forgeApi.getToday(apiBaseUrl),
  })

  const healthQuery = useQuery({
    queryKey: ['health', apiBaseUrl],
    queryFn: () => forgeApi.getHealth(apiBaseUrl),
    enabled: Boolean(apiBaseUrl) && !startupError,
  })

  const calendarQuery = useQuery({
    queryKey: ['calendar', apiBaseUrl, calendarRange.start, calendarRange.end],
    queryFn: () => forgeApi.calendarRange(apiBaseUrl, calendarRange),
  })

  const projectSummaries = projectsQuery.data ?? []
  const tasks = tasksQuery.data ?? []
  const rawEvents = eventsQuery.data ?? []
  const calendarEvents = calendarQuery.data ?? []
  const today = todayQuery.data
  const runtimeHealth: HealthResponse | null = healthQuery.data ?? null
  const projectMap = useMemo(
    () => new Map(projectSummaries.map((summary) => [summary.project.id, summary.project])),
    [projectSummaries],
  )
  const projectStatusMap = useMemo(
    () => new Map((projectStatusesQuery.data ?? []).map((status) => [status.project_id, status])),
    [projectStatusesQuery.data],
  )

  const unscheduledTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          !task.scheduled_start &&
          !task.scheduled_end &&
          task.status !== 'done' &&
          task.status !== 'canceled',
      ),
    [tasks],
  )
  const taskLanes = useMemo(
    () => buildTaskLanes(tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled'), projectSummaries),
    [projectSummaries, tasks],
  )

  useEffect(() => {
    if (!externalTasksRef.current) {
      return
    }
    const draggable = new Draggable(externalTasksRef.current, {
      itemSelector: '[data-task-id]',
      eventData: (element) => ({
        title: element.getAttribute('data-task-title') ?? 'Task',
        duration: '01:30',
      }),
    })
    return () => draggable.destroy()
  }, [unscheduledTasks])

  const invalidate = () => invalidateForgeQueries(queryClient)

  function restoreShellFocus() {
    window.setTimeout(() => {
      screenButtonRefs.current[screen]?.focus()
    }, 0)
  }

  function notifyError(title: string, error: unknown) {
    toast({
      title,
      description: error instanceof Error ? error.message : 'Unknown mutation failure',
      variant: 'destructive',
    })
  }

  const createProject = useMutation({
    mutationFn: (payload: CreateProjectRequest) => forgeApi.createProject(apiBaseUrl, payload),
    onSuccess: async () => {
      setProjectForm({
        name: '',
        description: '',
        status: 'active',
        tags: [],
        color: projectForm.color,
        workdir_path: null,
      })
      setIsCreateProjectOpen(false)
      await invalidate()
    },
    onError: (error) => notifyError('Failed to create project', error),
  })

  const updateProject = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateProjectRequest }) =>
      forgeApi.updateProject(apiBaseUrl, id, payload),
    onSuccess: async () => {
      setProjectEditor(null)
      restoreShellFocus()
      await invalidate()
    },
    onError: (error) => notifyError('Failed to update project', error),
  })

  const deleteProject = useMutation({
    mutationFn: (id: number) => forgeApi.deleteProject(apiBaseUrl, id),
    onSuccess: async () => {
      setScreen('projects')
      setProjectEditor(null)
      restoreShellFocus()
      await invalidate()
    },
    onError: (error) => notifyError('Failed to delete project', error),
  })
  const createTask = useMutation({
    mutationFn: (payload: CreateTaskRequest) => forgeApi.createTask(apiBaseUrl, payload),
    onSuccess: async () => {
      setTaskForm({ ...taskForm, title: '', description: '', due_at: null, notes: '' })
      setIsCreateTaskOpen(false)
      await invalidate()
    },
    onError: (error) => notifyError('Failed to create task', error),
  })

  const updateTask = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateTaskRequest }) =>
      forgeApi.updateTask(apiBaseUrl, id, payload),
    onSuccess: async () => {
      setTaskEditor(null)
      restoreShellFocus()
      await invalidate()
    },
    onError: (error) => notifyError('Failed to update task', error),
  })

  const deleteTask = useMutation({
    mutationFn: (id: number) => forgeApi.deleteTask(apiBaseUrl, id),
    onSuccess: async () => {
      setTaskEditor(null)
      setInlineTaskEdit({ id: null, title: '' })
      restoreShellFocus()
      await invalidate()
    },
    onError: (error) => notifyError('Failed to delete task', error),
  })

  const completeTask = useMutation({
    mutationFn: (taskId: number) => forgeApi.completeTask(apiBaseUrl, taskId),
    onSuccess: invalidate,
    onError: (error) => notifyError('Failed to complete task', error),
  })

  const clearDone = useMutation({
    mutationFn: () => forgeApi.clearDone(apiBaseUrl),
    onSuccess: invalidate,
    onError: (error) => notifyError('Failed to clear completed tasks', error),
  })

  const createEvent = useMutation({
    mutationFn: (payload: CreateEventRequest) => forgeApi.createEvent(apiBaseUrl, payload),
    onSuccess: async () => {
      setEventForm({
        title: '',
        description: '',
        project_id: null,
        linked_task_id: null,
        start_at: new Date().toISOString(),
        end_at: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        event_type: 'implementation',
        rrule: null,
        recurrence_exceptions: [],
        notes: '',
      })
      setEventFormRecurrence(createDefaultRecurrenceState(new Date().toISOString()))
      await invalidate()
    },
    onError: (error) => notifyError('Failed to create event', error),
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateEventRequest }) =>
      forgeApi.updateEvent(apiBaseUrl, id, payload),
    onSuccess: async () => {
      setEventEditor(null)
      setEventEditorRecurrence(null)
      restoreShellFocus()
      await invalidate()
    },
    onError: (error) => notifyError('Failed to update event', error),
  })

  const deleteEvent = useMutation({
    mutationFn: (id: number) => forgeApi.deleteEvent(apiBaseUrl, id),
    onSuccess: async () => {
      setEventEditor(null)
      setEventEditorRecurrence(null)
      restoreShellFocus()
      await invalidate()
    },
    onError: (error) => notifyError('Failed to delete event', error),
  })

  const loading =
    projectsQuery.isLoading ||
    tasksQuery.isLoading ||
    eventsQuery.isLoading ||
    todayQuery.isLoading ||
    calendarQuery.isLoading

  async function handleTaskReceive(arg: EventReceiveArg) {
    const taskId = Number(arg.draggedEl.getAttribute('data-task-id'))
    const task = unscheduledTasks.find((item) => item.id === taskId)
    if (!task) {
      arg.revert()
      return
    }
    const start = arg.event.start ?? new Date()
    const end = arg.event.end ?? new Date(start.getTime() + 1000 * 60 * 90)
    const draftError = validateEventMutationDraft({
      title: task.title,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: eventForm.timezone,
      rrule: null,
    })
    if (draftError) {
      arg.revert()
      toast({
        title: 'Failed to schedule task',
        description: draftError,
        variant: 'destructive',
      })
      return
    }
    try {
      await createEvent.mutateAsync({
        title: task.title,
        description: task.description,
        project_id: task.project_id,
        linked_task_id: task.id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        timezone: eventForm.timezone,
        event_type: 'implementation',
        rrule: null,
        recurrence_exceptions: [],
        notes: task.notes,
      })
    } catch {
      arg.revert()
    }
  }

  async function handleEventDrop(arg: EventDropArg) {
    const eventId = Number(arg.event.extendedProps.eventId)
    const original = rawEvents.find((event) => event.id === eventId)
    if (!original || !arg.event.start) {
      arg.revert()
      return
    }
    const fallbackDuration =
      new Date(original.end_at).getTime() - new Date(original.start_at).getTime()
    const nextEnd = arg.event.end ?? new Date(arg.event.start.getTime() + fallbackDuration)
    const draftError = validateEventMutationDraft({
      title: original.title,
      startAt: arg.event.start.toISOString(),
      endAt: nextEnd.toISOString(),
      timezone: original.timezone,
      rrule: original.rrule,
    })
    if (draftError) {
      arg.revert()
      toast({
        title: 'Failed to reschedule event',
        description: draftError,
        variant: 'destructive',
      })
      return
    }
    try {
      await updateEvent.mutateAsync({
        id: eventId,
        payload: {
          start_at: arg.event.start.toISOString(),
          end_at: nextEnd.toISOString(),
        },
      })
    } catch {
      arg.revert()
    }
  }

  async function handleEventResize(arg: EventResizeDoneArg) {
    const eventId = Number(arg.event.extendedProps.eventId)
    const original = rawEvents.find((event) => event.id === eventId)
    if (!arg.event.start || !arg.event.end) {
      arg.revert()
      return
    }
    if (!original) {
      arg.revert()
      return
    }
    const draftError = validateEventMutationDraft({
      title: original.title,
      startAt: arg.event.start.toISOString(),
      endAt: arg.event.end.toISOString(),
      timezone: original.timezone,
      rrule: original.rrule,
    })
    if (draftError) {
      arg.revert()
      toast({
        title: 'Failed to resize event',
        description: draftError,
        variant: 'destructive',
      })
      return
    }
    try {
      await updateEvent.mutateAsync({
        id: eventId,
        payload: {
          start_at: arg.event.start.toISOString(),
          end_at: arg.event.end.toISOString(),
        },
      })
    } catch {
      arg.revert()
    }
  }

  function handleEventClick(arg: EventClickArg) {
    const eventId = Number(arg.event.extendedProps.eventId)
    const event = rawEvents.find((item) => item.id === eventId)
    if (!event) {
      return
    }
    setEventEditor({
      id: event.id,
      title: event.title,
      description: event.description,
      project_id: event.project_id === null ? 'unassigned' : String(event.project_id),
      linked_task_id: event.linked_task_id,
      start_at: isoToDatetimeLocal(event.start_at),
      end_at: isoToDatetimeLocal(event.end_at),
      timezone: event.timezone,
      event_type: event.event_type,
      rrule: event.rrule ?? '',
      notes: event.notes,
    })
    setEventEditorRecurrence(recurrenceStateFromRule(event.rrule, event.start_at))
  }

  function handleTaskLaneDragStart(
    event: ReactDragEvent<HTMLDivElement>,
    taskId: number,
  ) {
    setDragTaskId(taskId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-forge-task-id', String(taskId))
  }

  function handleTaskLaneDragEnd() {
    setDragTaskId(null)
    setDragLaneProjectId(null)
  }

  async function moveTaskToLane(
    event: ReactDragEvent<HTMLDivElement>,
    projectId: number | null,
  ) {
    const payloadTaskId = Number(
      event.dataTransfer.getData('application/x-forge-task-id') || dragTaskId,
    )
    if (!payloadTaskId) {
      return
    }
    const task = tasks.find((item) => item.id === payloadTaskId)
    if (!task || task.project_id === projectId) {
      handleTaskLaneDragEnd()
      return
    }

    try {
      await updateTask.mutateAsync({
        id: task.id,
        payload: {
          project_id: projectId,
          source: 'ui',
        },
      })
    } finally {
      handleTaskLaneDragEnd()
    }
  }

  function openProjectEditor(project: Project) {
    setProjectEditor({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status,
      tags: project.tags.join(', '),
      workdir_path: project.workdir_path ?? '',
    })
  }

  function openTaskEditor(task: Task) {
    setTaskEditor({
      id: task.id,
      title: task.title,
      description: task.description,
      project_id: task.project_id === null ? 'inbox' : String(task.project_id),
      priority: task.priority,
      due_at: isoToDatetimeLocal(task.due_at),
      estimate_minutes: task.estimate_minutes ? String(task.estimate_minutes) : '',
      tags: task.tags.join(', '),
      notes: task.notes,
      status: task.status,
    })
  }

  async function saveInlineTaskTitle(taskId: number) {
    if (!inlineTaskEdit.title.trim()) {
      return
    }
    await updateTask.mutateAsync({
      id: taskId,
      payload: { title: inlineTaskEdit.title.trim(), source: 'ui' },
    })
    setInlineTaskEdit({ id: null, title: '' })
  }

  async function saveInlineProjectName(projectId: number) {
    if (!inlineProjectEdit.name.trim()) {
      return
    }
    await updateProject.mutateAsync({
      id: projectId,
      payload: { name: inlineProjectEdit.name.trim() },
    })
    setInlineProjectEdit({ id: null, name: '' })
  }

  function saveProjectEditor() {
    if (!projectEditor) {
      return
    }
    const nextWorkdir = projectEditor.workdir_path.trim()
    updateProject.mutate({
      id: projectEditor.id,
      payload: {
        name: projectEditor.name,
        description: projectEditor.description,
        status: projectEditor.status,
        tags: parseTags(projectEditor.tags),
        color: projectEditor.color,
        workdir_path: nextWorkdir ? nextWorkdir : null,
      },
    })
  }

  async function handleProjectDirectoryPick(mode: 'create' | 'edit') {
    try {
      const selected = await pickLocalDirectory()
      if (!selected) {
        return
      }
      if (mode === 'create') {
        setProjectForm((current) => ({ ...current, workdir_path: selected }))
        return
      }
      setProjectEditor((current) =>
        current
          ? {
              ...current,
              workdir_path: selected,
            }
          : current,
      )
    } catch (error) {
      notifyError('Failed to pick project folder', error)
    }
  }

  function saveTaskEditor() {
    if (!taskEditor) {
      return
    }
    updateTask.mutate({
      id: taskEditor.id,
      payload: {
        title: taskEditor.title,
        description: taskEditor.description,
        project_id: taskEditor.project_id === 'inbox' ? null : Number(taskEditor.project_id),
        priority: taskEditor.priority,
        due_at: datetimeLocalToIso(taskEditor.due_at),
        estimate_minutes: taskEditor.estimate_minutes ? Number(taskEditor.estimate_minutes) : null,
        tags: parseTags(taskEditor.tags),
        notes: taskEditor.notes,
        status: taskEditor.status,
        source: 'ui',
      },
    })
  }

  function saveEventEditor() {
    if (!eventEditor || !eventEditorRecurrence) {
      return
    }
    const payloadStart = datetimeLocalToIso(eventEditor.start_at)
    const payloadEnd = datetimeLocalToIso(eventEditor.end_at)
    const payloadRRule = normalizeRRule(buildRRule(eventEditorRecurrence, payloadStart ?? eventEditor.start_at))
    const draftError = validateEventMutationDraft({
      title: eventEditor.title,
      startAt: payloadStart,
      endAt: payloadEnd,
      timezone: eventEditor.timezone,
      rrule: payloadRRule,
    })
    if (draftError) {
      toast({
        title: 'Failed to update event',
        description: draftError,
        variant: 'destructive',
      })
      return
    }
    updateEvent.mutate({
      id: eventEditor.id,
      payload: {
        title: eventEditor.title.trim(),
        description: eventEditor.description,
        project_id: eventEditor.project_id === 'unassigned' ? null : Number(eventEditor.project_id),
        start_at: payloadStart ?? undefined,
        end_at: payloadEnd ?? undefined,
        timezone: eventEditor.timezone,
        event_type: eventEditor.event_type,
        rrule: payloadRRule,
        notes: eventEditor.notes,
      },
    })
  }

  function saveEventForm() {
    const payloadRRule = normalizeRRule(buildRRule(eventFormRecurrence, eventForm.start_at))
    const draftError = validateEventMutationDraft({
      title: eventForm.title,
      startAt: eventForm.start_at,
      endAt: eventForm.end_at,
      timezone: eventForm.timezone,
      rrule: payloadRRule,
    })
    if (draftError) {
      toast({
        title: 'Failed to create event',
        description: draftError,
        variant: 'destructive',
      })
      return
    }
    createEvent.mutate({
      ...eventForm,
      title: eventForm.title.trim(),
      rrule: payloadRRule,
    })
  }

  function requestDeleteProject(project: Project) {
    setDeleteIntent({
      kind: 'project',
      id: project.id,
      title: project.name,
      description:
        'Tasks in this project will be moved to Inbox. This action cannot be undone.',
    })
  }

  function requestDeleteTask(task: Task) {
    const linkedEvents = rawEvents.filter((event) => event.linked_task_id === task.id)
    setDeleteIntent({
      kind: 'task',
      id: task.id,
      title: task.title,
      description: linkedEvents.length
        ? 'This task has scheduled calendar blocks. Deleting the task will remove them as well.'
        : 'This task will be removed permanently.',
    })
  }

  function requestDeleteEvent(event: EventRecord) {
    setDeleteIntent({
      kind: 'event',
      id: event.id,
      title: event.title,
      description: 'The linked task will remain.',
    })
  }

  async function confirmDeleteIntent() {
    if (!deleteIntent) {
      return
    }
    if (deleteIntent.kind === 'project') {
      await deleteProject.mutateAsync(deleteIntent.id)
    }
    if (deleteIntent.kind === 'task') {
      await deleteTask.mutateAsync(deleteIntent.id)
    }
    if (deleteIntent.kind === 'event') {
      await deleteEvent.mutateAsync(deleteIntent.id)
    }
    setDeleteIntent(null)
    restoreShellFocus()
  }

  useEffect(() => {
    function closeActiveSurface() {
      if (deleteIntent) {
        setDeleteIntent(null)
        restoreShellFocus()
        return
      }
      if (taskEditor) {
        setTaskEditor(null)
        restoreShellFocus()
        return
      }
      if (eventEditor) {
        setEventEditor(null)
        restoreShellFocus()
        return
      }
      if (projectEditor) {
        setProjectEditor(null)
        restoreShellFocus()
        return
      }
      if (inlineTaskEdit.id !== null) {
        setInlineTaskEdit({ id: null, title: '' })
        return
      }
      if (inlineProjectEdit.id !== null) {
        setInlineProjectEdit({ id: null, name: '' })
      }
    }

    function requestDeleteForActiveSurface() {
      if (deleteIntent) {
        return
      }
      if (projectEditor) {
        const project = projectMap.get(projectEditor.id)
        if (project) {
          requestDeleteProject(project)
        }
        return
      }
      if (taskEditor) {
        const task = tasks.find((item) => item.id === taskEditor.id)
        if (task) {
          requestDeleteTask(task)
        }
        return
      }
      if (eventEditor) {
        const activeEvent = rawEvents.find((item) => item.id === eventEditor.id)
        if (activeEvent) {
          requestDeleteEvent(activeEvent)
        }
      }
    }

    function saveActiveSurface() {
      if (deleteIntent || inlineTaskEdit.id !== null || inlineProjectEdit.id !== null) {
        return
      }
      if (projectEditor) {
        saveProjectEditor()
        return
      }
      if (taskEditor) {
        saveTaskEditor()
        return
      }
      if (eventEditor) {
        saveEventEditor()
      }
    }

    function handleKeyboardShortcuts(event: KeyboardEvent) {
      const typing = isTypingTarget(event.target)
      const hasActiveSurface =
        deleteIntent !== null ||
        projectEditor !== null ||
        taskEditor !== null ||
        eventEditor !== null ||
        inlineTaskEdit.id !== null ||
        inlineProjectEdit.id !== null

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        saveActiveSurface()
        return
      }

      if (event.key === 'Escape' && hasActiveSurface) {
        event.preventDefault()
        closeActiveSurface()
        return
      }

      if (event.key === 'Delete' && !typing) {
        event.preventDefault()
        requestDeleteForActiveSurface()
        return
      }

      if (typing || hasActiveSurface || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const nextScreen = screenFromShortcut(event.key)
      if (nextScreen) {
        event.preventDefault()
        startTransition(() => setScreen(nextScreen))
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcuts)
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts)
  }, [
    deleteIntent,
    eventEditor,
    inlineProjectEdit.id,
    inlineTaskEdit.id,
    projectEditor,
    projectMap,
    rawEvents,
    screen,
    taskEditor,
    tasks,
  ])

  const fullCalendarEvents = calendarEvents.map((event) => {
    const project = event.project_id ? projectMap.get(event.project_id) : undefined
    return {
      id: `${event.event_id}:${event.occurrence_start}`,
      title: event.title,
      start: event.occurrence_start,
      end: event.occurrence_end,
      backgroundColor: project?.color ?? '#8a7d68',
      borderColor: project?.color ?? '#8a7d68',
      extendedProps: {
        eventId: event.event_id,
        isRecurring: event.is_recurring,
      },
    }
  })

  return (
    <div className="min-h-screen bg-[#ece4d8] text-forge-ink">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 p-4 md:p-6">
        <aside className="w-full shrink-0 max-w-[290px] rounded-[30px] border border-forge-steel/35 bg-forge-night p-5 text-forge-paper shadow-panel">
          <p className="text-xs uppercase tracking-[0.35em] text-forge-steel">Forge</p>
          <h1 className="mt-2 font-display text-4xl">Work OS</h1>
          <p className="mt-3 text-sm text-white/70">
            Local execution, scheduling, and mutation through one write path.
          </p>

          <nav className="mt-6 space-y-2">
            {screens.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                ref={(element) => {
                  screenButtonRefs.current[id] = element
                }}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ${
                  screen === id ? 'bg-[#f2ece0] text-forge-night' : 'bg-white/5 text-white/80'
                }`}
                onClick={() => startTransition(() => setScreen(id))}
                type="button"
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-8 grid grid-cols-2 gap-3 rounded-[26px] border border-white/10 bg-white/5 p-4 text-sm">
            <Stat label="Projects" value={String(projectSummaries.length)} />
            <Stat label="Tasks" value={String(tasks.length)} />
            <Stat label="Events" value={String(rawEvents.length)} />
            <Stat label="API" value={startupError || todayQuery.isError ? 'down' : 'ready'} />
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">
          <header className="rounded-[34px] border border-forge-steel/35 bg-[radial-gradient(circle_at_top_left,_rgba(217,107,43,0.24),_transparent_42%),linear-gradient(135deg,#201b17,#332b24)] p-6 text-forge-paper shadow-panel">
            <p className="text-xs uppercase tracking-[0.35em] text-[#c7b39c]">Operator View</p>
            <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight md:text-5xl">
              Build with force, not fragmentation.
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Metric label="Date" value={today?.date ?? new Date().toISOString().slice(0, 10)} />
              <Metric
                label="Focus"
                value={
                  today?.focus?.task_id
                    ? `Task #${today.focus.task_id}`
                    : today?.focus?.project_id
                      ? `Project #${today.focus.project_id}`
                      : 'Unset'
                }
              />
              <Metric label="API" value={apiBaseUrl} subtle />
            </div>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-[#c7b39c]">
              <span className="rounded-full border border-white/10 px-3 py-1">1-5 navigate</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Ctrl/Cmd+Enter save</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Esc cancel</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Delete confirm</span>
            </div>
          </header>
          {startupError ? (
            <div className="mt-6 rounded-3xl border border-[#c58f80] bg-[#f7e4dc] px-5 py-4 text-sm text-[#6d2a1f]">
              <div className="font-medium">Forge could not start the local daemon.</div>
              <div className="mt-2 whitespace-pre-wrap">{startupError}</div>
            </div>
          ) : loading ? (
            <div className="mt-6 flex items-center gap-3 rounded-3xl border border-forge-steel/30 bg-white/80 px-5 py-4">
              <LoaderCircle className="size-4 animate-spin text-forge-ember" />
              <span className="text-sm">Loading Forge state...</span>
            </div>
          ) : (
            <div className="mt-6">
              {screen === 'today' && today && (
                <div className="grid gap-5 xl:grid-cols-[1.2fr,0.9fr]">
                  <Section title="Execution Queue" eyebrow="Today">
                    {today.today_tasks.length === 0 ? (
                      <Empty label="No tasks are scheduled or due today." />
                    ) : (
                      today.today_tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          project={task.project_id ? projectMap.get(task.project_id) : undefined}
                          onComplete={() => completeTask.mutate(task.id)}
                          onEdit={() => openTaskEditor(task)}
                          onDelete={() => requestDeleteTask(task)}
                        />
                      ))
                    )}
                  </Section>
                  <div className="grid gap-5">
                    <ScheduleWidget 
                      events={calendarEvents.map(e => ({ 
                        id: String(e.event_id), 
                        title: e.title, 
                        date: e.occurrence_start 
                      }))} 
                    />
                    <Section title="Overdue" eyebrow="Recovery">
                      {today.overdue_tasks.length === 0 ? (
                        <Empty label="No overdue tasks." compact />
                      ) : (
                        today.overdue_tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            project={task.project_id ? projectMap.get(task.project_id) : undefined}
                            onComplete={() => completeTask.mutate(task.id)}
                            onEdit={() => openTaskEditor(task)}
                            onDelete={() => requestDeleteTask(task)}
                            compact
                          />
                        ))
                      )}
                    </Section>
                  </div>
                </div>
              )}

              {screen === 'projects' && (
                <div className="grid gap-5">
                  <Section title="Active Surfaces" eyebrow="Projects">
                    <div className="flex justify-end mb-4">
                      <button className="forge-button bg-forge-night text-white border-none" onClick={() => setIsCreateProjectOpen(true)} type="button">New Project</button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {projectSummaries.map((summary) => (
                        <article key={summary.project.id} className="rounded-[26px] border border-forge-steel/20 bg-[#f9f6f0] p-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="h-3 w-20 rounded-full" style={{ backgroundColor: summary.project.color }} />
                            <div className="flex gap-2">
                              <button className="icon-button" onClick={() => openProjectEditor(summary.project)} type="button"><PencilLine className="size-4" /></button>
                            </div>
                          </div>
                          {inlineProjectEdit.id === summary.project.id ? (
                            <input
                              autoFocus
                              className="forge-input mt-4 font-display text-2xl"
                              value={inlineProjectEdit.name}
                              onBlur={() => void saveInlineProjectName(summary.project.id)}
                              onChange={(event) => setInlineProjectEdit({ id: summary.project.id, name: event.target.value })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void saveInlineProjectName(summary.project.id)
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
                          <p className="mt-2 text-sm text-forge-night/70">{summary.project.description || 'No description yet.'}</p>
                          <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-forge-steel">
                            <span>{summary.project.status}</span>
                            {summary.project.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-forge-paper px-3 py-1">{tag}</span>
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
              )}

              {screen === 'tasks' && (
                <div className="grid gap-5">
                  <div className="grid gap-5">
                    <Section title="Reassign by Drag" eyebrow="Board">
                      <div className="flex justify-end mb-4">
                        <button className="forge-button bg-forge-night text-white border-none" onClick={() => setIsCreateTaskOpen(true)} type="button">New Task</button>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="max-w-2xl text-sm text-forge-night/72">
                          Drag operational tasks between Inbox and project lanes. The board follows the active task filter, and lane changes only render after the daemon API confirms the mutation.
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
                                void moveTaskToLane(event, lane.projectId)
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div
                                    className="h-2.5 w-20 rounded-full"
                                    style={{ backgroundColor: lane.color }}
                                  />
                                  <h3 className="mt-3 font-display text-2xl text-forge-night">{lane.title}</h3>
                                </div>
                                <div className="rounded-full bg-white px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-forge-steel">
                                  {lane.tasks.length} tasks
                                </div>
                              </div>
                              <div className="mt-4 space-y-3">
                                {lane.tasks.length === 0 ? (
                                  <Empty label={dragTaskId !== null ? 'Drop a task here.' : 'No active tasks in this lane.'} compact />
                                ) : (
                                  lane.tasks.map((task) => (
                                    <TaskLaneCard
                                      key={task.id}
                                      task={task}
                                      project={task.project_id ? projectMap.get(task.project_id) : undefined}
                                      dragging={dragTaskId === task.id}
                                      onDelete={() => requestDeleteTask(task)}
                                      onDragEnd={handleTaskLaneDragEnd}
                                      onDragStart={(event) => handleTaskLaneDragStart(event, task.id)}
                                      onEdit={() => openTaskEditor(task)}
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
                          onChange={(value) => setProjectFilter(value === 'all' || value === 'inbox' ? value : Number(value))}
                          options={[
                            { value: 'all', label: 'All projects' },
                            { value: 'inbox', label: 'Inbox only' },
                            ...projectSummaries.map((summary) => ({ value: String(summary.project.id), label: summary.project.name })),
                          ]}
                        />
                        <Select
                          label="Status"
                          value={statusFilter}
                          onChange={(value) => setStatusFilter(value as TaskStatus | 'all')}
                          options={taskStatuses.map((status) => ({ value: status, label: status }))}
                        />
                        <button className="forge-button self-end" onClick={() => clearDone.mutate()} type="button">Clear done</button>
                      </div>
                      <div className="mt-5 space-y-3">
                        {tasks.length === 0 ? (
                          <Empty label="No tasks match this filter." />
                        ) : (
                          tasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              project={task.project_id ? projectMap.get(task.project_id) : undefined}
                              onComplete={task.status === 'done' ? undefined : () => completeTask.mutate(task.id)}
                              onEdit={() => openTaskEditor(task)}
                              onDelete={() => requestDeleteTask(task)}
                              compact
                              titleSlot={
                                inlineTaskEdit.id === task.id ? (
                                  <input
                                    autoFocus
                                    className="forge-input mt-3"
                                    value={inlineTaskEdit.title}
                                    onBlur={() => void saveInlineTaskTitle(task.id)}
                                    onChange={(event) => setInlineTaskEdit({ id: task.id, title: event.target.value })}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        void saveInlineTaskTitle(task.id)
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
              )}

              {screen === 'calendar' && (
                <div className="grid gap-5 xl:grid-cols-[1.2fr,0.8fr]">
                  <Section title="Block the Work" eyebrow="Calendar">
                    <div className="grid gap-5 xl:grid-cols-[1.45fr,0.65fr]">
                      <div className="overflow-hidden rounded-[28px] border border-forge-steel/20 bg-white p-3">
                        <FullCalendar
                          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
                          initialView="timeGridWeek"
                          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek' }}
                          events={fullCalendarEvents}
                          height={720}
                          droppable
                          editable
                          allDaySlot={false}
                          eventReceive={(arg) => void handleTaskReceive(arg)}
                          eventDrop={(arg) => void handleEventDrop(arg)}
                          eventResize={(arg) => void handleEventResize(arg)}
                          eventClick={handleEventClick}
                          datesSet={(arg) => setCalendarRange({ start: arg.start.toISOString(), end: arg.end.toISOString() })}
                        />
                      </div>
                      <div ref={externalTasksRef} className="rounded-[28px] border border-forge-steel/20 bg-[#f8f4ed] p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-forge-steel">Drag Source</p>
                        <h3 className="mt-2 font-display text-2xl">Unscheduled tasks</h3>
                        <div className="mt-4 space-y-3">
                          {unscheduledTasks.length === 0 ? (
                            <Empty label="Nothing waiting for a work block." compact />
                          ) : (
                            unscheduledTasks.map((task) => (
                              <div key={task.id} data-task-id={task.id} data-task-title={task.title} className="cursor-grab rounded-3xl border border-forge-steel/20 bg-white px-4 py-3">
                                <div className="font-medium">{task.title}</div>
                                <div className="mt-1 text-xs uppercase tracking-[0.2em] text-forge-steel">
                                  {task.project_id ? projectMap.get(task.project_id)?.name ?? `Project #${task.project_id}` : 'Inbox task'}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </Section>
                  <Section title="Create Event" eyebrow="Direct">
                    <Field label="Title" value={eventForm.title} onChange={(value) => setEventForm({ ...eventForm, title: value })} />
                    <Select label="Project" value={eventForm.project_id === null ? 'unassigned' : String(eventForm.project_id)} onChange={(value) => setEventForm({ ...eventForm, project_id: value === 'unassigned' ? null : Number(value) })} options={[{ value: 'unassigned', label: 'Unassigned' }, ...projectSummaries.map((summary) => ({ value: String(summary.project.id), label: summary.project.name }))]} />
                    <Field label="Start" value={isoToDatetimeLocal(eventForm.start_at)} onChange={(value) => setEventForm({ ...eventForm, start_at: datetimeLocalToIso(value) ?? eventForm.start_at })} type="datetime-local" />
                    <Field label="End" value={isoToDatetimeLocal(eventForm.end_at)} onChange={(value) => setEventForm({ ...eventForm, end_at: datetimeLocalToIso(value) ?? eventForm.end_at })} type="datetime-local" />
                    <Field label="Timezone" value={eventForm.timezone} onChange={(value) => setEventForm({ ...eventForm, timezone: value })} placeholder="UTC" />
                    <Select label="Event Type" value={eventForm.event_type} onChange={(value) => setEventForm({ ...eventForm, event_type: value as EventType })} options={eventTypes.map((eventType) => ({ value: eventType, label: eventType }))} />
                    <RecurrenceBuilder
                      startValue={eventForm.start_at}
                      endValue={eventForm.end_at}
                      timeFormat="iso"
                      value={eventFormRecurrence}
                      onChange={setEventFormRecurrence}
                      onEndValueChange={(value) => setEventForm({ ...eventForm, end_at: value })}
                    />
                    <button className="forge-button mt-4" onClick={saveEventForm} type="button">Create event</button>
                  </Section>
                </div>
              )}

              {screen === 'settings' && (
                <div className="grid gap-5 md:grid-cols-3">
                  <Section title="Local API" eyebrow="Runtime">
                    <Setting label="Base URL" value={apiBaseUrl} />
                    <Setting label="Mode" value="Loopback-only, local-first" />
                    <Setting label="Status" value={runtimeHealth?.status ?? 'unknown'} />
                    <Setting label="Started" value={runtimeHealth ? fmt(runtimeHealth.started_at) : 'Unavailable'} />
                    <Setting label="First run" value={runtimeHealth ? (runtimeHealth.first_run ? 'yes' : 'no') : 'unknown'} />
                  </Section>
                  <Section title="Paths" eyebrow="Storage">
                    <Setting label="Database" value={runtimeHealth?.paths.database ?? '~/.forge/forge.db'} />
                    <Setting label="Config" value={runtimeHealth?.paths.config ?? '~/.forge/config.toml'} />
                    <Setting label="Logs" value={runtimeHealth?.paths.logs ?? '~/.forge/logs/'} />
                    <Setting label="Daemon log" value={runtimeHealth?.paths.daemon_log ?? '~/.forge/logs/forged.log'} />
                  </Section>
                  <Section title="Defaults" eyebrow="Environment">
                    <Setting label="Timezone" value={eventForm.timezone} />
                    <Setting label="Calendar span" value={`${calendarEvents.length} loaded events`} />
                  </Section>
                  <Section title="Keyboard" eyebrow="Workflow">
                    <Setting label="1-5" value="Navigate Today, Projects, Tasks, Calendar, Settings" />
                    <Setting label="Ctrl/Cmd+Enter" value="Save the active project, task, or event editor" />
                    <Setting label="Escape" value="Cancel inline edits or close the active dialog" />
                    <Setting label="Delete" value="Open delete confirmation for the active editor" />
                  </Section>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <Dialog open={taskEditor !== null} onOpenChange={(open) => { if (!open) { setTaskEditor(null); restoreShellFocus() } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>
              Fast structural edits without leaving the execution surface.
            </DialogDescription>
          </DialogHeader>
          {taskEditor ? (
            <>
            <Field autoFocus label="Title" value={taskEditor.title} onChange={(value) => setTaskEditor({ ...taskEditor, title: value })} />
            <Field label="Description" value={taskEditor.description} onChange={(value) => setTaskEditor({ ...taskEditor, description: value })} multiline />
            <Select label="Project" value={taskEditor.project_id} onChange={(value) => setTaskEditor({ ...taskEditor, project_id: value })} options={[{ value: 'inbox', label: 'Inbox' }, ...projectSummaries.map((summary) => ({ value: String(summary.project.id), label: summary.project.name }))]} />
            <Select label="Status" value={taskEditor.status} onChange={(value) => setTaskEditor({ ...taskEditor, status: value as TaskStatus })} options={taskStatuses.filter((value) => value !== 'all').map((status) => ({ value: status, label: status }))} />
            <Select label="Priority" value={taskEditor.priority} onChange={(value) => setTaskEditor({ ...taskEditor, priority: value as TaskPriority })} options={taskPriorities.map((priority) => ({ value: priority, label: priority }))} />
            <Field label="Due" value={taskEditor.due_at} onChange={(value) => setTaskEditor({ ...taskEditor, due_at: value })} type="datetime-local" />
            <Field label="Estimate (minutes)" value={taskEditor.estimate_minutes} onChange={(value) => setTaskEditor({ ...taskEditor, estimate_minutes: value })} type="number" />
            <Field label="Tags" value={taskEditor.tags} onChange={(value) => setTaskEditor({ ...taskEditor, tags: value })} placeholder="ops, infra" />
            <Field label="Notes" value={taskEditor.notes} onChange={(value) => setTaskEditor({ ...taskEditor, notes: value })} multiline />
            <div className="mt-4 flex gap-3">
              <button className="forge-button" onClick={saveTaskEditor} type="button">Save task</button>
              <button className="forge-button forge-button-muted" onClick={() => { setTaskEditor(null); restoreShellFocus() }} type="button">Cancel</button>
              <button className="forge-button forge-button-danger ml-auto" onClick={() => {
                const task = tasks.find((item) => item.id === taskEditor.id)
                if (task) {
                  requestDeleteTask(task)
                }
              }} type="button">Delete Task</button>
            </div>
          </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={eventEditor !== null} onOpenChange={(open) => { if (!open) { setEventEditor(null); restoreShellFocus() } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
            <DialogDescription>
              {eventEditorRecurrence && buildRRule(eventEditorRecurrence, datetimeLocalToIso(eventEditor?.start_at ?? '') ?? eventEditor?.start_at)
                ? 'Recurring edits shift the whole series through the daemon API.'
                : 'Calendar changes always patch the daemon API.'}{' '}
              {eventEditor?.linked_task_id
                ? 'Linked tasks remain attached unless you explicitly delete the event.'
                : 'One-off events update in place.'}
            </DialogDescription>
          </DialogHeader>
          {eventEditor ? (
            <>
            <Field autoFocus label="Title" value={eventEditor.title} onChange={(value) => setEventEditor({ ...eventEditor, title: value })} />
            <Field label="Description" value={eventEditor.description} onChange={(value) => setEventEditor({ ...eventEditor, description: value })} multiline />
            <Select label="Project" value={eventEditor.project_id} onChange={(value) => setEventEditor({ ...eventEditor, project_id: value })} options={[{ value: 'unassigned', label: 'Unassigned' }, ...projectSummaries.map((summary) => ({ value: String(summary.project.id), label: summary.project.name }))]} />
            <Field label="Start" value={eventEditor.start_at} onChange={(value) => setEventEditor({ ...eventEditor, start_at: value })} type="datetime-local" />
            <Field label="End" value={eventEditor.end_at} onChange={(value) => setEventEditor({ ...eventEditor, end_at: value })} type="datetime-local" />
            <Field label="Timezone" value={eventEditor.timezone} onChange={(value) => setEventEditor({ ...eventEditor, timezone: value })} />
            <Select label="Event Type" value={eventEditor.event_type} onChange={(value) => setEventEditor({ ...eventEditor, event_type: value as EventType })} options={eventTypes.map((eventType) => ({ value: eventType, label: eventType }))} />
            {eventEditorRecurrence ? (
              <RecurrenceBuilder
                startValue={eventEditor.start_at}
                endValue={eventEditor.end_at}
                timeFormat="local"
                value={eventEditorRecurrence}
                onChange={setEventEditorRecurrence}
                onEndValueChange={(value) => setEventEditor({ ...eventEditor, end_at: value })}
              />
            ) : null}
            <Field label="Notes" value={eventEditor.notes} onChange={(value) => setEventEditor({ ...eventEditor, notes: value })} multiline />
            <div className="mt-4 flex gap-3">
              <button className="forge-button" onClick={saveEventEditor} type="button">Save event</button>
              <button className="forge-button forge-button-muted" onClick={() => { setEventEditor(null); restoreShellFocus() }} type="button">Cancel</button>
              <button
                className="forge-button forge-button-danger ml-auto"
                onClick={() => {
                  const event = rawEvents.find((item) => item.id === eventEditor.id)
                  if (event) {
                    requestDeleteEvent(event)
                  }
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateProjectOpen} onOpenChange={setIsCreateProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>Add a new project surface.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name" value={projectForm.name} onChange={(value) => setProjectForm({ ...projectForm, name: value })} autoFocus />
            <Field label="Description" value={projectForm.description} onChange={(value) => setProjectForm({ ...projectForm, description: value })} multiline />
            <DirectoryField
              label="Linked Workdir"
              value={projectForm.workdir_path ?? ''}
              onChange={(value) => setProjectForm({ ...projectForm, workdir_path: value.trim() ? value : null })}
              onBrowse={() => void handleProjectDirectoryPick('create')}
              onClear={() => setProjectForm({ ...projectForm, workdir_path: null })}
            />
            <ColorPicker label="Color" value={projectForm.color} onChange={(value) => setProjectForm({ ...projectForm, color: value })} />
            <div className="flex justify-end gap-3 mt-4">
              <button className="forge-button forge-button-muted" onClick={() => setIsCreateProjectOpen(false)} type="button">Cancel</button>
              <button className="forge-button" onClick={() => createProject.mutate(projectForm)} type="button">Create project</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={projectEditor !== null} onOpenChange={(open) => { if (!open) { setProjectEditor(null); restoreShellFocus() } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>Modify project metadata.</DialogDescription>
          </DialogHeader>
          {projectEditor ? (
            <div className="space-y-4">
              <Field autoFocus label="Name" value={projectEditor.name} onChange={(value) => setProjectEditor({ ...projectEditor, name: value })} />
              <Field label="Description" value={projectEditor.description} onChange={(value) => setProjectEditor({ ...projectEditor, description: value })} multiline />
              <Select label="Status" value={projectEditor.status} onChange={(value) => setProjectEditor({ ...projectEditor, status: value as ProjectStatus })} options={projectStatuses.map((status) => ({ value: status, label: status }))} />
              <Field label="Tags" value={projectEditor.tags} onChange={(value) => setProjectEditor({ ...projectEditor, tags: value })} placeholder="infra, backend" />
              <DirectoryField
                label="Linked Workdir"
                value={projectEditor.workdir_path}
                onChange={(value) => setProjectEditor({ ...projectEditor, workdir_path: value })}
                onBrowse={() => void handleProjectDirectoryPick('edit')}
                onClear={() => setProjectEditor({ ...projectEditor, workdir_path: '' })}
              />
              <ColorPicker label="Color" value={projectEditor.color} onChange={(value) => setProjectEditor({ ...projectEditor, color: value })} />
              <ProjectRepoPanel status={projectStatusMap.get(projectEditor.id)} />
              <div className="flex justify-end gap-3 mt-4">
                <button className="forge-button forge-button-muted" onClick={() => { setProjectEditor(null); restoreShellFocus() }} type="button">Cancel</button>
                <button className="forge-button" onClick={saveProjectEditor} type="button">Save project</button>
                <button
                  className="forge-button forge-button-danger ml-auto"
                  onClick={() => {
                    const project = projectMap.get(projectEditor.id)
                    if (project) {
                      requestDeleteProject(project)
                    }
                  }}
                  type="button"
                >
                  Delete project
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Add Task</DialogTitle>
            <DialogDescription>Create a new task.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Title" value={taskForm.title} onChange={(value) => setTaskForm({ ...taskForm, title: value })} autoFocus />
            <Field label="Description" value={taskForm.description} onChange={(value) => setTaskForm({ ...taskForm, description: value })} multiline />
            <Select label="Project" value={String(taskForm.project_id ?? 'inbox')} onChange={(value) => setTaskForm({ ...taskForm, project_id: value === 'inbox' ? null : Number(value) })} options={[{ value: 'inbox', label: 'Inbox' }, ...projectSummaries.map((summary) => ({ value: String(summary.project.id), label: summary.project.name }))]} />
            <Select label="Priority" value={taskForm.priority} onChange={(value) => setTaskForm({ ...taskForm, priority: value as TaskPriority })} options={taskPriorities.map((priority) => ({ value: priority, label: priority }))} />
            <Field label="Due" value={isoToDatetimeLocal(taskForm.due_at)} onChange={(value) => setTaskForm({ ...taskForm, due_at: datetimeLocalToIso(value) })} type="datetime-local" />
            <div className="flex justify-end gap-3 mt-4">
              <button className="forge-button forge-button-muted" onClick={() => setIsCreateTaskOpen(false)} type="button">Cancel</button>
              <button className="forge-button" onClick={() => createTask.mutate(taskForm)} type="button">Create task</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteIntent !== null} onOpenChange={(open) => { if (!open) { setDeleteIntent(null); restoreShellFocus() } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteIntent?.kind === 'project'
                ? 'Delete Project?'
                : deleteIntent?.kind === 'task'
                  ? 'Delete Task?'
                  : 'Delete Event?'}
            </AlertDialogTitle>
            <AlertDialogDescription>{deleteIntent?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteIntent()}>
              {deleteIntent?.kind === 'project'
                ? 'Delete Project'
                : deleteIntent?.kind === 'task'
                  ? 'Delete Task'
                  : 'Delete Event'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[30px] border border-forge-steel/25 bg-white/80 p-5 shadow-panel">
      <p className="text-xs uppercase tracking-[0.3em] text-forge-steel">{eyebrow}</p>
      <h3 className="mt-2 font-display text-3xl text-forge-night">{title}</h3>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function TaskLaneCard({
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
      className={`cursor-grab rounded-[26px] border px-4 py-4 transition ${
        dragging
          ? 'border-forge-ember/40 bg-[#f8d8c4] opacity-60'
          : 'border-forge-steel/20 bg-white'
      }`}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
          <div className="mt-3 font-medium text-forge-night">{task.title}</div>
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

function TaskCard({
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
    <div className="rounded-[24px] border border-forge-steel/20 bg-[#f9f6f0] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-forge-paper px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-forge-steel">{task.status.replace('_', ' ')}</span>
            <span className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.25em]" style={{ backgroundColor: `${project?.color ?? '#8a7d68'}22`, color: '#25211c' }}>{project?.name ?? 'Inbox'}</span>
          </div>
          {titleSlot ?? <div className="mt-3 text-lg font-medium text-forge-night">{task.title}</div>}
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
        {(onInlineEdit || onEdit || onDelete) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="icon-button" type="button">
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onInlineEdit ? (
                <DropdownMenuItem onSelect={onInlineEdit}>
                  Rename inline
                </DropdownMenuItem>
              ) : null}
              {onEdit ? (
                <DropdownMenuItem onSelect={onEdit}>Edit task</DropdownMenuItem>
              ) : null}
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

function Field({
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
        <textarea autoFocus={autoFocus} className="forge-input min-h-28 resize-none" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      ) : (
        <input autoFocus={autoFocus} className="forge-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      )}
    </label>
  )
}

function DirectoryField({
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
      <div className="flex gap-2">
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

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block space-y-2 text-sm font-medium text-forge-night/80">
      <span>{label}</span>
      <select className="forge-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function Empty({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`rounded-[24px] border border-dashed border-forge-steel/25 bg-[#f7f2ea] p-4 ${compact ? '' : 'py-6'}`}>
      <div className="flex items-center gap-3 text-sm text-forge-night/70">
        <CircleDot className="size-4 text-forge-ember" />
        <span>{label}</span>
      </div>
    </div>
  )
}

function ProjectRepoCard({ status }: { status?: ProjectRepoStatus }) {
  const summary = summarizeProjectRepoStatus(status)
  const toneClass =
    summary.tone === 'healthy'
      ? 'border-[#bed2bf] bg-[#eef5ed] text-[#284634]'
      : summary.tone === 'warning'
        ? 'border-[#dec3a6] bg-[#f8ede2] text-[#6b3d16]'
        : 'border-forge-steel/20 bg-white text-forge-night/80'

  return (
    <div className={`mt-4 rounded-[20px] border px-4 py-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.24em]">{summary.eyebrow}</span>
        {status?.workdir_path ? (
          <span className="text-[11px] uppercase tracking-[0.2em]">
            {status.is_git_repo ? 'Repo linked' : 'Folder linked'}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium">{summary.detail}</div>
      <div className="mt-2 truncate text-xs uppercase tracking-[0.16em]">
        {status?.workdir_path ?? 'Attach a workdir to enable repo-aware context'}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.25em] text-forge-steel">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function ProjectRepoPanel({ status }: { status?: ProjectRepoStatus }) {
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
          <div key={row.label} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-forge-night/65">{row.label}</span>
            <span className="max-w-[18rem] text-right font-medium text-forge-night">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.3em] text-[#c7b39c]">{label}</div>
      <div className={`mt-2 text-lg ${subtle ? 'text-[#dfd6ca]' : 'text-white'}`}>{value}</div>
    </div>
  )
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-forge-steel/20 py-3 last:border-b-0">
      <span className="text-sm text-forge-night/70">{label}</span>
      <span className="max-w-[16rem] text-right text-sm font-medium text-forge-night">{value}</span>
    </div>
  )
}
