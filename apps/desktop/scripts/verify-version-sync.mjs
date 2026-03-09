import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(__dirname, '..')
const repoRoot = resolve(desktopRoot, '..', '..')

const cargoToml = readFileSync(resolve(repoRoot, 'Cargo.toml'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(resolve(desktopRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'))

const cargoVersion = cargoToml.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/)?.[1]
if (!cargoVersion) {
  throw new Error('failed to read workspace version from Cargo.toml')
}

const mismatches = [
  ['apps/desktop/package.json', packageJson.version],
  ['apps/desktop/src-tauri/tauri.conf.json', tauriConfig.version],
].filter(([, value]) => value !== cargoVersion)

if (mismatches.length > 0) {
  const lines = mismatches.map(([path, value]) => `- ${path}: ${value} (expected ${cargoVersion})`)
  throw new Error(`Forge release versions are out of sync:\n${lines.join('\n')}`)
}

console.log(`Forge versions are in sync at ${cargoVersion}`)
