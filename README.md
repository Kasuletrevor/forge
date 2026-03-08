# Forge

Forge is a local-first work operating system for technical builders managing multiple active projects at the same time. It combines projects, tasks, calendar events, and focus state into one coherent system with a desktop UI, CLI, and local API.

Forge is not a generic todo list and not just a calendar. The product is built around one rule: the local `forged` daemon is the only writer to SQLite. The CLI and UI both mutate state through the daemon API.

## Current Shape

Forge currently supports:

- projects with status, color, tags, and edit and delete flows
- tasks with inbox support, scheduling, completion, edit and delete flows, and project reassignment
- events with recurrence support, linked tasks, edit and delete flows, and calendar drag and resize interactions
- focus state and Today summary views
- a local Axum API for UI, CLI, and agent access
- a Rust CLI that can auto-start the daemon and operate through the API
- a Tauri desktop shell with a React frontend

Lifecycle rules already enforced:

- deleting an event preserves its linked task
- deleting a task removes linked events
- deleting a project moves tasks to Inbox and clears event project ownership
- the daemon remains the only SQLite writer

## Architecture

```text
UI      -> API -> forged daemon -> SQLite
CLI     -> API -> forged daemon -> SQLite
Agents  -> API -> forged daemon -> SQLite
```

Core stack:

- Rust workspace for domain, services, persistence, API, daemon, and CLI
- SQLite for local persistence
- Axum for the local HTTP API
- Tauri for the desktop shell
- React, TypeScript, Tailwind, shadcn-style primitives, TanStack Query, and FullCalendar for the frontend

Default local paths:

- database: `~/.forge/forge.db`
- config: `~/.forge/config.toml`
- logs: `~/.forge/logs/`
- API: `http://127.0.0.1:37241`

## Workspace Layout

```text
apps/
  forge/              CLI client
  forged/             local daemon
  desktop/            Tauri wrapper
crates/
  domain/             core entities and validation
  app/                service layer and lifecycle rules
  persistence-sqlite/ SQLite repositories and migrations
  api/                Axum routes and HTTP surface
frontend/             React operator UI
```

## Running Forge

### Prerequisites

- Rust toolchain
- Node.js and npm
- Windows is the current primary development environment

### Start the daemon

```powershell
cargo run -p forged
```

### Use the CLI

```powershell
cargo run -p forge -- project add "Forge"
cargo run -p forge -- task add "Fix CDC connector" --project forge
cargo run -p forge -- today
```

The CLI will attempt to start the daemon automatically if it is not already available.

### Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

### Run the desktop shell

```powershell
cd apps/desktop
npm install
npm run dev
```

## Development Commands

Backend checks:

```powershell
cargo test -p app
cargo check -p persistence-sqlite -p app -p api -p forged -p forge
```

Frontend build:

```powershell
cd frontend
npm run build
```

## Product Interfaces

### UI

Main screens:

- Today
- Projects
- Tasks
- Calendar
- Settings

Editing and deletion in the UI use API-backed TanStack Query mutations with query invalidation and destructive confirmation dialogs.

### CLI

Representative commands:

```text
forge project add|list|show|edit|delete
forge task add|list|today|done|clear-done|edit|delete
forge event add|list|edit|delete
forge focus ...
forge today
```

### API

Representative endpoints:

```text
GET    /health
GET    /today
GET    /calendar/range
GET    /projects
PATCH  /projects/{id}
DELETE /projects/{id}
GET    /tasks
PATCH  /tasks/{id}
DELETE /tasks/{id}
GET    /events
PATCH  /events/{id}
DELETE /events/{id}
```

## Design Direction

Forge is intended to feel like a fast operational console rather than a generic dashboard:

- dense but controlled layout
- calm editorial presentation
- low-friction editing
- deliberate destructive actions
- strong project visibility across tasks and calendar blocks

## Docs

- [SPEC.md](SPEC.md)
- [PRD.md](PRD.md)
- [stack.md](stack.md)

## Next Phase

The next phase should focus on hardening and speed:

- regression coverage for mutation flows across API, CLI, and UI
- keyboard-first workflows and navigation
- better drag and bulk-edit interactions in the UI
- desktop packaging and release discipline
- stronger recurrence editing and validation
