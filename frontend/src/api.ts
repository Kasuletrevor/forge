import type {
  CalendarOccurrence,
  CalendarRangeQuery,
  CreateEventRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  EventRecord,
  FocusState,
  HealthResponse,
  Project,
  ProjectSummary,
  SetFocusRequest,
  Task,
  TaskListQuery,
  TodaySummary,
  UpdateEventRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from './types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:37241'

export async function resolveApiBaseUrl(): Promise<string> {
  if (!isTauriEnvironment()) {
    return DEFAULT_BASE_URL
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string>('ensure_daemon')
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let message = `Request failed with ${response.status}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) {
        message = payload.error
      }
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      query.set(key, String(value))
    }
  })
  const value = query.toString()
  return value ? `?${value}` : ''
}

export const forgeApi = {
  getHealth(baseUrl: string) {
    return request<HealthResponse>(baseUrl, '/health')
  },
  listProjects(baseUrl: string) {
    return request<ProjectSummary[]>(baseUrl, '/projects')
  },
  createProject(baseUrl: string, payload: CreateProjectRequest) {
    return request<Project>(baseUrl, '/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  updateProject(baseUrl: string, id: number, payload: UpdateProjectRequest) {
    return request<Project>(baseUrl, `/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  deleteProject(baseUrl: string, id: number) {
    return request<void>(baseUrl, `/projects/${id}`, { method: 'DELETE' })
  },
  listTasks(baseUrl: string, query: TaskListQuery) {
    return request<Task[]>(
      baseUrl,
      `/tasks${buildQuery({
        project_id: query.project_id,
        inbox_only: query.inbox_only,
        status: query.status,
        priority: query.priority,
        due_today: query.due_today,
        overdue: query.overdue,
        scheduled: query.scheduled,
        search: query.search,
      })}`,
    )
  },
  createTask(baseUrl: string, payload: CreateTaskRequest) {
    return request<Task>(baseUrl, '/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  updateTask(baseUrl: string, id: number, payload: UpdateTaskRequest) {
    return request<Task>(baseUrl, `/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  deleteTask(baseUrl: string, id: number) {
    return request<void>(baseUrl, `/tasks/${id}`, { method: 'DELETE' })
  },
  completeTask(baseUrl: string, id: number) {
    return request<Task>(baseUrl, `/tasks/${id}/complete`, { method: 'POST' })
  },
  clearDone(baseUrl: string) {
    return request<{ cleared: number }>(baseUrl, '/tasks/clear-done', {
      method: 'POST',
    })
  },
  listEvents(baseUrl: string, query?: { projectId?: number; linkedTaskId?: number }) {
    return request<EventRecord[]>(
      baseUrl,
      `/events${buildQuery({
        project_id: query?.projectId,
        linked_task_id: query?.linkedTaskId,
      })}`,
    )
  },
  createEvent(baseUrl: string, payload: CreateEventRequest) {
    return request<EventRecord>(baseUrl, '/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  updateEvent(baseUrl: string, id: number, payload: UpdateEventRequest) {
    return request<EventRecord>(baseUrl, `/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  deleteEvent(baseUrl: string, id: number) {
    return request<void>(baseUrl, `/events/${id}`, { method: 'DELETE' })
  },
  calendarRange(baseUrl: string, query: CalendarRangeQuery) {
    return request<CalendarOccurrence[]>(
      baseUrl,
      `/calendar/range${buildQuery({ start: query.start, end: query.end })}`,
    )
  },
  getFocus(baseUrl: string) {
    return request<FocusState | null>(baseUrl, '/focus')
  },
  setFocus(baseUrl: string, payload: SetFocusRequest) {
    return request<FocusState>(baseUrl, '/focus', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  clearFocus(baseUrl: string) {
    return request<void>(baseUrl, '/focus', { method: 'DELETE' })
  },
  getToday(baseUrl: string) {
    return request<TodaySummary>(baseUrl, '/today')
  },
}

function isTauriEnvironment() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
