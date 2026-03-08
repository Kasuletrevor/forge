# Product Spec Prompt

I want to build a **local-first work operating system** for myself.

This is not a normal to-do app, and it is not just a calendar. It is a system built around the reality of how I work day to day.

## Who I am and how I work

I am a highly technical builder working across multiple parallel domains at the same time. My day-to-day life includes software engineering, AI/ML experimentation, backend and infrastructure work, research, product development, planning, and coordination. I often move between coding, debugging, deployments, reading papers, organizing project work, preparing updates, and planning next steps.

I do not work in a simple linear way where I sit inside one project for the whole day and complete one clean list of tasks from top to bottom. My work is dynamic and high-context. I regularly switch between multiple active projects, each with its own technical details, priorities, deadlines, and mental state.

My work often includes things like:

* building and debugging backend systems
* managing product ideas and technical execution
* handling infrastructure, deployments, servers, and environments
* working with agents, AI tools, and developer workflows
* reading papers and organizing research directions
* planning implementation steps for products
* managing academic, professional, and operational work in parallel

Because of this, normal task apps do not fit the way I actually operate.

---

## The problem I have

My biggest issue is not lack of effort, motivation, or ideas. My issue is **fragmentation**.

My work is spread across:

* projects
* notes
* terminals
* calendars
* chats
* repos
* deployment tasks
* ideas
* documents
* context in my head

This creates several problems.

### 1. Context switching is expensive

I switch between projects often. Every switch has a cost. I have to remember:

* what I was doing
* what is pending
* what matters next
* what belongs to which project
* what is urgent vs important

That reconstruction wastes energy and time.

### 2. My work is high-context and nonlinear

A lot of my work is not cleanly represented by standard productivity tools. I might:

* investigate something
* test a few things
* pause
* compare options
* jump into another related task
* move to another project
* come back later

A simple task list does not reflect that reality well.

### 3. I need project visibility, not isolated tasks

Most systems treat tasks as standalone items. That does not work for me. I need to see work in terms of:

* projects
* the tasks inside them
* the scheduled events around them
* what I am focusing on this week
* what is slipping
* what needs time blocked on the calendar

### 4. My calendar and my tasks are disconnected

Typical tools separate tasks from time. But for me, a task that is not scheduled often remains abstract. I need tasks and calendar to work together naturally. I need to see:

* what I plan to do
* when I plan to do it
* which project it belongs to
* how the week actually looks

### 5. I need fast control through CLI and agents

I do not want to depend only on clicking around a UI. I want a system that can be controlled from:

* a good web or desktop UI
* a CLI
* APIs
* external agents like Codex and other assistant systems

This matters because a lot of my work already happens in a developer environment, and I want my planning system to integrate with that way of working rather than fight it.

### 6. Re-entry after interruption is too hard

When I return to a project after some hours or days, I often have to rebuild the mental model again. I need a system that helps me resume quickly by showing:

* the project
* the open tasks
* scheduled work
* recent activity
* what should happen next

### 7. I am managing too many parallel responsibilities for ordinary tools

I am not managing just one team board or one study plan. I am managing a mix of:

* technical product work
* implementation work
* research work
* infrastructure work
* planning and coordination
* personal execution priorities

I need a system designed for someone operating across all those layers.

---

## Why I need this product

I need this product because I want a single system that reduces cognitive overhead and helps me operate with more clarity.

The purpose of the product is to give me:

* one place to see all my active projects
* one place to manage tasks properly
* one place to schedule events and work blocks on a real calendar
* one system that can be controlled through both UI and CLI
* one API surface that can be used by agents
* one structure that reflects how I actually think and work

This product should help me:

* reduce context-switching friction
* resume work faster
* keep projects organized
* connect planning with actual execution
* make the week easier to reason about
* stop losing important next steps
* keep visible what matters across multiple active initiatives

This is not about building a prettier to-do list. It is about building a **personal operating system for work**.

---

## What I want to build

I want to build a **local-first project, task, and calendar operating system** that is designed for a technical operator.

It should combine three main things:

1. **Projects**
2. **Tasks**
3. **Calendar events / time blocks**

These should work together as one system.

---

# Core product concept

## 1. Projects are the top-level structure

Projects are the main containers for my work.

A project represents a meaningful area of responsibility or execution.

Examples might include:

* a product
* a research stream
* a teaching stream
* a deployment effort
* a personal initiative
* an admin or planning area

Each project should have:

* a name
* description
* status
* tags
* color or visual identity
* open tasks
* scheduled events
* recent activity or state
* priority / current focus information

I should be able to view all projects clearly from the UI and also manage them from the CLI.

---

## 2. Tasks should belong to projects

Tasks should not float around disconnected from context.

Each task should belong to a project or be in a general inbox before assignment.

A task should support:

* title
* description
* status
* priority
* due date
* scheduled date/time
* estimate
* tags
* notes
* source (manual, CLI, agent)
* created at / completed at

Task statuses should include:

* inbox
* todo
* scheduled
* in progress
* blocked
* done
* canceled

I want to be able to:

* add tasks quickly
* move them between projects
* mark them done
* clear completed ones
* schedule them
* see today’s tasks
* see project tasks
* see overdue tasks
* see unscheduled tasks

---

## 3. Events and calendar must be first-class

I need a proper calendar, not a weak add-on.

The calendar should support:

* day view
* week view
* month view
* agenda view

Events should include:

* title
* project
* start time
* end time
* type
* notes
* recurrence if needed
* optional linked task

An event can be:

* a fixed meeting
* a deep work block
* a research block
* an implementation session
* admin time
* review time
* personal time

Most importantly, tasks and calendar should connect naturally.

I want to be able to:

* turn a task into a scheduled event
* drag a task into the calendar
* see which tasks are planned this week
* see work blocks by project
* separate fixed events from flexible work blocks

---

# Required interfaces

## 1. UI

The UI should show the system clearly and make navigation easy.

Main sections should include:

* Today
* Projects
* Tasks
* Calendar
* Timeline or Activity later
* Review later
* Settings

For now, the key UI needs are:

### Today screen

This should show:

* today’s date
* current focus
* today’s tasks
* today’s events
* upcoming work blocks
* important overdue or unscheduled items

### Projects screen

This should show:

* all projects
* status of each project
* number of open tasks
* upcoming scheduled work
* quick action buttons
* inline rename for project name
* project metadata editing
* a clearly separated deletion path

### Tasks screen

This should allow:

* filtering by project
* filtering by status
* filtering by due date
* filtering by scheduled state
* quick add
* bulk clear done
* easy move/update
* inline title editing
* advanced task editing in a modal
* deletion with explicit confirmation

### Calendar screen

This should provide:

* proper week and day views
* project-colored events
* clear time blocking
* link between tasks and events
* a serious calendar experience, not a toy widget
* event click editing
* drag rescheduling
* resize-based duration updates
* deletion from an event modal

---

## 2. CLI

The CLI is very important.

I want to be able to manage the system from command line because that is natural for how I work.

The CLI should support operations like:

* create project
* list projects
* edit project
* delete project
* create task
* list tasks
* edit task
* mark task done
* delete task
* clear completed tasks
* create event
* edit event
* delete event
* show today
* show week
* set current focus
* move tasks between projects

Example command style:

```bash
forge project add "Project Name"
forge project list
forge project edit project-name --name "New Name"
forge project delete project-name --yes

forge task add --project project-name "Task title"
forge task today
forge task edit 14 --priority high
forge task done 14
forge task delete 14 --yes
forge task clear-done

forge event add --project project-name "Research block" --start "2026-03-07 10:00" --end "2026-03-07 12:00"
forge event edit 9 --start "2026-03-08T14:00"
forge event delete 9 --yes
forge cal today
forge cal week

forge focus set --project project-name
forge focus show
```

The CLI should feel fast, simple, and natural.

---

## 3. API for agents and integrations

I want a proper API so that tools like Codex and other agents can interact with the system.

The API should allow agents to:

* add tasks
* update tasks
* mark tasks done
* clear done tasks
* create events
* update events
* delete events
* update projects
* delete projects
* fetch project lists
* fetch current focus
* fetch today’s work
* move items across projects

This is important because I want the system to become the central operating layer that both I and my tools can use.

---

# Product goals

This product should help me achieve the following outcomes:

## 1. Clear project awareness

I should always be able to see what I am actively working on across all key areas.

## 2. Reduced cognitive load

I should not have to mentally track everything across scattered tools.

## 3. Better daily execution

I should know what I need to do today, what is scheduled, and what belongs where.

## 4. Better weekly structure

I should be able to look at the week and understand:

* where time is going
* what is planned
* what has been neglected
* what needs attention next

## 5. Faster re-entry into work

When I resume a project, I should quickly understand its current state.

## 6. Better support for technical workflow

The system should feel native to someone who works through terminals, APIs, and tools, not only through a mouse-driven GUI.

---

# Non-goals for now

To keep the system focused, I do not want it to become:

* a bloated team collaboration suite
* a chat app
* a huge note-taking platform
* a generic productivity clone
* a cloud-first SaaS dependency

This should stay focused on:

* local-first operation
* project/task/calendar management
* CLI + UI + API control
* personal execution clarity

Also, for now, leave out automatic local event capture and timeline reconstruction. Those can come later.

---

# Product personality

This product should feel:

* serious
* clean
* fast
* low-friction
* structured
* technical
* calm rather than noisy

It should feel like a tool for an operator, not a gamified consumer productivity app.

---

# Technical direction

The product should be designed as a **local-first system**.

Possible architecture direction:

* Rust core if suitable
* local SQLite database
* strong CLI
* UI that can be desktop-oriented or web-based
* API layer for agent control

The final implementation should prioritize:

* reliability
* speed
* simplicity
* extensibility

---

# MVP definition

The first usable version should include:

## Projects

* create
* list
* view
* update basic metadata
* delete while preserving related tasks and events by moving them to Inbox / unassigned

## Tasks

* add
* edit
* delete
* complete
* move
* filter
* clear done
* assign to project
* schedule
* inline title editing in UI
* modal editing for advanced fields

## Calendar / events

* add event
* edit event
* delete event
* day/week/month views
* link events to projects
* optionally link tasks to events
* drag and resize event scheduling in calendar

## Focus state

* set current project focus
* view current focus

## CLI

* full support for common project/task/event actions

## API

* CRUD endpoints for projects, tasks, and events
* focus state endpoints

Lifecycle rules for MVP:

* deleting an event must not delete its linked task
* deleting a task must delete linked events
* deleting a project must not delete tasks; it moves them to Inbox and nulls event project ownership

## UI

* Today
* Projects
* Tasks
* Calendar

Mutation UX for MVP:

* use inline editing where low-friction makes sense
* use modal editing for advanced task and event fields
* require explicit confirmation for deletions
* reflect all mutations only after daemon API confirmation

That is the core product.

---

# Final intent

I want to build a personal work operating system because my life and work are too high-context, multi-project, and technically complex for ordinary task tools.

I need a system that matches how I actually function:

* project-based
* execution-heavy
* calendar-aware
* CLI-friendly
* agent-compatible
* local-first

The goal is to create a tool that reduces fragmentation, improves clarity, makes planning usable, and supports me as a technical builder operating across many parallel streams of work.

---
