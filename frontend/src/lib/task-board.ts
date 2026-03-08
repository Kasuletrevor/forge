import type { ProjectSummary, Task } from '../types'

export interface TaskLane {
  id: string
  title: string
  projectId: number | null
  color: string
  kind: 'inbox' | 'project' | 'detached'
  tasks: Task[]
}

export function buildTaskLanes(
  tasks: Task[],
  projectSummaries: ProjectSummary[],
): TaskLane[] {
  const lanes: TaskLane[] = [
    {
      id: 'inbox',
      title: 'Inbox',
      projectId: null,
      color: '#8a7d68',
      kind: 'inbox',
      tasks: [],
    },
    ...projectSummaries.map((summary) => ({
      id: `project:${summary.project.id}`,
      title: summary.project.name,
      projectId: summary.project.id,
      color: summary.project.color,
      kind: 'project' as const,
      tasks: [],
    })),
  ]

  const laneByProjectId = new Map<number | null, TaskLane>(
    lanes.map((lane) => [lane.projectId, lane]),
  )

  for (const task of tasks) {
    const lane = laneByProjectId.get(task.project_id)
    if (lane) {
      lane.tasks.push(task)
      continue
    }

    const detachedLane: TaskLane = {
      id: `detached:${task.project_id}`,
      title: `Project #${task.project_id}`,
      projectId: task.project_id,
      color: '#6d6257',
      kind: 'detached',
      tasks: [task],
    }
    lanes.push(detachedLane)
    laneByProjectId.set(task.project_id, detachedLane)
  }

  return lanes
}
