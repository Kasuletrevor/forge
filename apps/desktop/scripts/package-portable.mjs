import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const desktopPackage = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'))
const version = process.env.FORGE_RELEASE_VERSION ?? desktopPackage.version
const target = process.env.FORGE_SIDECAR_TARGET ?? inferWindowsTarget()
const platformLabel = target.startsWith('aarch64') ? 'windows-arm64' : 'windows-x64'
const releaseDir = resolve(desktopRoot, 'dist', 'release')

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

const installer = locateInstaller()
const appBinary = locateFirstExisting([
  resolve(repoRoot, 'target', 'release', 'Forge.exe'),
  resolve(repoRoot, 'target', 'release', 'forge-desktop.exe'),
  resolve(repoRoot, 'target', target, 'release', 'Forge.exe'),
  resolve(repoRoot, 'target', target, 'release', 'forge-desktop.exe'),
  resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'Forge.exe'),
  resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'forge-desktop.exe'),
])
const sidecar = locateFirstExisting([
  resolve(repoRoot, 'target', target, 'release', 'forged.exe'),
  resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'binaries', `forged-${target}.exe`),
])

const normalizedInstaller = resolve(releaseDir, `forge-v${version}-${platformLabel}-setup.exe`)
copyFileSync(installer, normalizedInstaller)

const portableRoot = resolve(releaseDir, `forge-v${version}-${platformLabel}-portable`)
mkdirSync(portableRoot, { recursive: true })
copyFileSync(appBinary, resolve(portableRoot, 'Forge.exe'))
copyFileSync(sidecar, resolve(portableRoot, 'forged.exe'))
writeFileSync(
  resolve(portableRoot, 'README.txt'),
  [
    'Forge portable package',
    '',
    'Run Forge.exe to launch the desktop app.',
    'User data is stored under ~/.forge (database, config, and logs).',
    'forged.exe must remain next to Forge.exe for local daemon startup.',
    '',
    'This package is unsigned in the current release phase, so Windows SmartScreen may warn on first launch.',
  ].join('\r\n'),
)

const portableArchive = resolve(releaseDir, `forge-v${version}-${platformLabel}-portable.zip`)
compressArchive(portableRoot, portableArchive)

console.log(`prepared release assets in ${releaseDir}`)
console.log(`installer: ${basename(normalizedInstaller)}`)
console.log(`portable: ${basename(portableArchive)}`)

function locateInstaller() {
  const bundleDirs = [
    resolve(repoRoot, 'target', 'release', 'bundle', 'nsis'),
    resolve(repoRoot, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'nsis'),
  ]

  for (const directory of bundleDirs) {
    if (!existsSync(directory)) {
      continue
    }

    const installers = readdirSync(directory)
      .map((name) => resolve(directory, name))
      .filter((path) => extname(path).toLowerCase() === '.exe')
      .filter((path) => !basename(path).toLowerCase().includes('updater'))

    if (installers.length > 0) {
      return installers[0]
    }
  }

  throw new Error('failed to locate NSIS installer output')
}

function locateFirstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`failed to locate required build output. Tried:\n${candidates.join('\n')}`)
}

function compressArchive(sourceDirectory, destinationArchive) {
  const sourceGlob = join(sourceDirectory, '*')
  const command = [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${escapePowerShellPath(sourceGlob)}' -DestinationPath '${escapePowerShellPath(destinationArchive)}' -Force`,
  ]
  const result = spawnSync('powershell', command, {
    cwd: desktopRoot,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`Compress-Archive failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function escapePowerShellPath(value) {
  return value.replace(/'/g, "''")
}

function inferWindowsTarget() {
  if (process.platform !== 'win32') {
    throw new Error('FORGE_SIDECAR_TARGET is required when packaging portable assets outside Windows')
  }

  if (process.arch === 'x64') {
    return 'x86_64-pc-windows-msvc'
  }

  if (process.arch === 'arm64') {
    return 'aarch64-pc-windows-msvc'
  }

  throw new Error(`unsupported Windows architecture: ${process.arch}`)
}
