# Installing Forge

Forge is currently packaged for Windows first.

## Release Assets

GitHub Releases publish two Windows artifacts:

- `forge-v<version>-windows-x64-setup.exe`
- `forge-v<version>-windows-x64-portable.zip`

The setup executable is the default install path for normal users. The portable zip is intended for manual distribution, debugging, and environments where an installer is not desirable.

Current releases are unsigned. Windows SmartScreen may warn on first launch until code signing is added.

## What Gets Installed

The Windows installer ships:

- the Forge desktop application
- the bundled `forged` daemon sidecar
- the frontend assets required by the Tauri shell

The packaged desktop build starts the daemon locally and communicates with it over the loopback API.

## Local Data Paths

Forge keeps user data outside the application install directory:

- database: `~/.forge/forge.db`
- config: `~/.forge/config.toml`
- logs: `~/.forge/logs/`
- daemon log: `~/.forge/logs/forged.log`

Upgrades should preserve everything under `~/.forge`.

## Portable Package

The portable zip contains:

- `Forge.exe`
- `forged.exe`
- `README.txt`

`forged.exe` must remain next to `Forge.exe`. Forge portable still stores data in `~/.forge`, not beside the executable.

## Upgrade and Uninstall Behavior

Expected behavior:

- upgrading Forge keeps the existing `~/.forge` data directory
- uninstalling the app removes application binaries
- uninstalling does not remove user data automatically

If a release ever changes this behavior, document it in the release notes before publishing.
