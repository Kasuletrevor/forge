# Changelog

All notable changes to Forge will be documented in this file.

The format is based on Keep a Changelog, adapted for the current pre-1.0 release cadence.

## [Unreleased]

## [0.2.2] - 2026-04-29

### Changed

- Extended Forge frontend design tokens with the refreshed palette, typography scale, shadows, and easing values for the next Windows desktop release.

## [0.2.1] - 2026-04-08

### Added

- `forge-operator` skill under `skills/` for repo and local agents, covering Forge CLI usage, lifecycle rules, workdir linking, cwd context, and runtime paths

## [0.2.0] - 2026-03-16

### Added

- Project workdir linking across the daemon, API, CLI, and desktop UI
- Live repo-aware project status with cwd-based project resolution for the CLI
- Native desktop folder picking for linked project directories
- Recurrence builder UI for calendar events with work-oriented presets and previews
- Windows global CLI installation, `forge doctor`, and `forge update`
- Windows desktop and CLI release packaging with published GitHub artifacts

### Changed

- Projects screen now surfaces linked workdirs and repo health directly in the UI
- Release automation now publishes notes from this changelog instead of generated GitHub notes
- Forge versions are synchronized at `0.2.0` across the Rust workspace and desktop packages

### Fixed

- Query invalidation now refreshes project repo status after project mutations
- Windows path resolution for linked project workdirs now handles canonical path prefixes correctly
- Release workflows now use Node 24-compatible GitHub Actions and corrected tag metadata propagation
- Desktop packaging now includes the required Linux CI dependencies and Tauri icon assets
