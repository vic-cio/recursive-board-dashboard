import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { App } from 'obsidian'

import { CardIndex, readBoardConfig } from './cards.ts'

interface FakeFile { path: string; basename: string; parent: { path: string }; stat: { mtime: number } }

/** Just enough of Obsidian's App for the index: files, their frontmatter, and the link resolver. */
function fakeApp(notes: Record<string, Record<string, unknown>>, files: Record<string, string> = {}) {
  const all: FakeFile[] = Object.keys(notes).map((path) => ({
    path,
    basename: path.slice(path.lastIndexOf('/') + 1, -3),
    parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' },
    stat: { mtime: 0 },
  }))
  const app = {
    vault: {
      configDir: '.obsidian',
      getMarkdownFiles: () => all,
      adapter: {
        exists: async (path: string) => path in files,
        read: async (path: string) => files[path] ?? '',
      },
    },
    metadataCache: {
      getFileCache: (file: FakeFile) => ({ frontmatter: notes[file.path] }),
      getFirstLinkpathDest: (link: string) => all.find((file) => file.basename === link) ?? null,
    },
  }
  return app as unknown as App
}

const card = (fields: Record<string, unknown>) => ({ type: 'work-item', ...fields })

test('the index reads work items in the card folder only, and resolves parents and dependencies', () => {
  const index = new CardIndex(fakeApp({
    'Boards/Main.md': card({ id: 'wi-0001', title: 'Main' }),
    'Boards/Build.md': card({ id: 'wi-0002', title: 'Build', status: 'doing', parent: '[[Main]]', holder: 'codex', owner: '[[Ana]]', depends_on: ['[[Price]]'] }),
    'Boards/Price.md': card({ id: 'wi-0003', status: 'options', parent: '[[Main]]', agent: 'pi' }),
    'Boards/Plain.md': { type: 'note' },
    'Elsewhere/Stray.md': card({ id: 'wi-0009', status: 'doing', parent: '[[Main]]' }),
  }))
  index.rebuild()
  const titles = index.all().map((item) => item.title).sort()
  assert.deepEqual(titles, ['Build', 'Main', 'Price'])
  const main = index.all().find((item) => item.title === 'Main')!
  const build = index.all().find((item) => item.title === 'Build')!
  assert.equal(main.parentLink, null)
  assert.equal(build.parentLink, 'Main')
  assert.equal(build.owner, 'Ana')
  assert.equal(build.holder, 'codex')
  assert.equal(index.all().find((item) => item.title === 'Price')!.holder, 'pi', 'an old card\'s agent is its holder')
  assert.deepEqual(build.dependsOn.map((file) => file.path), ['Boards/Price.md'])
  assert.deepEqual(index.childrenOf(main.file).map((item) => item.title).sort(), ['Build', 'Price'])
  assert.deepEqual(index.ancestorsOf(build.file).map((item) => item.title), ['Main'])
})

test('an archived parent hides its children, and a parent loop never hangs', () => {
  const index = new CardIndex(fakeApp({
    'Boards/Main.md': card({ title: 'Main' }),
    'Boards/Old.md': card({ title: 'Old', status: 'doing', parent: '[[Main]]', archived: true }),
    'Boards/Step.md': card({ title: 'Step', status: 'options', parent: '[[Old]]' }),
    'Boards/A.md': card({ title: 'A', status: 'options', parent: '[[B]]' }),
    'Boards/B.md': card({ title: 'B', status: 'options', parent: '[[A]]' }),
  }))
  index.rebuild()
  const step = index.all().find((item) => item.title === 'Step')!
  assert.equal(step.effectiveArchived, true)
  assert.equal(index.ancestorsOf(index.all().find((item) => item.title === 'A')!.file).length, 1)
})

test('the board settings come from the Recursive Board plugin data, with defaults when it has none', async () => {
  assert.equal((await readBoardConfig(fakeApp({}))).workItemFolder, 'Boards')
  const data = JSON.stringify({ board: { workItemFolder: 'Cards', maxAgents: 3, defaultRoot: 'Main' }, people: {} })
  const config = await readBoardConfig(fakeApp({}, { '.obsidian/plugins/recursive-board/data.json': data }))
  assert.equal(config.workItemFolder, 'Cards')
  assert.equal(config.maxAgents, 3)
  assert.equal(config.defaultRoot, 'Main')

  const index = new CardIndex(fakeApp({ 'Cards/Main.md': card({ title: 'Main' }), 'Boards/Other.md': card({ title: 'Other' }) }))
  index.rebuild(config)
  assert.deepEqual(index.all().map((item) => item.title), ['Main'])
})
