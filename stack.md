For **Forge**, the stack should match the core philosophy of the product:

* **local-first**
* **fast**
* **CLI-friendly**
* **agent-friendly**
* **desktop capable**
* **simple to maintain**

Given that, the cleanest stack is **Rust + Tauri + SQLite**, with a strong CLI and local API.

Below is the recommended stack and why.

---

# Forge — Recommended Tech Stack

## 1. Core Language

**Rust**

Why Rust:

* fast
* memory safe
* excellent CLI ecosystem
* great for local services/daemons
* ideal for Tauri desktop apps
* strong SQLite support
* good concurrency for future event capture

Rust becomes the **core engine** of Forge.

It will power:

* backend services
* CLI
* local API
* event capture system (future)

---

# 2. Desktop App Framework

### Tauri

Tauri allows:

* Rust backend
* web frontend
* small binaries
* native desktop performance

Why Tauri is perfect here:

* local-first architecture
* Rust-native backend
* fast startup
* minimal memory footprint
* easy to bundle CLI + UI together

Structure:

```
Forge Desktop App
├── Rust Core
├── Local API
├── SQLite
└── React UI
```

---

# 3. Frontend

### React

(or Next.js if preferred)

Used for:

* Today screen
* Projects dashboard
* Tasks view
* Calendar
* Settings

Recommended libraries:

**UI**

* shadcn/ui primitives
* TailwindCSS
* Radix primitives for dialogs, alert dialogs, menus, and toasts

**Calendar**

* FullCalendar

These provide:

* day/week/month views
* drag scheduling
* event visualization
* event click editing
* resize handlers

---

# 4. Database

### SQLite

Why SQLite:

* perfect for local-first apps
* zero configuration
* fast
* portable
* easy backups
* good Rust support

Tables:

```
projects
tasks
events
focus_state
```

Future tables:

```
captured_events
sessions
activity
```

---

# 5. Rust Web Framework (Local API)

### Axum

Used for the **internal API**.

Why Axum:

* lightweight
* async
* great Rust ecosystem
* easy integration with Tauri

API example:

```
GET  /projects
POST /projects
PATCH /projects/{id}
DELETE /projects/{id}

GET  /tasks
POST /tasks
PATCH /tasks/{id}
DELETE /tasks/{id}

GET  /events
POST /events
PATCH /events/{id}
DELETE /events/{id}

GET  /focus
POST /focus
```

Agents will use this.

---

# 6. ORM / Database Layer

### SQLx

Why SQLx:

* async
* compile-time query checking
* SQLite support
* lightweight

Alternative:

* Diesel

But SQLx is simpler.

---

# 7. CLI

Use Rust CLI framework:

### Clap

Example commands:

```
forge project add "VentraScan"
forge project list
forge project edit ventrascan --name "VentraScan Core"

forge task add --project ventrascan "Fix CDC connector"
forge task today
forge task done 14
forge task delete 14 --yes

forge event add --project research "Read ASR paper"
forge event edit 7 --end "2026-03-07T15:30"
forge cal today

forge focus set --project ventrascan
forge focus show
```

CLI talks to:

* local API
  or
* shared core library

---

# 8. State Management (Frontend)

React Query or TanStack Query.

### TanStack Query

Used for:

* caching API calls
* syncing UI state
* background updates
* mutation invalidation for `projects`, `tasks`, `events`, `today`, and `calendar`

---

# 9. UI Component Library

### shadcn/ui

Why:

* clean
* modern
* customizable
* good for dashboards
* Tailwind-based
* strong fit for inline edit and confirm-delete workflows

---

# 10. Calendar Component

Recommended:

### FullCalendar

Supports:

* day view
* week view
* month view
* agenda/list view
* drag scheduling
* resize scheduling
* event click editing

---

# 11. Local Storage Structure

Database file:

```
~/.forge/forge.db
```

Config:

```
~/.forge/config.toml
```

Logs:

```
~/.forge/logs/
```

Future capture:

```
~/.forge/capture/
```

---

# 12. Project Structure

```
forge/

apps/
 ├─ desktop/      (Tauri app)
 └─ cli/

core/
 ├─ api/
 ├─ services/
 ├─ models/
 ├─ db/
 └─ focus/

frontend/
 ├─ src/
 ├─ components/
 ├─ pages/
 └─ calendar/

database/
 ├─ migrations/
 └─ schema.sql
```

---

# 13. Local Architecture

```
                 Forge Desktop (Tauri)
                        │
                        │
                Rust Core Services
                        │
       ┌────────────────┼────────────────┐
       │                │                │
    Projects         Tasks            Events
       │                │                │
       └───────────────API──────────────┘
                        │
                      SQLite
                        │
        ┌───────────────┴───────────────┐
        │                               │
       CLI                            Agents
```

---

# 14. Why This Stack Works

This stack is powerful because it allows:

### CLI-first workflow

You can operate Forge directly from terminal.

### Local-first architecture

No cloud required.

### Desktop speed

Tauri + Rust gives native performance.

### Agent compatibility

Local API means:

* Codex
* LangChain
* local agents

can manage tasks/events/projects.

Safe mutation model

The CLI and UI both mutate through the daemon API, so:

* SQLite ownership stays in one place
* deletion lifecycle rules live in the service layer
* UI cache invalidation stays predictable

### Extensibility

Later you can add:

* automatic event capture
* git activity tracking
* terminal command logging
* coding session detection
* AI timeline reconstruction

without redesigning the system.

---

# 15. Future Extensions (enabled by this stack)

This architecture supports powerful future modules:

**Local event capture**

* git commits
* terminal commands
* coding sessions
* editor activity

**Timeline reconstruction**

```
09:00–10:30 VentraScan coding
10:30–11:00 reading ASR paper
11:00–12:10 Family Circle debugging
```

**Weekly analytics**

```
VentraScan: 11h
Family Circle: 6h
Research: 4h
Teaching: 3h
```

**Agent copilots**

Agents can:

* add tasks
* schedule blocks
* clean backlog
* suggest priorities

---

# Final Stack Summary

Core language
Rust

Desktop framework
Tauri

Frontend
React + Tailwind + shadcn/ui

Calendar
FullCalendar

Database
SQLite

Backend framework
Axum

Database layer
SQLx

CLI
Clap

State management
TanStack Query

