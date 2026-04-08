# Forge CLI

## Entry Points

Use one of these command forms:

```powershell
forge <command>
cargo run -p forge -- <command>
```

Prefer `forge` when the managed CLI is installed. Use `cargo run -p forge --` only when operating from this repo without a global install.

## First Commands

Use these first when the state of the install or daemon is unclear:

```powershell
forge doctor
forge today
forge project list
```

## Projects

Representative commands:

```powershell
forge project add "Forge"
forge project list
forge project show forge
forge project edit forge --name "Forge Core"
forge project link forge "C:\Users\Trevor\workspace\forge"
forge project unlink forge
forge project status forge
forge project import "C:\Users\Trevor\workspace"
forge project delete forge --yes
```

Notes:

- `project status` can infer the project from the current working directory when a linked workdir matches.
- `project import` scans a workspace root for git repos and creates or links projects through the daemon.

## Tasks

Representative commands:

```powershell
forge task add "Fix CDC connector"
forge task add "Fix CDC connector" --project forge
forge task list
forge task list --project forge
forge task list --all
forge task list --inbox
forge task today
forge task edit 14 --priority high
forge task done 14
forge task delete 14 --yes
forge task clear-done
```

Context defaults:

- `task add` can attach to the cwd project when Forge can resolve it.
- `task list` defaults to the cwd project when there is no explicit `--project`, `--all`, or `--inbox`.
- Use `--all` to escape cwd scoping.

## Events

Representative commands:

```powershell
forge event add "Research block" --project forge --start "2026-03-23T10:00" --end "2026-03-23T12:00"
forge event list
forge event list --project forge
forge event list --task 9
forge event list --all
forge event edit 9 --end "2026-03-23T13:00"
forge event delete 9 --yes
```

Context defaults:

- `event add` can attach to the cwd project when Forge can resolve it.
- `event list` defaults to the cwd project when there is no explicit `--project`, `--task`, or `--all`.
- `event list --task <id>` is already explicit and should not be narrowed by cwd context.

## Focus

Representative commands:

```powershell
forge focus set --project forge
forge focus set
forge focus show
forge focus clear
```

Notes:

- `focus set` can infer the project from the current working directory when no `--project` is given.
- If no linked project matches the cwd, `focus set` should fail clearly rather than guessing.

## Diagnostics and Updates

```powershell
forge doctor
forge update
forge --version
forge --help
```

- `doctor` is the first diagnostic command.
- `update` targets the managed Windows CLI install and updates `forge.exe` plus `forged.exe`.
