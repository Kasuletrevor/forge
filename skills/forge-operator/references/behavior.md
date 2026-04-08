# Forge Behavior

## Architecture

Forge is local-first and daemon-centered:

```text
CLI/UI/agents -> daemon API -> forged -> SQLite
```

Important rule:

- `forged` is the only SQLite writer.

## Core Entities

- `Project`: optional linked workdir, status, color, tags, description
- `Task`: can live in Inbox when `project_id = null`
- `Event`: can link to a task and can be recurring
- `Focus`: current active project and optional task

## Lifecycle Rules

- Deleting an event preserves its linked task.
- Deleting the last scheduled event for a task returns that task to `todo` and clears its schedule fields.
- Deleting a task deletes its linked events.
- Deleting a project does not delete its tasks.
- Deleting a project moves tasks to Inbox and clears event project ownership.

Use explicit identifiers for destructive actions. Do not rely on cwd inference for deletes.

## Workdir Linking

Projects can carry an optional linked local workdir.

Use these commands to manage it:

- `forge project link`
- `forge project unlink`
- `forge project status`
- `forge project import`

Git status is read live from the linked directory. Forge does not persist branch or dirty-state metadata as project fields.

## CWD Context

Forge can infer project context from the current working directory.

Behavior:

- explicit project selectors win over inferred context
- linked workdirs are optional; not every project is repo-backed
- nested cwd paths can still resolve to the linked project
- git-root-aware resolution is preferred before raw path fallback

Commands that can use cwd context:

- `forge task add`
- `forge event add`
- `forge task list`
- `forge event list`
- `forge project status`
- `forge focus set`
- `forge today` for current-project annotation

Escape hatches:

- `forge task list --all`
- `forge task list --inbox`
- `forge event list --all`

Failure behavior:

- create flows may fall back to Inbox or unassigned behavior when no project is resolved
- `project status` and `focus set` should fail clearly when cwd context is required but unavailable

## Repo Import

`forge project import <workspace-root>` scans for git repos below a workspace root and then:

- creates missing projects for new repos
- links matching unlinked projects
- reports skipped conflicts or already-linked repos
