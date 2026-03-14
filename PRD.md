# Product Requirements Document (PRD)

## Product name

**Forge**
Working concept: a local-first work operating system for a technical builder.

---

## 1. Overview

Forge is a personal work operating system designed for a highly technical, multi-project workflow. It combines **projects, tasks, and calendar events** into one coherent system and makes them accessible through a **UI, CLI, and API**.

The product exists because ordinary productivity tools do not reflect the way this work actually happens. Standard todo apps are too shallow, normal calendars are too disconnected from execution, and most tools do not support command-line or agent-driven control in a serious way.

Forge is intended to reduce fragmentation, lower cognitive load, improve project visibility, and make day-to-day execution more structured and easier to resume.

This first PRD explicitly excludes automatic event capture and timeline reconstruction. Those are future phases.

---

## 2. Problem statement

The current workflow is fragmented across many tools, contexts, and mental models.

The work itself spans multiple active streams at once, including:

* software engineering
* product execution
* backend and infrastructure work
* AI and agent experimentation
* research and reading
* planning and coordination
* academic and operational responsibilities

This creates several practical problems:

### 2.1 Context switching overhead

Switching between projects requires repeatedly reconstructing context:

* what was being done
* what is pending
* what the next action is
* what is scheduled
* what matters most now

This wastes time and drains focus.

### 2.2 Lack of project-centered visibility

Tasks are often tracked as isolated items instead of as part of larger projects. This makes it harder to understand:

* how a project is progressing
* what is blocked
* what is scheduled
* what belongs together

### 2.3 Weak connection between tasks and time

Typical tools separate tasks from the calendar. In practice, tasks that are not tied to time often remain abstract or slip. A real planning system needs to support both:

* what needs to be done
* when it should happen

### 2.4 Poor fit for technical workflows

A large part of the work already happens in technical environments. Managing work only through a mouse-driven UI is not enough. The system needs first-class support for:

* CLI control
* programmatic API access
* agent integrations

### 2.5 Hard re-entry after interruption

After some hours or days away from a project, it is too costly to resume. There needs to be a clean way to see:

* current project state
* open tasks
* upcoming events
* active focus

### 2.6 Too many parallel responsibilities for generic tools

The workflow is not a simple personal checklist or a team kanban board. It is a mix of implementation, planning, research, infrastructure, and execution. Generic productivity software does not model this well.

---

## 3. Product vision

Forge should act as a **local-first command center for work**.

It should provide:

* a clear view of all active projects
* task management grounded in project context
* a real calendar for time-based execution
* command-line control for speed
* API access for agents and integrations

Forge should help answer questions like:

* What am I actively working on?
* What needs to happen today?
* What is scheduled this week?
* Which tasks belong to which projects?
* What is slipping?
* What should I focus on next?

---

## 4. Goals

### 4.1 Primary goals

* Provide a single system for managing projects, tasks, and calendar events.
* Reduce context-switching friction.
* Improve clarity across multiple active projects.
* Make planning and execution work together naturally.
* Support both UI-based and CLI-based usage.
* Expose an API that agents can use.

### 4.2 Secondary goals

* Make project re-entry faster after interruptions.
* Allow project-focused weekly planning.
* Create a structure that can later support activity tracking and timeline intelligence.

---

## 5. Non-goals

For this version, Forge will not attempt to become:

* a team collaboration platform
* a chat or messaging product
* a general-purpose knowledge base
* a large note-taking application
* a cloud-first SaaS dependency
* an automatic local event capture system
* a timeline reconstruction engine

These may come later, but they are out of scope for this PRD.

---

## 6. Target user

### Primary user

A technically sophisticated individual working across multiple active projects and responsibilities, with a need for:

* project-level visibility
* structured execution
* time-aware planning
* command-line control
* integration with developer tooling and agents

### User characteristics

* works in a nonlinear, high-context way
* switches frequently across projects
* uses terminals and APIs heavily
* needs stronger linkage between planning and execution
* wants a serious local-first tool, not a consumer productivity app

---

## 7. Core use cases

### 7.1 Daily planning

The user opens Forge and sees:

* today’s tasks
* today’s events
* current focus
* overdue items
* upcoming work blocks

### 7.2 Project management

The user views all projects and checks:

* open tasks
* project status
* upcoming scheduled work
* priority areas

### 7.3 Fast task entry

The user quickly adds a task through the UI, CLI, or API.

### 7.4 Scheduling work

The user converts a task into a scheduled event or drags a task into the calendar.

### 7.5 CLI-based control

The user performs common actions via terminal, such as:

* adding a task
* listing today’s tasks
* marking a task done
* adding a work block
* setting active focus

### 7.6 Agent-based control

An external agent uses the API to:

* add tasks
* mark tasks done
* create events
* fetch project state
* clear completed tasks

### 7.7 Fast re-entry

The user returns to a project and sees:

* active tasks
* scheduled items
* recent focus state
* next likely actions

---

## 8. Product principles

Forge should be:

### Local-first

The product should function primarily on the local machine with local data storage.

### Structured

The product should emphasize clear organization over clutter.

### Fast

Common workflows should be quick in both UI and CLI.

### Technical

The system should feel native to a developer/operator workflow.

### Calm

The UI should be focused and serious, not noisy or over-gamified.

### Extensible

The architecture should leave room for future automation, activity capture, and intelligence features.

---

## 9. Functional requirements

## 9.1 Projects

### Description

Projects are the top-level containers for work.

### Requirements

The system must allow the user to:

* create a project
* edit a project
* delete a project
* archive a project
* list all projects
* view project details

### Project fields

* id
* name
* slug
* description
* status
* tags
* color
* created_at
* updated_at

### Project status examples

* active
* paused
* archived

### Project detail view should include

* project metadata
* open tasks
* scheduled events
* current focus relevance
* optional notes field later
* inline project rename in the UI
* a project settings panel with a separated danger zone

### Project deletion rule

When a project is deleted:

* tasks in that project move to Inbox (`project_id = null`)
* events in that project become unassigned (`project_id = null`)
* work should be preserved rather than cascaded away

---

## 9.2 Tasks

### Description

Tasks represent actionable work items and should belong to projects or an inbox.

### Requirements

The system must allow the user to:

* create a task
* edit a task
* delete a task
* assign a task to a project
* move a task between projects
* set task status
* set priority
* set due date
* schedule a task
* mark task done
* clear completed tasks
* filter tasks
* list today’s tasks
* list overdue tasks
* list unscheduled tasks

### Task editing behavior

The UI should support:

* inline title editing with save on `Enter` or blur and cancel on `Escape`
* modal editing for description, project, priority, due date, estimate, tags, notes, and status
* project reassignment to Inbox by setting `project_id = null`

### Task fields

* id
* title
* description
* project_id (nullable for inbox)
* status
* priority
* due_at
* scheduled_start
* scheduled_end
* estimate_minutes
* tags
* notes
* source
* created_at
* updated_at
* completed_at

### Task statuses

* inbox
* todo
* scheduled
* in_progress
* blocked
* done
* canceled

### Priority levels

* low
* medium
* high
* urgent

### Task deletion rule

When a task is deleted:

* linked calendar events must be deleted as well
* the UI must warn when scheduled blocks exist

---

## 9.3 Calendar events

### Description

Events are time-based items shown in the calendar.

### Requirements

The system must allow the user to:

* create an event
* edit an event
* delete an event
* assign an event to a project
* optionally link an event to a task
* support day/week/month/agenda views
* view events by project color
* distinguish fixed events from flexible work blocks

### Event fields

* id
* title
* description
* project_id
* linked_task_id (nullable)
* start_at
* end_at
* event_type
* recurrence_rule (optional)
* notes
* created_at
* updated_at

### Event types

* meeting
* work_block
* research
* implementation
* admin
* review
* personal
* other

### Calendar interactions

* drag task into calendar to create a scheduled event
* create event directly from calendar
* open linked task from event
* view all project-related work blocks
* drag events to reschedule
* resize events to change duration

### Event deletion rule

When an event is deleted:

* the linked task must remain
* if it was the only scheduled block for the linked task, the task returns to `todo`

---

## 9.4 Focus state

### Description

Focus state captures what the user is intentionally focused on now.

### Requirements

The system must allow the user to:

* set current focus project
* optionally set current focus task
* clear focus
* view focus in UI, CLI, and API

### Focus fields

* id
* project_id
* task_id (nullable)
* started_at
* source

---

## 9.5 UI

### Main sections

* Today
* Projects
* Tasks
* Calendar
* Settings

### Today screen requirements

Must show:

* current date
* current focus
* today’s tasks
* today’s events
* overdue items
* upcoming scheduled work

### Projects screen requirements

Must show:

* all projects
* status
* color
* open task counts
* upcoming event counts
* quick entry point into each project
* editing entry points
* a distinct project deletion surface

### Tasks screen requirements

Must support:

* list view
* filtering by project
* filtering by status
* filtering by due date
* filtering by scheduled/unscheduled
* quick add
* bulk clear done
* inline title editing
* modal editing for advanced fields
* delete from context menu and edit modal

### Calendar screen requirements

Must support:

* day view
* week view
* month view
* agenda view
* drag-and-drop scheduling
* drag-and-drop rescheduling
* resize-based duration edits
* click-to-edit event modal
* project-colored events
* linked task visibility

### Settings

Must support:

* local storage/database configuration
* CLI/API authentication settings if needed
* display preferences
* future integration settings

---

## 9.6 CLI

### Description

The CLI is a first-class interface, not a secondary convenience.

### Requirements

The CLI must allow:

* project creation and listing
* project editing and deletion
* task creation, listing, updating, and completion
* task deletion
* clearing completed tasks
* event creation, editing, viewing, and deletion
* today/week views
* focus setting and viewing

### Example command patterns

```bash
forge project add "Project Name"
forge project list
forge project show project-name
forge project edit project-name --color "#6f8466"
forge project delete project-name --yes

forge task add --project project-name "Task title"
forge task list --project project-name
forge task today
forge task edit 12 --project inbox
forge task done 12
forge task delete 12 --yes
forge task clear-done

forge event add --project project-name "Work block" --start "2026-03-07 10:00" --end "2026-03-07 12:00"
forge event edit 5 --end "2026-03-07T13:30"
forge event delete 5 --yes
forge cal today
forge cal week

forge focus set --project project-name --task 12
forge focus show
forge focus clear
```

### CLI expectations

* fast response
* clean output
* sensible defaults
* scriptable behavior
* machine-readable output option later
* supported Windows installs make `forge` available globally through the user PATH
* the CLI can be used without launching the desktop app

---

## 9.7 API

### Description

The API should allow agents and integrations to manipulate the system programmatically.

### Required capabilities

* CRUD for projects
* CRUD for tasks
* CRUD for events
* focus state retrieval and mutation

### Example endpoints

* `GET /projects`

* `POST /projects`

* `GET /projects/{id}`

* `PATCH /projects/{id}`

* `DELETE /projects/{id}`

* `GET /tasks`

* `POST /tasks`

* `PATCH /tasks/{id}`

* `DELETE /tasks/{id}`

* `POST /tasks/{id}/complete`

* `POST /tasks/clear-done`

* `GET /events`

* `POST /events`

* `PATCH /events/{id}`

* `DELETE /events/{id}`

* `GET /focus`

* `POST /focus`

* `DELETE /focus`

### API expectations

* local-first by default
* secure local access
* stable schema
* agent-friendly structure
* daemon remains the only SQLite writer

---

## 10. User stories

### Projects

* As a user, I want to create projects so that my work is organized by meaningful areas.
* As a user, I want to see all active projects in one place so that I know what I am managing.

### Tasks

* As a user, I want tasks to belong to projects so that they have context.
* As a user, I want to quickly add tasks from the CLI so that planning matches my technical workflow.
* As a user, I want to filter tasks by project, status, and date so that I can focus quickly.

### Calendar

* As a user, I want to drag a task into the calendar so that planned work becomes real time blocks.
* As a user, I want to see my week clearly so that I can reason about workload and priorities.

### Focus

* As a user, I want to set a current focus so that I can clearly orient myself when switching contexts.
* As a user, I want to return to Forge and instantly know what I should resume.

### API

* As a user, I want external agents to create and update tasks so that my planning system can become the operating layer for my tools.

---

## 11. Success criteria

The first version of Forge is successful if it allows the user to:

### Core success outcomes

* manage all active projects in one place
* add and organize tasks with proper project context
* schedule work in a real calendar
* use CLI for common workflows comfortably
* control the system from an API
* reduce friction when resuming interrupted work

### Behavioral success indicators

* daily use of Today screen or CLI becomes natural
* projects no longer feel mentally scattered
* scheduling becomes easier because tasks and events are connected
* fewer important tasks are lost between projects
* re-entry time into a paused project decreases

---

## 12. Constraints

### Product constraints

* must remain local-first
* must not depend on cloud infrastructure for core usage
* must remain focused and not expand into unrelated productivity categories
* must not become bloated in MVP

### UX constraints

* low friction
* minimal clutter
* strong information hierarchy
* technical but approachable

### Scope constraints

* exclude automatic event capture for now
* exclude timeline reconstruction for now
* exclude collaboration-heavy features for now

---

## 13. Technical direction

This PRD does not lock implementation fully, but the preferred direction is:

### Suggested architecture

* Rust core for reliability and performance
* SQLite for local data storage
* UI as desktop-oriented or web-based local app
* strong CLI as a first-class interface
* local API layer for agents and integrations

### Desired technical qualities

* fast startup and interaction
* robust local persistence
* easy backup/export later
* extensible architecture for future capture/timeline modules

---

## 14. MVP scope

### Included in MVP

* Projects CRUD
* Tasks CRUD
* Task filtering and status management
* Clear done tasks
* Events CRUD
* Calendar views: day, week, month, agenda
* Linking tasks to events
* Focus state
* Today screen
* Projects screen
* Tasks screen
* Calendar screen
* CLI support for common operations
* API support for core entities
* mutation confirmation in UI for destructive actions
* inline edit support for fast task and project updates

### Not included in MVP

* automatic event capture
* timeline reconstruction
* analytics/review intelligence
* collaboration
* cloud sync
* advanced notes/document system

---

## 15. Open questions

These do not block the PRD, but need decisions during design/build:

* Should the first UI be desktop-first or local web-first?
* Should the CLI talk to a local API or directly to the same core library?
* What is the best balance between a lightweight calendar and a fully featured scheduling interface?
* How should recurring events be handled in MVP vs later?
* Should “inbox” be a true project-less state or a dedicated pseudo-project?
* How should bulk editing work in tasks?

---

## 16. Final product definition

Forge is a local-first work operating system for a technical builder managing multiple active projects. It integrates project management, task management, and calendar scheduling into one coherent system and makes them accessible through UI, CLI, and API.

The purpose of Forge is to reduce fragmentation, lower cognitive load, improve project visibility, and make daily and weekly execution much easier to manage.

It exists because ordinary productivity tools do not fit a high-context, multi-project, execution-heavy technical life.

---




