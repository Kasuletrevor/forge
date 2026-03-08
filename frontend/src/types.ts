export type ProjectStatus = 'active' | 'paused' | 'archived'
export type TaskStatus =
  | 'inbox'
  | 'todo'
  | 'scheduled'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'canceled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type EventType =
  | 'meeting'
  | 'work_block'
  | 'research'
  | 'implementation'
  | 'admin'
  | 'review'
  | 'personal'
  | 'other'
export type SourceKind = 'ui' | 'cli' | 'api' | 'agent' | 'system'

export interface Project {
  id: number
  name: string
  slug: string
  description: string
  status: ProjectStatus
  tags: string[]
  color: string
  created_at: string
  updated_at: string
}

export interface ProjectSummary {
  project: Project
  open_task_count: number
  upcoming_event_count: number
}

export interface Task {
  id: number
  title: string
  description: string
  project_id: number | null
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  estimate_minutes: number | null
  tags: string[]
  notes: string
  source: SourceKind
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface EventRecord {
  id: number
  title: string
  description: string
  project_id: number | null
  linked_task_id: number | null
  start_at: string
  end_at: string
  timezone: string
  event_type: EventType
  rrule: string | null
  recurrence_exceptions: string[]
  notes: string
  created_at: string
  updated_at: string
}

export interface CalendarOccurrence {
  event_id: number
  title: string
  description: string
  project_id: number | null
  linked_task_id: number | null
  occurrence_start: string
  occurrence_end: string
  timezone: string
  event_type: EventType
  is_recurring: boolean
  notes: string
}

export interface FocusState {
  id: number
  project_id: number
  task_id: number | null
  started_at: string
  source: SourceKind
}

export interface TodaySummary {
  date: string
  focus: FocusState | null
  today_tasks: Task[]
  overdue_tasks: Task[]
  today_events: CalendarOccurrence[]
  upcoming_work: CalendarOccurrence[]
}

export interface ForgePaths {
  root: string
  database: string
  config: string
  logs: string
  daemon_log: string
}

export interface HealthResponse {
  status: string
  api_base_url: string
  paths: ForgePaths
  started_at: string
  first_run: boolean
}

export interface TaskListQuery {
  project_id?: number
  inbox_only?: boolean
  status?: TaskStatus
  priority?: TaskPriority
  due_today?: boolean
  overdue?: boolean
  scheduled?: boolean
  search?: string
}

export interface CalendarRangeQuery {
  start: string
  end: string
}

export interface CreateProjectRequest {
  name: string
  description: string
  status: ProjectStatus
  tags: string[]
  color: string
}

export interface UpdateProjectRequest {
  name?: string
  description?: string
  status?: ProjectStatus
  tags?: string[]
  color?: string
}

export interface CreateTaskRequest {
  title: string
  description: string
  project_id: number | null
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  estimate_minutes: number | null
  tags: string[]
  notes: string
  source: SourceKind
}

export interface UpdateTaskRequest {
  title?: string
  description?: string
  project_id?: number | null
  status?: TaskStatus
  priority?: TaskPriority
  due_at?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
  estimate_minutes?: number | null
  tags?: string[]
  notes?: string
  source?: SourceKind
}

export interface CreateEventRequest {
  title: string
  description: string
  project_id: number | null
  linked_task_id: number | null
  start_at: string
  end_at: string
  timezone: string
  event_type: EventType
  rrule: string | null
  recurrence_exceptions: string[]
  notes: string
}

export interface UpdateEventRequest {
  title?: string
  description?: string
  project_id?: number | null
  start_at?: string
  end_at?: string
  timezone?: string
  event_type?: EventType
  rrule?: string | null
  recurrence_exceptions?: string[]
  notes?: string
}

export interface SetFocusRequest {
  project_id: number
  task_id: number | null
  source: SourceKind
}
