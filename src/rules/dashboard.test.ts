import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeAgentCount, activeAgentNames, agentFeed, agentRequests, areaOf, allReviewFilesTicked, cardsInScope, fileReviewPaths, IDLE_MS, isLoopbackWebAddress, isWebAddress, FINISHED_SHOWN, FINISHED_WINDOW_MS, needsAttention, parseReviewLine, parseWebReviewMode, peopleFeed, progress, reviewPathsForMode, reviewPresentationForMode, reviewVerdictReadiness, tickCounts, waitsForReview, waitsOnChildren, workingBadge, type DashItem, type DashTree,
} from './dashboard.ts'

interface Fake extends DashItem { parent: Fake | null; mtime: number }

function vault() {
  const items: Fake[] = []
  const add = (title: string, parent: Fake | null, fields: Partial<Fake> = {}): Fake => {
    const item: Fake = {
      title, parent, parentLink: parent?.title ?? null, status: parent ? 'backlog' : undefined,
      area: false, board: false, owner: undefined, holder: undefined, effectiveArchived: false, mtime: 0, ...fields,
    }
    items.push(item)
    return item
  }
  const tree: DashTree<Fake> = {
    childrenOf: (item) => items.filter((other) => other.parent === item),
    ancestorsOf: (item) => {
      const chain: Fake[] = []
      for (let up = item.parent; up; up = up.parent) chain.unshift(up)
      return chain
    },
    mtimeOf: (item) => item.mtime,
  }
  return { items, add, tree }
}

test('a card belongs to its nearest area', () => {
  const { add, tree } = vault()
  const root = add('Home', null)
  const work = add('Work', root, { area: true, status: 'doing' })
  const site = add('Site', work, { area: true, status: 'doing' })
  const card = add('Fix header', site)
  assert.equal(areaOf(card, tree), site)
  assert.equal(areaOf(add('Loose', root), tree), null)
})

test('the scope holds live cards under the chosen root, not roots, areas or archived cards', () => {
  const { items, add, tree } = vault()
  const home = add('Home', null)
  const other = add('Other', null)
  const area = add('Work', home, { area: true, status: 'doing' })
  const card = add('Card', area)
  add('Gone', area, { effectiveArchived: true })
  const elsewhere = add('Elsewhere', other)
  assert.deepEqual(cardsInScope(items, home, tree), [card])
  assert.deepEqual(cardsInScope(items, null, tree), [card, elsewhere])
})

test('People lists each named person with their open cards and excludes them from Agents', () => {
  const { add, tree } = vault()
  const root = add('Home', null)
  const alice = add('Alice task', root, { status: 'options', holder: 'Alice' })
  add('Alice done', root, { status: 'done', holder: 'Alice' })
  const bob = add('Bob task', root, { status: 'doing', holder: 'bob' })
  const agent = add('Agent task', root, { status: 'doing', holder: 'Writer' })
  const people = peopleFeed([alice, bob, agent], ['Alice', 'Bob', 'Nobody'])
  assert.deepEqual(people, [
    { person: 'Alice', cards: [{ card: alice, status: 'options' }] },
    { person: 'Bob', cards: [{ card: bob, status: 'doing' }] },
  ])
  assert.deepEqual(agentFeed([alice, bob, agent], '', tree, 0, null, ['Alice', 'Bob']).working.map((row) => row.card), [agent])
  assert.equal(activeAgentCount([alice, bob, agent], ['Alice', 'Bob'], tree), 1)
})

test('a card waits on its children when it has open children and every one is in doing', () => {
  const { add, tree } = vault()
  const root = add('Home', null)
  const parent = add('Parent', root, { status: 'doing', holder: 'lead' })
  assert.equal(waitsOnChildren(parent, tree), false, 'a card with no children does its own work')
  const first = add('First', parent, { status: 'doing', holder: 'worker-1' })
  add('Gone', parent, { status: 'options', effectiveArchived: true })
  add('Closed', parent, { status: 'done' })
  assert.equal(waitsOnChildren(parent, tree), true, 'done and archived children are not open')
  const second = add('Second', parent, { status: 'options' })
  assert.equal(waitsOnChildren(parent, tree), false, 'a child in options is work the parent can still do')
  second.status = 'backlog'
  assert.equal(waitsOnChildren(parent, tree), false)
  second.status = 'doing'
  assert.equal(waitsOnChildren(parent, tree), true)
  first.status = 'done'
  second.status = 'done'
  assert.equal(waitsOnChildren(parent, tree), false, 'with every child done, the parent works again')
})

test('the active count skips a doing card whose open children are all in doing', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const parent = add('Parent', root, { status: 'doing', holder: 'lead' })
  add('First', parent, { status: 'doing', holder: 'worker-1' })
  const second = add('Second', parent, { status: 'doing', holder: 'worker-2' })
  assert.deepEqual([...activeAgentNames(items, [], tree)].sort(), ['worker-1', 'worker-2'])
  assert.equal(activeAgentCount(items, [], tree), 2, 'lead only waits on its children')

  second.status = 'options'
  assert.equal(activeAgentCount(items, [], tree), 2, 'lead has a child left to work, so it counts')

  second.status = 'doing'
  add('Other', root, { status: 'doing', holder: 'lead' })
  assert.equal(activeAgentCount(items, [], tree), 3, 'lead counts through a card it works')
})

test('the active count skips a doing card that waits for a review verdict', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const sent = add('Sent', root, { status: 'doing', holder: 'worker-1', owner: 'Ana' })
  add('Working', root, { status: 'doing', holder: 'worker-2' })
  assert.equal(activeAgentCount(items, [], tree), 2, 'with no review rule, both count')
  const awaits = (card: typeof sent) => card === sent
  assert.deepEqual([...activeAgentNames(items, [], tree, awaits)], ['worker-2'])
  assert.equal(activeAgentCount(items, [], tree, awaits), 1, 'worker-1 only waits for the verdict')
})

test('an agent that holds a card and its current subtask still counts once', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const parent = add('Parent', root, { status: 'doing', holder: 'claude' })
  add('Step', parent, { status: 'doing', holder: 'claude' })
  assert.equal(activeAgentCount(items, [], tree), 1)
})

test('a card waits for review only after a send, while it is yours and has no open child', () => {
  const { add, tree } = vault()
  const root = add('Home', null)
  const card = add('Check the quote', root, { status: 'doing', owner: 'Ana' })
  const sent = '## Notes\n\n- **Review:** Check the quote.\n'
  assert.equal(waitsForReview(card, 'ana', tree, sent), true)
  assert.equal(waitsForReview(card, 'Sam', tree, sent), false)
  assert.equal(waitsForReview(card, '', tree, sent), false)
  assert.equal(waitsForReview(card, 'Ana', tree, ''), false)
  card.status = 'backlog'
  assert.equal(waitsForReview(card, 'Ana', tree, sent), true, 'an open card waits in any column')
  card.status = 'done'
  assert.equal(waitsForReview(card, 'Ana', tree, sent), false, 'a done card is closed, even with no verdict note')
  card.status = 'doing'
  const step = add('Step', card, { status: 'doing' })
  assert.equal(waitsForReview(card, 'Ana', tree, sent), false)
  step.status = 'done'
  assert.equal(waitsForReview(card, 'Ana', tree, sent), true)
  assert.equal(waitsForReview(card, 'Ana', tree, `${sent}- Approved by Ana.\n`), false)
  assert.equal(waitsForReview(card, 'Ana', tree, `${sent}- Sent back by Ana.\n`), false)
  assert.equal(waitsForReview(card, 'Ana', tree, `${sent}- Sent back by Ana.\n- **Review:** Again.\n`), true)
})

test('the review line gives what to check and the files to open', () => {
  const text = '## Notes\n\n- **Review:** Check the totals: `Work/35b/schedule.xlsx`, `Work/35b/report.md`.\n'
  assert.deepEqual(parseReviewLine(text), {
    what: 'Check the totals.',
    paths: ['Work/35b/schedule.xlsx', 'Work/35b/report.md'],
    requested: null,
  })
  assert.equal(parseReviewLine('## Notes\n\n- nothing\n'), null)
})

test('the newest review line wins, after a wi note prefix', () => {
  const text = '- **Review:** Old: `a.pdf`\n- 2026-09-28 09:31, claude: **Review:** Check the rates: `Rates/rates.csv`\n'
  assert.deepEqual(parseReviewLine(text), { what: 'Check the rates', paths: ['Rates/rates.csv'], requested: '2026-09-28 09:31' })
})

test('a review line may list a web address', () => {
  const text = '- 2026-09-28 15:10, claude: **Review:** Preview: board layout: `http://127.0.0.1:61804/`\n'
  assert.deepEqual(parseReviewLine(text), { what: 'Preview: board layout', paths: ['http://127.0.0.1:61804/'], requested: '2026-09-28 15:10' })
})

test('isWebAddress tells a web address from a vault path', () => {
  assert.equal(isWebAddress('http://127.0.0.1:61804/'), true)
  assert.equal(isWebAddress('https://example.com/a.pdf'), true)
  assert.equal(isWebAddress('Work/35b/report.md'), false)
})

test('loopback web addresses are identified for phone display', () => {
  for (const address of [
    'http://localhost:61804/',
    'https://LOCALHOST/path',
    'http://127.0.0.1:61804/',
    'http://127.255.2.9/',
    'http://0.0.0.0:8080/',
    'http://[::1]:8080/',
  ]) assert.equal(isLoopbackWebAddress(address), true, address)

  for (const address of ['https://example.com/', 'http://126.0.0.1/', 'http://128.0.0.1/', 'not a URL']) {
    assert.equal(isLoopbackWebAddress(address), false, address)
  }
})

test('unknown web review modes use the Web viewer default', () => {
  assert.equal(parseWebReviewMode('webviewer'), 'webviewer')
  assert.equal(parseWebReviewMode('browser'), 'browser')
  assert.equal(parseWebReviewMode('off'), 'off')
  assert.equal(parseWebReviewMode('unexpected'), 'webviewer')
  assert.equal(parseWebReviewMode(undefined), 'webviewer')
})

test('Off removes web rows and falls back to the card when no file rows remain', () => {
  assert.deepEqual(reviewPathsForMode(['https://example.com', 'report.md'], 'card.md', 'off'), ['report.md'])
  assert.deepEqual(reviewPathsForMode(['https://example.com'], 'card.md', 'off'), ['card.md'])
  assert.deepEqual(reviewPathsForMode([], 'card.md', 'off'), ['card.md'])
  assert.deepEqual(reviewPathsForMode(['https://example.com'], 'card.md', 'webviewer'), ['https://example.com', 'card.md'])
})

test('only file rows count toward verdict readiness', () => {
  const mixed = ['https://example.com', 'report.md']
  assert.deepEqual(fileReviewPaths(mixed), ['report.md'])
  assert.equal(allReviewFilesTicked(mixed, { 'report.md': '2026-10-02 09:30' }), true)
  assert.equal(allReviewFilesTicked(mixed, {}), false)
  assert.equal(allReviewFilesTicked(['https://example.com'], {}), false)
})

test('a shared tick updates verdict readiness for every card that lists the file', () => {
  const first = { title: 'First' }
  const second = { title: 'Second' }
  const pathsByCard = new Map([[first, { paths: ['shared.md'], requested: null }], [second, { paths: ['shared.md', 'other.md'], requested: null }]])
  const ticks: Record<string, string> = { 'shared.md': '2026-10-02 09:30' }
  assert.deepEqual([...reviewVerdictReadiness(pathsByCard, ticks).values()], [true, false])
  ticks['other.md'] = '2026-10-02 09:30'
  assert.deepEqual([...reviewVerdictReadiness(pathsByCard, ticks).values()], [true, true])
  delete ticks['shared.md']
  assert.deepEqual([...reviewVerdictReadiness(pathsByCard, ticks).values()], [false, false])
})

test('a tick from an earlier review round leaves the new request unticked', () => {
  assert.equal(tickCounts('2026-10-01 18:00', '2026-10-02 09:04'), false)
  assert.equal(tickCounts('2026-10-02 09:04', '2026-10-02 09:04'), true)
  assert.equal(tickCounts('2026-10-02 09:30', '2026-10-02'), true)
  assert.equal(tickCounts(undefined, null), false)
  assert.equal(allReviewFilesTicked(['card.md'], { 'card.md': '2026-10-01 18:00' }, '2026-10-02 09:04'), false)
  const readiness = reviewVerdictReadiness(new Map([
    ['old', { paths: ['shared.md'], requested: '2026-10-02 08:00' }],
    ['new', { paths: ['shared.md'], requested: '2026-10-02 10:00' }],
  ]), { 'shared.md': '2026-10-02 09:00' })
  assert.deepEqual([...readiness.values()], [true, false])
})

test('a review line keeps its date alone when it has no time', () => {
  assert.equal(parseReviewLine('- 2026-09-28: **Review:** Check `a.md`.\n')?.requested, '2026-09-28')
})

test('a card with no paths gets its own row, and that row carries the verdict tick', () => {
  for (const mode of ['webviewer', 'browser', 'off'] as const) {
    const presentation = reviewPresentationForMode([], 'card.md', mode)
    assert.deepEqual(presentation.paths, ['card.md'], mode)
    assert.deepEqual(presentation.verdictPaths, ['card.md'], mode)
    assert.equal(allReviewFilesTicked(presentation.verdictPaths, {}), false, mode)
    assert.equal(allReviewFilesTicked(presentation.verdictPaths, { 'card.md': '2026-10-02 09:30' }), true, mode)
  }
})

test('a card with only web paths adds its own row after the web rows, and that row carries the verdict tick', () => {
  const web = ['https://example.com', 'http://localhost:3000']
  assert.deepEqual(reviewPresentationForMode(web, 'card.md', 'webviewer').paths, [...web, 'card.md'])
  assert.deepEqual(reviewPresentationForMode(web, 'card.md', 'browser').paths, [...web, 'card.md'])
  assert.deepEqual(reviewPresentationForMode(web, 'card.md', 'off').paths, ['card.md'])
  for (const mode of ['webviewer', 'browser', 'off'] as const) {
    const presentation = reviewPresentationForMode(web, 'card.md', mode)
    assert.deepEqual(presentation.verdictPaths, ['card.md'], mode)
    const pathsByCard = new Map([['card', { paths: presentation.verdictPaths, requested: null }]])
    assert.equal(reviewVerdictReadiness(pathsByCard, {}).get('card'), false, mode)
    assert.equal(reviewVerdictReadiness(pathsByCard, { 'card.md': '2026-10-02 09:30' }).get('card'), true, mode)
  }
})

test('a card with file paths gets no card row, and only its files count toward the verdict', () => {
  const mixed = ['https://example.com', 'report.md']
  assert.deepEqual(reviewPresentationForMode(mixed, 'card.md', 'webviewer'), { paths: mixed, verdictPaths: ['report.md'] })
  assert.deepEqual(reviewPresentationForMode(mixed, 'card.md', 'off'), { paths: ['report.md'], verdictPaths: ['report.md'] })
})

test('progress counts leaf cards per area, with no area last', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const area = add('Work', root, { area: true, status: 'doing' })
  const board = add('Board', area, { board: true, status: 'doing' })
  add('A', board, { status: 'done' })
  add('B', board, { status: 'doing' })
  add('Loose', root, { status: 'done' })
  const rows = progress(cardsInScope(items, null, tree), tree)
  assert.deepEqual(rows.map(({ name, done, doing, total }) => ({ name, done, doing, total })), [
    { name: 'Work', done: 1, doing: 1, total: 2 },
    { name: 'No area', done: 1, doing: 0, total: 1 },
  ])
})

test('progress leaves out areas in backlog or done, and the cards in them', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const active = add('Active', root, { area: true, status: 'doing' })
  add('A', active, { status: 'done' })
  const parked = add('Parked', root, { area: true, status: 'backlog' })
  add('B', parked, { status: 'doing' })
  const closed = add('Closed', root, { area: true, status: 'done' })
  add('C', closed, { status: 'done' })
  add('Loose', root, { status: 'doing' })
  const rows = progress(cardsInScope(items, null, tree), tree)
  assert.deepEqual(rows.map(({ name, done, total }) => `${name} ${done}/${total}`), ['Active 1/1', 'No area 0/1'])
})

test('an agent is working, idle, or finished', () => {
  const { items, add, tree } = vault()
  const now = 10 * IDLE_MS
  const root = add('Home', null)
  const area = add('Work', root, { area: true, status: 'doing' })
  const working = add('Working', area, { status: 'doing', holder: 'claude', mtime: now - 60_000 })
  const idle = add('Idle', area, { status: 'doing', holder: 'codex', mtime: now - 2 * IDLE_MS })
  const fresh = add('Fresh step', idle, { status: 'doing', mtime: now - 1000 })
  const handed = add('Handed over', area, { status: 'doing', holder: 'claude', owner: 'Ana', mtime: now })
  const stepsDone = add('Steps done', area, { status: 'doing', holder: 'claude', mtime: now - 5000 })
  add('Only step', stepsDone, { status: 'done', mtime: now - 5000 })
  const closed = add('Closed', area, { status: 'done', holder: 'claude', mtime: now - 3 * IDLE_MS })

  let feed = agentFeed(cardsInScope(items, null, tree), 'Ana', tree, now)
  // The idle card's child changed a second ago, so its claim is live.
  assert.deepEqual(feed.working.map((row) => row.card), [idle, working])
  assert.equal(feed.working[0]!.active, fresh.mtime)
  assert.deepEqual(feed.finished.map((row) => row.card), [handed, stepsDone, closed])
  assert.deepEqual(feed.idle, [])

  fresh.mtime = now - 2 * IDLE_MS
  feed = agentFeed(cardsInScope(items, null, tree), 'Ana', tree, now)
  assert.deepEqual(feed.working.map((row) => row.card), [working])
  assert.deepEqual(feed.idle.map((row) => row.card), [idle])
})

test('a request for any agent is in no agent row: no agent works it yet', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  add('Asked', root, { status: 'doing', holder: 'agent', mtime: 0 })
  add('Asked later', root, { status: 'done', holder: 'agent', mtime: 0 })
  assert.deepEqual(agentFeed(cardsInScope(items, null, tree), 'Ana', tree, 1000), { working: [], idle: [], finished: [] })
  assert.deepEqual(agentRequests(cardsInScope(items, null, tree)).map((card) => card.title), ['Asked'])
})

test('the feed is one list over every area, newest first, with the area one level under the focus', () => {
  const { items, add, tree } = vault()
  const now = 10 * IDLE_MS
  const root = add('Home', null)
  const dev = add('Dev', root, { area: true, status: 'doing' })
  const board = add('Board', dev, { area: true, status: 'doing' })
  const gym = add('Gym', root, { area: true, status: 'doing' })
  const a = add('A', board, { status: 'doing', holder: 'claude', mtime: now - 3000 })
  const b = add('B', gym, { status: 'doing', holder: 'codex', mtime: now - 1000 })
  const c = add('C', dev, { status: 'doing', holder: 'claude', mtime: now - 2000 })
  add('Loose', root, { status: 'doing', holder: 'claude', mtime: now - 4000 })
  const cards = cardsInScope(items, null, tree)

  const top = agentFeed(cards, 'Ana', tree, now)
  assert.deepEqual(top.working.map((row) => [row.card.title, row.area?.title ?? null]),
    [['B', 'Gym'], ['C', 'Dev'], ['A', 'Dev'], ['Loose', null]])

  // In Dev, a card directly in Dev has no chip, and a card in Board names Board.
  const inDev = agentFeed(cards, 'Ana', tree, now, dev)
  assert.deepEqual(inDev.working.map((row) => [row.card, row.area]), [[c, null], [a, board]])
  assert.deepEqual(agentFeed(cards, 'Ana', tree, now, gym).working.map((row) => row.card), [b])
})

test('the working badge counts from the feed, per area row, and ignores idle and finished claims', () => {
  const { items, add, tree } = vault()
  const now = 10 * IDLE_MS
  const root = add('Home', null)
  const dev = add('Dev', root, { area: true, status: 'doing' })
  const board = add('Board', dev, { area: true, status: 'doing' })
  const gym = add('Gym', root, { area: true, status: 'doing' })
  add('A', board, { status: 'doing', holder: 'claude', mtime: now })
  add('B', dev, { status: 'doing', holder: 'claude', mtime: now })
  add('Quiet', dev, { status: 'doing', holder: 'codex', mtime: now - 2 * IDLE_MS })
  add('Done', gym, { status: 'done', holder: 'claude', mtime: now })
  const cards = cardsInScope(items, null, tree)

  const top = agentFeed(cards, 'Ana', tree, now)
  const badges = progress(cards, tree).map((row) => `${row.name} ${workingBadge(top, row.area)}`)
  assert.deepEqual(badges, ['Dev 2', 'Gym 0'])
  // Every working row is counted on exactly one area row.
  assert.equal(progress(cards, tree).reduce((sum, row) => sum + workingBadge(top, row.area), 0), top.working.length)

  const inDev = agentFeed(cards, 'Ana', tree, now, dev)
  assert.deepEqual(progress(cards, tree, dev).map((row) => `${row.name} ${workingBadge(inDev, row.area)}`),
    ['Board 1', 'Directly in Dev 1'])
})

test('a claim that only waits on its children is marked waiting, and the working badge skips it', () => {
  const { items, add, tree } = vault()
  const now = 10 * IDLE_MS
  const root = add('Home', null)
  const dev = add('Dev', root, { area: true, status: 'doing' })
  const lead = add('Lead', dev, { status: 'doing', holder: 'lead', mtime: now })
  add('Step one', lead, { status: 'doing', holder: 'worker-1', mtime: now })
  const two = add('Step two', lead, { status: 'doing', holder: 'worker-2', mtime: now })
  const cards = cardsInScope(items, null, tree)

  let feed = agentFeed(cards, 'Ana', tree, now)
  assert.deepEqual(feed.working.map((row) => [row.card.title, row.waiting]),
    [['Lead', true], ['Step one', false], ['Step two', false]])
  assert.equal(workingBadge(feed, dev), 2, 'the badge counts the agents that work, as the active count does')
  assert.equal(workingBadge(feed, dev), activeAgentCount(items, [], tree))

  two.status = 'options'
  feed = agentFeed(cards, 'Ana', tree, now)
  assert.equal(feed.working.find((row) => row.card === lead)!.waiting, false)
  assert.equal(workingBadge(feed, dev), 2)
})

test('the finished fold holds claims finished in the last 24 hours, at most ten, newest first', () => {
  const { items, add, tree } = vault()
  const now = 100 * FINISHED_WINDOW_MS
  const root = add('Home', null)
  const area = add('Work', root, { area: true, status: 'doing' })
  for (let i = 0; i < 12; i++) add(`Done ${i}`, area, { status: 'done', holder: 'claude', mtime: now - (i + 1) * 60_000 })
  add('Old', area, { status: 'done', holder: 'claude', mtime: now - FINISHED_WINDOW_MS - 1 })
  add('Dropped back', area, { status: 'options', holder: 'claude', mtime: now })

  const feed = agentFeed(cardsInScope(items, null, tree), 'Ana', tree, now)
  assert.equal(FINISHED_SHOWN, 10)
  assert.deepEqual(feed.finished.map((row) => row.card.title), Array.from({ length: 10 }, (_, i) => `Done ${i}`))
})

test('an empty area has an empty feed', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const quiet = add('Quiet', root, { area: true, status: 'doing' })
  add('Card', quiet, { status: 'backlog' })
  add('Busy', add('Busy area', root, { area: true, status: 'doing' }), { status: 'doing', holder: 'claude' })
  assert.deepEqual(agentFeed(cardsInScope(items, null, tree), 'Ana', tree, 0, quiet), { working: [], idle: [], finished: [] })
})

test('a focus narrows to one area and groups by the next area down', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const dev = add('Dev', root, { area: true, status: 'doing' })
  const board = add('Board', dev, { area: true, status: 'doing' })
  const theme = add('Theme', dev, { area: true, status: 'doing' })
  add('A', board, { status: 'done' })
  add('B', theme, { status: 'doing', holder: 'claude' })
  add('C', dev, { status: 'backlog' })
  add('Gym card', add('Gym', root, { area: true, status: 'doing' }))
  const cards = cardsInScope(items, null, tree)
  const names = (focus: Fake | null) => progress(cards, tree, focus).map((row) => `${row.name} ${row.done}/${row.total}`)

  assert.deepEqual(names(null), ['Dev 1/2', 'Gym 0/0'])
  assert.deepEqual(names(dev), ['Board 1/1', 'Theme 0/1', 'Directly in Dev 0/0'])
  assert.deepEqual(names(board), ['Directly in Board 1/1'])
  assert.deepEqual(agentFeed(cards, 'Ana', tree, 0, dev).working.map((row) => row.area?.title), ['Theme'])
  assert.deepEqual(agentFeed(cards, 'Ana', tree, 0, board).working, [])
})

test('progress leaves backlog cards out of the total and counts them apart', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const dev = add('Dev', root, { area: true, status: 'doing' })
  add('Done', dev, { status: 'done' })
  add('Doing', dev, { status: 'doing' })
  add('Option', dev, { status: 'options' })
  add('Later', dev, { status: 'backlog' })
  add('Someday', add('Ideas', root, { area: true, status: 'doing' }), { status: 'backlog' })
  const rows = progress(cardsInScope(items, null, tree), tree)
  assert.deepEqual(rows.map((row) => `${row.name} ${row.done}/${row.total} backlog ${row.backlog}`),
    ['Dev 1/3 backlog 1', 'Ideas 0/0 backlog 1'])
})

test('the dashboard flags a started card that still waits, and a wait on an archived card', () => {
  const { add } = vault()
  const root = add('Home', null)
  const spec = add('Spec', root, { status: 'doing' })
  const dropped = add('Dropped', root, { status: 'options', effectiveArchived: true })
  const build = add('Build', root, { status: 'doing' })
  const later = add('Later', root, { status: 'backlog' })
  const done = add('Done', root, { status: 'done' })
  const deps = new Map<Fake, Fake[]>([[build, [spec]], [later, [dropped, spec]], [done, [spec]]])
  const found = needsAttention([spec, build, later, done], (card) => deps.get(card) ?? [])
  assert.deepEqual(found.map((a) => `${a.card.title} ${a.reason} ${a.cards.map((c) => c.title).join('+')}`), [
    'Build started Spec',
    'Later archived Dropped',
  ])
})

test('an idle claim needs attention as an agent that went quiet', () => {
  const { items, add, tree } = vault()
  const now = 10 * IDLE_MS
  const root = add('Home', null)
  const quiet = add('Quiet', root, { status: 'doing', holder: 'codex', mtime: now - 2 * IDLE_MS })
  add('Live', root, { status: 'doing', holder: 'claude', mtime: now })
  const cards = cardsInScope(items, null, tree)
  const feed = agentFeed(cards, 'Ana', tree, now)
  const found = needsAttention(cards, () => [], feed.idle.map((row) => row.card))
  assert.deepEqual(found, [{ card: quiet, reason: 'quiet', cards: [] }])
  assert.equal(feed.working.some((row) => row.card === quiet), false)
  assert.equal(feed.finished.some((row) => row.card === quiet), false)
})

test('an agent becomes quiet at the one-hour idle boundary', () => {
  const { items, add, tree } = vault()
  const root = add('Home', null)
  const card = add('Claimed', root, { status: 'doing', holder: 'codex', mtime: 0 })
  const cards = cardsInScope(items, null, tree)
  const before = agentFeed(cards, '', tree, IDLE_MS - 1)
  assert.deepEqual(needsAttention(cards, () => [], before.idle.map((row) => row.card)), [])
  const atBoundary = agentFeed(cards, '', tree, IDLE_MS)
  assert.deepEqual(needsAttention(cards, () => [], atBoundary.idle.map((row) => row.card)).map((row) => [row.card, row.reason]), [[card, 'quiet']])
})
