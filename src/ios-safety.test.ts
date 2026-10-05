/**
 * The dashboard must load on iOS, asserted rather than trusted.
 *
 * A single stray import makes the plugin fail to load on iOS, silently. The build fails on a
 * forbidden import. This test says the same thing about the source tree and the bundle, so the
 * rule holds even for someone who never runs a build. The dashboard reads card files through
 * Obsidian and never runs `wi` for the same reason: a phone cannot run a CLI.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isForbidden, FORBIDDEN } from '../build/forbidden-imports.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => join(e.parentPath, e.name))
}

/** Every `import ... from 'x'`, `import 'x'`, and `require('x')` specifier in a file. */
function specifiers(text: string): string[] {
  const found: string[] = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!)
  }
  return found
}

test('isForbidden covers every node builtin form', () => {
  assert.ok(isForbidden('node:fs'))
  assert.ok(isForbidden('node:path'))
  assert.ok(isForbidden('fs'))
  assert.ok(isForbidden('child_process'))
  assert.ok(isForbidden('electron'))
  for (const name of FORBIDDEN) assert.ok(isForbidden(name), name)
})

test('isForbidden lets the real imports through', () => {
  for (const ok of ['obsidian', './actions.ts', './rules/schema.ts', '../cards.ts']) {
    assert.equal(isForbidden(ok), false, ok)
  }
})

test('nothing the plugin bundles imports anything iOS cannot provide', () => {
  const offenders: string[] = []
  for (const file of sourceFiles(join(root, 'src'))) {
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (isForbidden(specifier)) offenders.push(`${file.slice(root.length + 1)} → ${specifier}`)
    }
  }
  assert.deepEqual(offenders, [], 'these imports make the plugin fail to load on iOS, silently')
})

test('the copied rules import nothing but each other, so a refresh from Recursive Board stays a plain copy', () => {
  const rules = sourceFiles(join(root, 'src/rules'))
  assert.ok(rules.length >= 5)
  for (const file of rules) {
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      assert.ok(specifier.startsWith('./'), `src/rules must import nothing but its own siblings, found "${specifier}" in ${file}`)
    }
  }
})

test('nothing in the dashboard runs the wi CLI', () => {
  for (const file of sourceFiles(join(root, 'src'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /child_process|\bspawn\(|\bexecFile/, file)
  }
})

test('the manifest declares the plugin mobile-capable', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.isDesktopOnly, false, 'the plugin must run on iOS')
  assert.equal(manifest.id, 'recursive-board-dashboard')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.ok(manifest.minAppVersion, 'Vault.process needs a floor on the app version')
})

test('a built bundle carries no node require', () => {
  const bundle = join(root, 'dist/main.js')
  if (!existsSync(bundle)) return // Nothing built yet; the build itself enforces this.
  const text = readFileSync(bundle, 'utf8')
  for (const name of FORBIDDEN) {
    assert.doesNotMatch(text, new RegExp(`require\\(["']${name}["']\\)`), name)
    assert.doesNotMatch(text, new RegExp(`require\\(["']node:${name}["']\\)`), name)
  }
})
