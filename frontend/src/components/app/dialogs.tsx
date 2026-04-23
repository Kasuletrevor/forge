import type { Dispatch, SetStateAction } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { ColorPicker } from '../color-picker'
import { RecurrenceBuilder } from '../recurrence-builder'
import { buildRRule, type RecurrenceState } from '../../lib/recurrence'
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  EventRecord,
  EventType,
  Project,
  ProjectRepoStatus,
  ProjectStatus,
  ProjectSummary,
  Task,
  TaskPriority,
  TaskStatus,
} from '../../types'
import type {
  DeleteIntent,
  EventEditorState,
  ProjectEditorState,
  TaskEditorState,
} from './state'
import { DirectoryField, Field, ProjectRepoPanel, Select } from './shared-ui'

interface TaskEditorDialogProps {
  taskEditor: TaskEditorState | null
  setTaskEditor: Dispatch<SetStateAction<TaskEditorState | null>>
  restoreShellFocus: () => void
  projectSummaries: ProjectSummary[]
  taskStatuses: Array<TaskStatus | 'all'>
  taskPriorities: TaskPriority[]
  onSaveTaskEditor: () => void
  tasks: Task[]
  onRequestDeleteTask: (task: Task) => void
}

export function TaskEditorDialog({
  taskEditor,
  setTaskEditor,
  restoreShellFocus,
  projectSummaries,
  taskStatuses,
  taskPriorities,
  onSaveTaskEditor,
  tasks,
  onRequestDeleteTask,
}: TaskEditorDialogProps) {
  return (
    <Dialog
      open={taskEditor !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTaskEditor(null)
          restoreShellFocus()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>Fast structural edits without leaving the execution surface.</DialogDescription>
        </DialogHeader>
        {taskEditor ? (
          <>
            <Field
              autoFocus
              label="Title"
              value={taskEditor.title}
              onChange={(value) => setTaskEditor({ ...taskEditor, title: value })}
            />
            <Field
              label="Description"
              value={taskEditor.description}
              onChange={(value) => setTaskEditor({ ...taskEditor, description: value })}
              multiline
            />
            <Select
              label="Project"
              value={taskEditor.project_id}
              onChange={(value) => setTaskEditor({ ...taskEditor, project_id: value })}
              options={[
                { value: 'inbox', label: 'Inbox' },
                ...projectSummaries.map((summary) => ({
                  value: String(summary.project.id),
                  label: summary.project.name,
                })),
              ]}
            />
            <Select
              label="Status"
              value={taskEditor.status}
              onChange={(value) => setTaskEditor({ ...taskEditor, status: value as TaskStatus })}
              options={taskStatuses
                .filter((value) => value !== 'all')
                .map((status) => ({ value: status, label: status }))}
            />
            <Select
              label="Priority"
              value={taskEditor.priority}
              onChange={(value) => setTaskEditor({ ...taskEditor, priority: value as TaskPriority })}
              options={taskPriorities.map((priority) => ({ value: priority, label: priority }))}
            />
            <Field
              label="Due"
              value={taskEditor.due_at}
              onChange={(value) => setTaskEditor({ ...taskEditor, due_at: value })}
              type="datetime-local"
            />
            <Field
              label="Estimate (minutes)"
              value={taskEditor.estimate_minutes}
              onChange={(value) => setTaskEditor({ ...taskEditor, estimate_minutes: value })}
              type="number"
            />
            <Field
              label="Tags"
              value={taskEditor.tags}
              onChange={(value) => setTaskEditor({ ...taskEditor, tags: value })}
              placeholder="ops, infra"
            />
            <Field
              label="Notes"
              value={taskEditor.notes}
              onChange={(value) => setTaskEditor({ ...taskEditor, notes: value })}
              multiline
            />
            <div className="mt-4 flex gap-3">
              <button className="forge-button" onClick={onSaveTaskEditor} type="button">
                Save task
              </button>
              <button
                className="forge-button forge-button-muted"
                onClick={() => {
                  setTaskEditor(null)
                  restoreShellFocus()
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="forge-button forge-button-danger ml-auto"
                onClick={() => {
                  const task = tasks.find((item) => item.id === taskEditor.id)
                  if (task) {
                    onRequestDeleteTask(task)
                  }
                }}
                type="button"
              >
                Delete Task
              </button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

interface EventEditorDialogProps {
  eventEditor: EventEditorState | null
  setEventEditor: Dispatch<SetStateAction<EventEditorState | null>>
  eventEditorRecurrence: RecurrenceState | null
  setEventEditorRecurrence: Dispatch<SetStateAction<RecurrenceState | null>>
  restoreShellFocus: () => void
  rawEvents: EventRecord[]
  projectSummaries: ProjectSummary[]
  eventTypes: EventType[]
  datetimeLocalToIso: (value: string) => string | null
  onSaveEventEditor: () => void
  onRequestDeleteEvent: (event: EventRecord) => void
}

export function EventEditorDialog({
  eventEditor,
  setEventEditor,
  eventEditorRecurrence,
  setEventEditorRecurrence,
  restoreShellFocus,
  rawEvents,
  projectSummaries,
  eventTypes,
  datetimeLocalToIso,
  onSaveEventEditor,
  onRequestDeleteEvent,
}: EventEditorDialogProps) {
  return (
    <Dialog
      open={eventEditor !== null}
      onOpenChange={(open) => {
        if (!open) {
          setEventEditor(null)
          restoreShellFocus()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Event</DialogTitle>
          <DialogDescription>
            {eventEditorRecurrence &&
            buildRRule(
              eventEditorRecurrence,
              datetimeLocalToIso(eventEditor?.start_at ?? '') ?? eventEditor?.start_at,
            )
              ? 'Recurring edits shift the whole series through the daemon API.'
              : 'Calendar changes always patch the daemon API.'}{' '}
            {eventEditor?.linked_task_id
              ? 'Linked tasks remain attached unless you explicitly delete the event.'
              : 'One-off events update in place.'}
          </DialogDescription>
        </DialogHeader>
        {eventEditor ? (
          <>
            <Field
              autoFocus
              label="Title"
              value={eventEditor.title}
              onChange={(value) => setEventEditor({ ...eventEditor, title: value })}
            />
            <Field
              label="Description"
              value={eventEditor.description}
              onChange={(value) => setEventEditor({ ...eventEditor, description: value })}
              multiline
            />
            <Select
              label="Project"
              value={eventEditor.project_id}
              onChange={(value) => setEventEditor({ ...eventEditor, project_id: value })}
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
              value={eventEditor.start_at}
              onChange={(value) => setEventEditor({ ...eventEditor, start_at: value })}
              type="datetime-local"
            />
            <Field
              label="End"
              value={eventEditor.end_at}
              onChange={(value) => setEventEditor({ ...eventEditor, end_at: value })}
              type="datetime-local"
            />
            <Field
              label="Timezone"
              value={eventEditor.timezone}
              onChange={(value) => setEventEditor({ ...eventEditor, timezone: value })}
            />
            <Select
              label="Event Type"
              value={eventEditor.event_type}
              onChange={(value) => setEventEditor({ ...eventEditor, event_type: value as EventType })}
              options={eventTypes.map((eventType) => ({ value: eventType, label: eventType }))}
            />
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
            <Field
              label="Notes"
              value={eventEditor.notes}
              onChange={(value) => setEventEditor({ ...eventEditor, notes: value })}
              multiline
            />
            <div className="mt-4 flex gap-3">
              <button className="forge-button" onClick={onSaveEventEditor} type="button">
                Save event
              </button>
              <button
                className="forge-button forge-button-muted"
                onClick={() => {
                  setEventEditor(null)
                  restoreShellFocus()
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="forge-button forge-button-danger ml-auto"
                onClick={() => {
                  const event = rawEvents.find((item) => item.id === eventEditor.id)
                  if (event) {
                    onRequestDeleteEvent(event)
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
  )
}

interface CreateProjectDialogProps {
  isCreateProjectOpen: boolean
  setIsCreateProjectOpen: Dispatch<SetStateAction<boolean>>
  projectForm: CreateProjectRequest
  setProjectForm: Dispatch<SetStateAction<CreateProjectRequest>>
  onHandleProjectDirectoryPick: (mode: 'create' | 'edit') => Promise<void>
  onCreateProject: () => void
}

export function CreateProjectDialog({
  isCreateProjectOpen,
  setIsCreateProjectOpen,
  projectForm,
  setProjectForm,
  onHandleProjectDirectoryPick,
  onCreateProject,
}: CreateProjectDialogProps) {
  return (
    <Dialog open={isCreateProjectOpen} onOpenChange={setIsCreateProjectOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>Add a new project surface.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            label="Name"
            value={projectForm.name}
            onChange={(value) => setProjectForm({ ...projectForm, name: value })}
            autoFocus
          />
          <Field
            label="Description"
            value={projectForm.description}
            onChange={(value) => setProjectForm({ ...projectForm, description: value })}
            multiline
          />
          <DirectoryField
            label="Linked Workdir"
            value={projectForm.workdir_path ?? ''}
            onChange={(value) =>
              setProjectForm({ ...projectForm, workdir_path: value.trim() ? value : null })
            }
            onBrowse={() => void onHandleProjectDirectoryPick('create')}
            onClear={() => setProjectForm({ ...projectForm, workdir_path: null })}
          />
          <ColorPicker
            label="Color"
            value={projectForm.color}
            onChange={(value) => setProjectForm({ ...projectForm, color: value })}
          />
          <div className="mt-4 flex justify-end gap-3">
            <button
              className="forge-button forge-button-muted"
              onClick={() => setIsCreateProjectOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button className="forge-button" onClick={onCreateProject} type="button">
              Create project
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ProjectEditorDialogProps {
  projectEditor: ProjectEditorState | null
  setProjectEditor: Dispatch<SetStateAction<ProjectEditorState | null>>
  restoreShellFocus: () => void
  projectStatuses: ProjectStatus[]
  projectStatusMap: Map<number, ProjectRepoStatus>
  projectMap: Map<number, Project>
  onHandleProjectDirectoryPick: (mode: 'create' | 'edit') => Promise<void>
  onSaveProjectEditor: () => void
  onRequestDeleteProject: (project: Project) => void
}

export function ProjectEditorDialog({
  projectEditor,
  setProjectEditor,
  restoreShellFocus,
  projectStatuses,
  projectStatusMap,
  projectMap,
  onHandleProjectDirectoryPick,
  onSaveProjectEditor,
  onRequestDeleteProject,
}: ProjectEditorDialogProps) {
  return (
    <Dialog
      open={projectEditor !== null}
      onOpenChange={(open) => {
        if (!open) {
          setProjectEditor(null)
          restoreShellFocus()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>Modify project metadata.</DialogDescription>
        </DialogHeader>
        {projectEditor ? (
          <div className="space-y-4">
            <Field
              autoFocus
              label="Name"
              value={projectEditor.name}
              onChange={(value) => setProjectEditor({ ...projectEditor, name: value })}
            />
            <Field
              label="Description"
              value={projectEditor.description}
              onChange={(value) => setProjectEditor({ ...projectEditor, description: value })}
              multiline
            />
            <Select
              label="Status"
              value={projectEditor.status}
              onChange={(value) =>
                setProjectEditor({ ...projectEditor, status: value as ProjectStatus })
              }
              options={projectStatuses.map((status) => ({ value: status, label: status }))}
            />
            <Field
              label="Tags"
              value={projectEditor.tags}
              onChange={(value) => setProjectEditor({ ...projectEditor, tags: value })}
              placeholder="infra, backend"
            />
            <DirectoryField
              label="Linked Workdir"
              value={projectEditor.workdir_path}
              onChange={(value) => setProjectEditor({ ...projectEditor, workdir_path: value })}
              onBrowse={() => void onHandleProjectDirectoryPick('edit')}
              onClear={() => setProjectEditor({ ...projectEditor, workdir_path: '' })}
            />
            <ColorPicker
              label="Color"
              value={projectEditor.color}
              onChange={(value) => setProjectEditor({ ...projectEditor, color: value })}
            />
            <ProjectRepoPanel status={projectStatusMap.get(projectEditor.id)} />
            <div className="mt-4 flex justify-end gap-3">
              <button
                className="forge-button forge-button-muted"
                onClick={() => {
                  setProjectEditor(null)
                  restoreShellFocus()
                }}
                type="button"
              >
                Cancel
              </button>
              <button className="forge-button" onClick={onSaveProjectEditor} type="button">
                Save project
              </button>
              <button
                className="forge-button forge-button-danger ml-auto"
                onClick={() => {
                  const project = projectMap.get(projectEditor.id)
                  if (project) {
                    onRequestDeleteProject(project)
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
  )
}

interface CreateTaskDialogProps {
  isCreateTaskOpen: boolean
  setIsCreateTaskOpen: Dispatch<SetStateAction<boolean>>
  taskForm: CreateTaskRequest
  setTaskForm: Dispatch<SetStateAction<CreateTaskRequest>>
  projectSummaries: ProjectSummary[]
  taskPriorities: TaskPriority[]
  isoToDatetimeLocal: (value: string | null) => string
  datetimeLocalToIso: (value: string) => string | null
  onCreateTask: () => void
}

export function CreateTaskDialog({
  isCreateTaskOpen,
  setIsCreateTaskOpen,
  taskForm,
  setTaskForm,
  projectSummaries,
  taskPriorities,
  isoToDatetimeLocal,
  datetimeLocalToIso,
  onCreateTask,
}: CreateTaskDialogProps) {
  return (
    <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick Add Task</DialogTitle>
          <DialogDescription>Create a new task.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            label="Title"
            value={taskForm.title}
            onChange={(value) => setTaskForm({ ...taskForm, title: value })}
            autoFocus
          />
          <Field
            label="Description"
            value={taskForm.description}
            onChange={(value) => setTaskForm({ ...taskForm, description: value })}
            multiline
          />
          <Select
            label="Project"
            value={String(taskForm.project_id ?? 'inbox')}
            onChange={(value) =>
              setTaskForm({ ...taskForm, project_id: value === 'inbox' ? null : Number(value) })
            }
            options={[
              { value: 'inbox', label: 'Inbox' },
              ...projectSummaries.map((summary) => ({
                value: String(summary.project.id),
                label: summary.project.name,
              })),
            ]}
          />
          <Select
            label="Priority"
            value={taskForm.priority}
            onChange={(value) => setTaskForm({ ...taskForm, priority: value as TaskPriority })}
            options={taskPriorities.map((priority) => ({ value: priority, label: priority }))}
          />
          <Field
            label="Due"
            value={isoToDatetimeLocal(taskForm.due_at)}
            onChange={(value) => setTaskForm({ ...taskForm, due_at: datetimeLocalToIso(value) })}
            type="datetime-local"
          />
          <div className="mt-4 flex justify-end gap-3">
            <button
              className="forge-button forge-button-muted"
              onClick={() => setIsCreateTaskOpen(false)}
              type="button"
            >
              Cancel
            </button>
            <button className="forge-button" onClick={onCreateTask} type="button">
              Create task
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface DeleteIntentDialogProps {
  deleteIntent: DeleteIntent | null
  setDeleteIntent: Dispatch<SetStateAction<DeleteIntent | null>>
  restoreShellFocus: () => void
  onConfirmDeleteIntent: () => Promise<void>
}

export function DeleteIntentDialog({
  deleteIntent,
  setDeleteIntent,
  restoreShellFocus,
  onConfirmDeleteIntent,
}: DeleteIntentDialogProps) {
  return (
    <AlertDialog
      open={deleteIntent !== null}
      onOpenChange={(open) => {
        if (!open) {
          setDeleteIntent(null)
          restoreShellFocus()
        }
      }}
    >
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
          <AlertDialogAction onClick={() => void onConfirmDeleteIntent()}>
            {deleteIntent?.kind === 'project'
              ? 'Delete Project'
              : deleteIntent?.kind === 'task'
                ? 'Delete Task'
                : 'Delete Event'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
