# Forge Paths and Diagnostics

## Default Runtime Paths

- database: `~/.forge/forge.db`
- config: `~/.forge/config.toml`
- logs: `~/.forge/logs/`
- daemon log: `~/.forge/logs/forged.log`
- default API base: `http://127.0.0.1:37241`

## Managed Windows CLI Install

Managed install root:

- `%LOCALAPPDATA%\Programs\Forge\bin\forge.exe`
- `%LOCALAPPDATA%\Programs\Forge\bin\forged.exe`

That directory is expected on the user `PATH`.

## Diagnostic Commands

Use:

```powershell
forge doctor
```

`doctor` checks:

- CLI binary location
- managed install status
- PATH configuration
- daemon reachability
- config, database, and logs paths

Use:

```powershell
forge today
```

to confirm that the CLI can reach or auto-start the daemon and return a real summary.

## Updates

Use:

```powershell
forge update
```

Notes:

- Windows-first behavior
- updates the managed CLI install only
- updates `forge.exe` and `forged.exe`
- desktop app updates remain installer-based

## Repo Development Entry Point

When the managed CLI is not installed and you are operating from the Forge repo, use:

```powershell
cargo run -p forge -- <command>
```

Use:

```powershell
cargo run -p forged
```

only when you explicitly need to start the daemon yourself.
