/**
 * Loads the built bundle with a stub `obsidian`, so a bundle that cannot load is caught here
 * rather than on the phone, where there is no console.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

class FakePlugin {}
class FakePluginSettingTab {}
const obsidian = {
  Plugin: FakePlugin,
  PluginSettingTab: FakePluginSettingTab,
  MarkdownView: class {},
  Notice: class {},
  Platform: { isMobile: false },
  setIcon: () => {},
  TFile: class {},
  Menu: class {},
  FuzzySuggestModal: class {},
  SuggestModal: class {},
  Modal: class {},
  Component: class {},
  ItemView: class {},
  MarkdownRenderer: class {},
  AbstractInputSuggest: class {},
  TFolder: class {},
  Setting: class {},
}

function loadBundle(): { default?: unknown } {
  execFileSync('node', [join(root, 'build', 'plugin.mjs')], { cwd: root, stdio: 'pipe' })
  const code = readFileSync(join(root, 'dist', 'main.js'), 'utf8')
  const module = { exports: {} as { default?: unknown } }
  const require = (name: string) => {
    if (name === 'obsidian') return obsidian
    throw new Error(`the bundle required "${name}", which iOS cannot provide`)
  }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}

test('the bundle loads with obsidian as its only dependency', () => {
  const exports = loadBundle()
  assert.equal(typeof exports.default, 'function', 'the plugin class is the default export')
})

test('the plugin build places all release assets directly in dist', () => {
  loadBundle()
  for (const file of ['main.js', 'manifest.json', 'styles.css']) {
    assert.ok(existsSync(join(root, 'dist', file)), `${file} must be in dist/`)
  }
})

test('the plugin class extends obsidian Plugin and implements onload', () => {
  const PluginClass = loadBundle().default as new () => unknown
  assert.ok(Object.getPrototypeOf(PluginClass) === FakePlugin)
  const proto = PluginClass.prototype as Record<string, unknown>
  assert.equal(typeof proto['onload'], 'function')
})
