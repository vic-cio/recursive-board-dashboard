/**
 * Puts a built plugin into a vault.
 *
 * The default copies, because a sync client does not carry a symlink to other devices: a synced
 * vault would get nothing on the phone. `--link` is for a local dev vault, where `npm run dev`
 * then updates the vault on every save. No sync provider can be detected from a path, so `--link`
 * warns instead of refusing.
 *
 * Usage:
 *   node build/install.mjs --vault <path>          copy the three files
 *   node build/install.mjs --vault <path> --link   symlink instead, for a local dev vault
 */
import { copyFile, mkdir, readFile, rm, symlink, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
const built = join(root, 'dist')

const FILES = ['main.js', 'manifest.json', 'styles.css']

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : (args[i + 1] ?? true)
}

const vaultArg = flag('--vault')
const link = args.includes('--link')

if (typeof vaultArg !== 'string') {
  console.error('usage: node build/install.mjs --vault <path> [--link]')
  process.exit(2)
}

const vault = resolve(vaultArg)
if (!existsSync(join(vault, '.obsidian'))) {
  console.error(`${vault} is not an Obsidian vault: it has no .obsidian folder.`)
  process.exit(2)
}
for (const file of FILES) {
  if (existsSync(join(built, file))) continue
  console.error(`dist/${file} is missing. Run npm run build first.`)
  process.exit(2)
}

const target = join(vault, '.obsidian', 'plugins', manifest.id)
if (link) {
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  if (existsSync(target) || (await lstat(target).catch(() => null))) {
    await rm(target, { recursive: true, force: true })
  }
  await symlink(built, target, 'dir')
  console.log(`linked ${target} -> dist/`)
  console.log('run `npm run dev` and the vault follows every save')
  console.log('a sync client does not carry a symlink: install without --link into a synced vault')
} else {
  await mkdir(target, { recursive: true })
  for (const file of FILES) await copyFile(join(built, file), join(target, file))
  console.log(`copied ${FILES.join(', ')} into ${target}`)
}
console.log('enable it in Obsidian: Settings, Community plugins, Recursive Board')
