import { describe, expect, it } from 'vitest'
import { buildTaskLanes } from './task-board'
import type { ProjectSummary, Task } from '../types'

const baseTask: Task = {
  id: 1,
  title: 'Task',
  description: '',
  project_id: null,
  status: 'todo',
  priority: 'medium',
  due_at: null,
  scheduled_start: null,
  scheduled_end: null,
  estimate_minutes: null,
  tags: [],
  notes: '',
  source: 'ui',
  created_at: '2026-03-09T00:00:00Z',
  updated_at: '2026-03-09T00:00:00Z',
  completed_at: null,
}

const projectSummary: ProjectSummary = {
  project: {
    id: 7,
    name: 'Forge',
    slug: 'forge',
    description: '',
    status: 'active',
    tags: [],
    color: '#6f8466',
    workdir_path: null,
    created_at: '2026-03-09T00:00:00Z',
    updated_at: '2026-03-09T00:00:00Z',
  },
  open_task_count: 1,
  upcoming_event_count: 0,
}

describe('buildTaskLanes', () => {
  it('groups inbox and project tasks into ordered lanes', () => {
    const lanes = buildTaskLanes(
      [
        baseTask,
        { ...baseTask, id: 2, project_id: 7, title: 'Project task' },
      ],
      [projectSummary],
    )

    expect(lanes[0].id).toBe('inbox')
    expect(lanes[0].tasks.map((task) => task.id)).toEqual([1])
    expect(lanes[1].id).toBe('project:7')
    expect(lanes[1].tasks.map((task) => task.id)).toEqual([2])
  })

  it('creates detached lanes for tasks whose project is not in the active summary list', () => {
    const lanes = buildTaskLanes(
      [{ ...baseTask, id: 3, project_id: 99, title: 'Detached task' }],
      [],
    )

    expect(lanes).toHaveLength(2)
    expect(lanes[1].kind).toBe('detached')
    expect(lanes[1].projectId).toBe(99)
    expect(lanes[1].tasks.map((task) => task.id)).toEqual([3])
  })
})
