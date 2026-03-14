import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const repoRoot = resolve(desktopRoot, '..', '..')
const target = process.env.FORGE_SIDECAR_TARGET ?? inferWindowsTarget()
const profile = process.env.FORGE_SIDECAR_PROFILE ?? 'release'
const cargoProfileDir = profile === 'debug' ? 'debug' : profile
const daemonBinaryName = process.platform === 'win32' ? 'forged.exe' : 'forged'
const cliBinaryName = process.platform === 'win32' ? 'forge.exe' : 'forge'
const stagedSidecarName = process.platform === 'win32' ? `forged-${target}.exe` : `forged-${target}`
const cliTemplateDir = resolve(desktopRoot, 'cli-resources')
const stagedCliDir = resolve(desktopRoot, 'src-tauri', 'forge-cli')

run('cargo', [
  'build',
  '-p',
  'forged',
  '--target',
  target,
  ...(profile === 'release' ? ['--release'] : profile === 'debug' ? [] : ['--profile', profile]),
])
run('cargo', [
  'build',
  '-p',
  'forge',
  '--target',
  target,
  ...(profile === 'release' ? ['--release'] : profile === 'debug' ? [] : ['--profile', profile]),
])

const sidecarSource = resolve(repoRoot, 'target', target, cargoProfileDir, daemonBinaryName)
const cliSource = resolve(repoRoot, 'target', target, cargoProfileDir, cliBinaryName)

const destinationDir = resolve(desktopRoot, 'src-tauri', 'binaries')
mkdirSync(destinationDir, { recursive: true })
mkdirSync(stagedCliDir, { recursive: true })

const sidecarDestination = join(destinationDir, stagedSidecarName)
copyRequiredFile(sidecarSource, sidecarDestination, 'Forge daemon sidecar')
copyRequiredFile(cliSource, join(stagedCliDir, cliBinaryName), 'Forge CLI binary')
copyRequiredFile(sidecarSource, join(stagedCliDir, daemonBinaryName), 'Forge daemon CLI companion')

for (const templateName of readdirSync(cliTemplateDir)) {
  copyFileSync(resolve(cliTemplateDir, templateName), resolve(stagedCliDir, templateName))
}

console.log(`staged Forge daemon sidecar at ${sidecarDestination}`)
console.log(`staged Forge CLI resources at ${stagedCliDir}`)

function copyRequiredFile(source, destination, label) {
  if (!existsSync(source)) {
    throw new Error(`expected ${label} at ${source}`)
  }

  copyFileSync(source, destination)
}

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
