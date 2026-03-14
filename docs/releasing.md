# Releasing Forge

Forge uses a Windows-first desktop and CLI release flow modeled after Codex's split CI and release pipelines.

## Release Workflow

The repo has two GitHub Actions workflows:

- `CI`
- `Desktop Release`

`CI` validates the workspace on pushes and pull requests to `main`.

`Desktop Release` is the publishing workflow. It runs on:

- semver tags like `v0.1.0`
- prerelease tags like `v0.1.1-alpha.1`
- manual `workflow_dispatch` runs for artifact testing

## Version Contract

Before tagging a release, keep these versions in sync:

- workspace version in `Cargo.toml`
- desktop version in `apps/desktop/package.json`
- desktop bundle version in `apps/desktop/src-tauri/tauri.conf.json`

The release workflow checks this before building tagged releases.

## Cutting a Release

1. Ensure `main` is green.
2. Create a tag that matches the Forge version:

```powershell
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

1. Wait for `Desktop Release` to finish.
2. Confirm the GitHub Release contains:
   - installer `.exe`
   - desktop portable `.zip`
   - CLI `.zip`
   - `SHA256SUMS.txt`

## Dry-Run Artifact Testing

Use GitHub CLI to test the packaging flow without publishing a release:

```powershell
gh workflow run release-desktop.yml --ref main
gh run watch
gh run download <run-id> --name forge-desktop-windows-x64 --dir artifacts
```

This is the expected loop while refining installer, CLI, and portable asset behavior.

## Local Windows Packaging

From the repo root:

```powershell
npm ci --prefix frontend
npm ci --prefix apps/desktop
npm run verify:version --prefix apps/desktop
npm run build:release --prefix apps/desktop
```

That flow:

- builds `forged` as a release sidecar
- builds `forge` as a release CLI binary
- stages the sidecar for Tauri bundling
- builds the NSIS installer
- creates the desktop portable zip in `apps/desktop/dist/release`
- creates the standalone CLI zip in `apps/desktop/dist/release`

## Release Smoke Checklist

For every release, verify:

- installer exists and launches Forge
- installer configures `%LOCALAPPDATA%\\Programs\\Forge\\bin` and user `PATH`
- portable zip contains `Forge.exe` and `forged.exe`
- CLI zip contains `forge.exe`, `forged.exe`, install scripts, and `README.txt`
- `forge --version` works from a fresh terminal after install
- `forge doctor` works from the managed CLI install
- `forge today` can auto-start `forged`
- launching Forge makes `GET /health` return `ok`
- first run creates config, database, and log paths under `~/.forge`
- Settings shows the live runtime paths

## Notes

- Releases are currently unsigned.
- Windows SmartScreen warnings are expected until signing is added.
- This workflow is Windows-first; macOS and Linux packaging are out of scope for the current release phase.
- `forge update` should continue to target the stable `forge-v<version>-windows-x64-cli.zip` asset and validate it against `SHA256SUMS.txt`.
