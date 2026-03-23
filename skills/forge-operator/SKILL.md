---
name: forge-operator
description: Operate Forge correctly through its CLI and daemon model. Use when an agent needs to create, inspect, update, schedule, or delete Forge projects, tasks, events, or focus state; link projects to local workdirs; use cwd-based project context; run `forge doctor` or `forge update`; or explain how Forge behaves as a local-first work operating system.
---

# Forge Operator

Operate Forge through the CLI while respecting the daemon-only write model and the product's lifecycle rules.

## Core Rules

- Treat `forged` as the only SQLite writer. Do not bypass Forge through direct database edits.
- Prefer the public CLI entrypoint:
  - use `forge ...` when the managed CLI is installed
  - use `cargo run -p forge -- ...` only when working from this repo without a global install
- Start with `references/behavior.md` when the task depends on workdir linking, cwd context, or deletion/scheduling rules.
- Start with `references/cli.md` when the task is primarily command selection or command composition.
- Start with `references/paths.md` when the task is about installation, daemon health, logs, config, or Windows CLI setup.

## Workflow

1. Check installation or daemon health first when the environment is unclear.
   - Run `forge doctor`.
   - Use `references/paths.md` if you need runtime locations or managed install details.
2. Resolve project context before acting.
   - If the task names a project explicitly, use that explicit selector.
   - Otherwise, rely on cwd context only for commands that support it.
   - If context seems ambiguous, inspect project links or run `forge project status`.
3. Mutate Forge state through explicit CLI commands.
   - Use project/task/event/focus subcommands instead of inventing API calls unless the task explicitly needs the HTTP API.
4. Be deliberate with destructive actions.
   - Confirm the target entity.
   - Remember the lifecycle rules in `references/behavior.md` before deleting tasks, events, or projects.

## Usage Heuristics

- Prefer explicit project refs for risky or bulk operations even if cwd context would work.
- Use `forge task list --all` or `forge event list --all` when you need a global view instead of cwd-scoped results.
- Treat `forge event list --task <id>` as task-scoped, not cwd-scoped.
- Use `forge project link`, `unlink`, `status`, and `import` for repo-aware setup.
- Use `forge today` for the full day summary; it may annotate the current project but does not narrow the whole view to one project.

## Read Next

- `references/cli.md`: command cookbook and contextual defaults
- `references/behavior.md`: lifecycle rules, cwd behavior, workdir linking
- `references/paths.md`: install, daemon, logs, config, and troubleshooting locations
