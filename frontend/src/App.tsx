import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventClickArg, EventDropArg } from '@fullcalendar/core'
import { Draggable, type EventReceiveArg, type EventResizeDoneArg } from '@fullcalendar/interaction'
import {
  CalendarRange,
  ClipboardList,
  FolderKanban,
  Orbit,
  Settings2,
} from 'lucide-react'
import { forgeApi, resolveApiBaseUrl } from './api'
import { LoadingSurface } from './components/ui/loading-surface'
import { StatusCallout } from './components/ui/status-callout'
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
import { motionPresets } from './lib/motion'
import { buildTaskLanes } from './lib/task-board'
import {
  CalendarScreen,
  ProjectsScreen,
  SettingsScreen,
  TodayScreen,
  TasksScreen,
} from './components/app/screens'
import {
  CreateProjectDialog,
  CreateTaskDialog,
  DeleteIntentDialog,
  EventEditorDialog,
  ProjectEditorDialog,
  TaskEditorDialog,
} from './components/app/dialogs'
import { Metric, Stat } from './components/app/shared-ui'
import type {
  DeleteIntent,
  EventEditorState,
  ProjectEditorState,
  TaskEditorState,
} from './components/app/state'
import type {
  CreateEventRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  EventRecord,
  EventType,
  HealthResponse,
  Project,
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
    <div className="min-h-screen bg-forge-canvas text-forge-ink">
      <div className="forge-shell">
        <aside className="forge-shell-sidebar">
          <p className="text-xs uppercase tracking-[0.35em] text-forge-steel">Forge</p>
          <h1 className="mt-2 font-display text-4xl">Work OS</h1>
          <p className="mt-3 text-sm text-white/70">
            Local execution, scheduling, and mutation through one write path.
          </p>

          <nav className="forge-shell-nav">
            {screens.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                ref={(element) => {
                  screenButtonRefs.current[id] = element
                }}
                className={`forge-shell-nav-button ${
                  screen === id ? 'bg-forge-paper text-forge-night' : 'bg-white/5 text-white/80'
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

        <main className="forge-shell-main">
          <header
            className={`${motionPresets.surfaceEnter} rounded-[28px] border border-forge-steel/35 bg-[radial-gradient(circle_at_top_left,_rgba(127,47,63,0.26),_transparent_44%),linear-gradient(135deg,#1f1719,#35242a)] p-5 text-forge-paper shadow-panel sm:rounded-[34px] sm:p-6 xl:p-7`}
          >
            <p className="text-xs uppercase tracking-[0.35em] text-forge-steel">Operator View</p>
            <h2 className="mt-3 max-w-3xl font-display text-3xl leading-tight sm:text-4xl xl:text-5xl">
              Build with force, not fragmentation.
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-forge-steel">
              <span className="rounded-full border border-white/10 px-3 py-1">1-5 navigate</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Ctrl/Cmd+Enter save</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Esc cancel</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Delete confirm</span>
            </div>
          </header>
          {startupError ? (
            <StatusCallout
              tone="error"
              title="Forge could not start the local daemon."
              description={<span className="whitespace-pre-wrap">{startupError}</span>}
              className="mt-6"
            />
          ) : loading ? (
            <LoadingSurface
              className={`mt-6 ${motionPresets.surfaceEnter}`}
              title="Loading Forge state..."
              description="Syncing projects, tasks, and scheduling signals."
            />
          ) : (
            <div className="mt-6">
              {screen === 'today' && today ? (
                <TodayScreen
                  today={today}
                  calendarEvents={calendarEvents}
                  projectMap={projectMap}
                  onOpenCreateTask={() => setIsCreateTaskOpen(true)}
                  onCompleteTask={(taskId) => completeTask.mutate(taskId)}
                  onEditTask={openTaskEditor}
                  onDeleteTask={requestDeleteTask}
                />
              ) : null}
              {screen === 'projects' ? (
                <ProjectsScreen
                  projectSummaries={projectSummaries}
                  projectStatusMap={projectStatusMap}
                  inlineProjectEdit={inlineProjectEdit}
                  setInlineProjectEdit={setInlineProjectEdit}
                  onSaveInlineProjectName={saveInlineProjectName}
                  onOpenProjectEditor={openProjectEditor}
                  onOpenCreateProject={() => setIsCreateProjectOpen(true)}
                />
              ) : null}
              {screen === 'tasks' ? (
                <TasksScreen
                  taskLanes={taskLanes}
                  dragTaskId={dragTaskId}
                  dragLaneProjectId={dragLaneProjectId}
                  setDragLaneProjectId={setDragLaneProjectId}
                  onMoveTaskToLane={moveTaskToLane}
                  onTaskLaneDragEnd={handleTaskLaneDragEnd}
                  onTaskLaneDragStart={handleTaskLaneDragStart}
                  onRequestDeleteTask={requestDeleteTask}
                  onOpenTaskEditor={openTaskEditor}
                  onOpenCreateTask={() => setIsCreateTaskOpen(true)}
                  taskSearch={taskSearch}
                  setTaskSearch={setTaskSearch}
                  projectFilter={projectFilter}
                  setProjectFilter={setProjectFilter}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
                  taskStatuses={taskStatuses}
                  onClearDone={() => clearDone.mutate()}
                  tasks={tasks}
                  projectSummaries={projectSummaries}
                  projectMap={projectMap}
                  inlineTaskEdit={inlineTaskEdit}
                  setInlineTaskEdit={setInlineTaskEdit}
                  onSaveInlineTaskTitle={saveInlineTaskTitle}
                  onCompleteTask={(taskId) => completeTask.mutate(taskId)}
                />
              ) : null}
              {screen === 'calendar' ? (
                <CalendarScreen
                  fullCalendarEvents={fullCalendarEvents}
                  onTaskReceive={handleTaskReceive}
                  onEventDrop={handleEventDrop}
                  onEventResize={handleEventResize}
                  onEventClick={handleEventClick}
                  onCalendarRangeChange={setCalendarRange}
                  externalTasksRef={externalTasksRef}
                  unscheduledTasks={unscheduledTasks}
                  projectMap={projectMap}
                  eventForm={eventForm}
                  setEventForm={setEventForm}
                  eventFormRecurrence={eventFormRecurrence}
                  setEventFormRecurrence={setEventFormRecurrence}
                  projectSummaries={projectSummaries}
                  eventTypes={eventTypes}
                  onSaveEventForm={saveEventForm}
                  isoToDatetimeLocal={isoToDatetimeLocal}
                  datetimeLocalToIso={datetimeLocalToIso}
                />
              ) : null}
              {screen === 'settings' ? (
                <SettingsScreen
                  apiBaseUrl={apiBaseUrl}
                  runtimeHealth={runtimeHealth}
                  eventTimezone={eventForm.timezone}
                  calendarEventsCount={calendarEvents.length}
                />
              ) : null}
            </div>
          )}
        </main>
      </div>

      <TaskEditorDialog
        taskEditor={taskEditor}
        setTaskEditor={setTaskEditor}
        restoreShellFocus={restoreShellFocus}
        projectSummaries={projectSummaries}
        taskStatuses={taskStatuses}
        taskPriorities={taskPriorities}
        onSaveTaskEditor={saveTaskEditor}
        tasks={tasks}
        onRequestDeleteTask={requestDeleteTask}
      />
      <EventEditorDialog
        eventEditor={eventEditor}
        setEventEditor={setEventEditor}
        eventEditorRecurrence={eventEditorRecurrence}
        setEventEditorRecurrence={setEventEditorRecurrence}
        restoreShellFocus={restoreShellFocus}
        rawEvents={rawEvents}
        projectSummaries={projectSummaries}
        eventTypes={eventTypes}
        datetimeLocalToIso={datetimeLocalToIso}
        onSaveEventEditor={saveEventEditor}
        onRequestDeleteEvent={requestDeleteEvent}
      />
      <CreateProjectDialog
        isCreateProjectOpen={isCreateProjectOpen}
        setIsCreateProjectOpen={setIsCreateProjectOpen}
        projectForm={projectForm}
        setProjectForm={setProjectForm}
        onHandleProjectDirectoryPick={handleProjectDirectoryPick}
        onCreateProject={() => createProject.mutate(projectForm)}
      />
      <ProjectEditorDialog
        projectEditor={projectEditor}
        setProjectEditor={setProjectEditor}
        restoreShellFocus={restoreShellFocus}
        projectStatuses={projectStatuses}
        projectStatusMap={projectStatusMap}
        projectMap={projectMap}
        onHandleProjectDirectoryPick={handleProjectDirectoryPick}
        onSaveProjectEditor={saveProjectEditor}
        onRequestDeleteProject={requestDeleteProject}
      />
      <CreateTaskDialog
        isCreateTaskOpen={isCreateTaskOpen}
        setIsCreateTaskOpen={setIsCreateTaskOpen}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        projectSummaries={projectSummaries}
        taskPriorities={taskPriorities}
        isoToDatetimeLocal={isoToDatetimeLocal}
        datetimeLocalToIso={datetimeLocalToIso}
        onCreateTask={() => createTask.mutate(taskForm)}
      />
      <DeleteIntentDialog
        deleteIntent={deleteIntent}
        setDeleteIntent={setDeleteIntent}
        restoreShellFocus={restoreShellFocus}
        onConfirmDeleteIntent={confirmDeleteIntent}
      />
    </div>
  )
}
