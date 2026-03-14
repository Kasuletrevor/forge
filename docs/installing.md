# Installing Forge

Forge is currently packaged for Windows first.

## Release Assets

GitHub Releases publish three Windows artifacts:

- `forge-v<version>-windows-x64-setup.exe`
- `forge-v<version>-windows-x64-portable.zip`
- `forge-v<version>-windows-x64-cli.zip`

Distribution roles:

- `setup.exe` is the default install path for normal users and configures the global CLI
- `portable.zip` is intended for manual desktop distribution, debugging, and environments where an installer is not desirable
- `cli.zip` is a terminal-first package that installs only `forge.exe` and `forged.exe`

Current releases are unsigned. Windows SmartScreen may warn on first launch until code signing is added.

## What Gets Installed

The Windows installer ships:

- the Forge desktop application
- the bundled `forged` daemon sidecar
- the frontend assets required by the Tauri shell
- a managed CLI install under `%LOCALAPPDATA%\\Programs\\Forge\\bin`

The managed CLI install contains:

- `forge.exe`
- `forged.exe`

The setup flow adds `%LOCALAPPDATA%\\Programs\\Forge\\bin` to the user `PATH`.

The packaged desktop build starts the daemon locally and communicates with it over the loopback API.

## Standalone CLI Package

The standalone CLI zip contains:

- `forge.exe`
- `forged.exe`
- `install-cli.ps1`
- `uninstall-cli.ps1`
- `README.txt`

Running `install-cli.ps1` installs the binaries into `%LOCALAPPDATA%\\Programs\\Forge\\bin` and adds that directory to the user `PATH`.

Running `uninstall-cli.ps1` removes the managed CLI install and removes the Forge `PATH` segment if present.

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

The portable package does not modify `PATH` and does not install `forge.exe` globally.

## Upgrade and Uninstall Behavior

Expected behavior:

- upgrading Forge keeps the existing `~/.forge` data directory
- uninstalling the app removes application binaries and the managed CLI install
- uninstalling does not remove user data automatically

PATH behavior:

- the desktop installer and standalone CLI installer update the user `PATH`
- a new terminal session may be required before `forge` resolves without an absolute path
- uninstall removes the Forge-managed `PATH` segment if present

If a release ever changes this behavior, document it in the release notes before publishing.
