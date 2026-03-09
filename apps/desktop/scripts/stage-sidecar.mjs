import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const target = process.env.FORGE_SIDECAR_TARGET ?? inferWindowsTarget()
const profile = process.env.FORGE_SIDECAR_PROFILE ?? 'release'
const cargoProfileDir = profile === 'debug' ? 'debug' : profile
const binaryName = process.platform === 'win32' ? 'forged.exe' : 'forged'
const stagedName = process.platform === 'win32' ? `forged-${target}.exe` : `forged-${target}`

run('cargo', [
  'build',
  '-p',
  'forged',
  '--target',
  target,
  ...(profile === 'release' ? ['--release'] : profile === 'debug' ? [] : ['--profile', profile]),
])

const source = resolve(repoRoot, 'target', target, cargoProfileDir, binaryName)
if (!existsSync(source)) {
  throw new Error(`expected sidecar binary at ${source}`)
}

const destinationDir = resolve(desktopRoot, 'src-tauri', 'binaries')
mkdirSync(destinationDir, { recursive: true })

const destination = join(destinationDir, stagedName)
copyFileSync(source, destination)
console.log(`staged Forge daemon sidecar at ${destination}`)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function inferWindowsTarget() {
  if (process.platform !== 'win32') {
    throw new Error('FORGE_SIDECAR_TARGET is required when building sidecars outside Windows')
  }

  if (process.arch === 'x64') {
    return 'x86_64-pc-windows-msvc'
  }

  if (process.arch === 'arm64') {
    return 'aarch64-pc-windows-msvc'
  }

  throw new Error(`unsupported Windows architecture: ${process.arch}`)
}
