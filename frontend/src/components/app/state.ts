import type { EventType, ProjectStatus, TaskPriority, TaskStatus } from '../../types'

export interface ProjectEditorState {
  id: number
  name: string
  description: string
  color: string
  status: ProjectStatus
  tags: string
  workdir_path: string
}

export interface TaskEditorState {
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

export interface EventEditorState {
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

export interface DeleteIntent {
  kind: 'project' | 'task' | 'event'
  id: number
  title: string
  description: string
}
