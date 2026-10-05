import { isAnyAgent } from './holder.ts'
import type { Status } from './schema.ts'
import { awaitsReviewVerdict } from './review.ts'

/**
 * The dashboard's rules, apart from Obsidian so they can be tested. This file is the dashboard's
 * own: Recursive Board no longer has it. The agent count follows the same rule as `wi agents`.
 *
 * Areas nest, so the dashboard shows one level of them at a time. With no focus, a card groups
 * under its top area. With a focused area, the dashboard shows only the cards inside it, grouped
 * under the next area down. A card waits when its owner is you, its newest review request follows
 * its last verdict, and it is open: not done, and with no open child. Any other column may wait.
 * An agent's claim is idle when nothing in the card or
 * its children changed for an hour: its session most likely ended without a release.
 */

/** The fields of a work item that the rules read. */
export interface DashItem {
  title: string
  status: Status | undefined
  area: boolean
  board: boolean
  /** The owner's name: a link's target, or plain text. */
  owner: string | undefined
  /** The person or agent who does the work. */
  holder: string | undefined
  /** Own flag or an ancestor's flag. */
  effectiveArchived: boolean
  /** The raw wikilink target, or null when this item is a root. */
  parentLink: string | null
}

export interface DashTree<T extends DashItem> {
  childrenOf(item: T): T[]
  /** Root first, not including the item. */
  ancestorsOf(item: T): T[]
  /** Last modification time in milliseconds. */
  mtimeOf(item: T): number
}

export const IDLE_MS = 60 * 60 * 1000
/** The finished fold shows claims finished in this window, at most `FINISHED_SHOWN` of them. */
export const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000
export const FINISHED_SHOWN = 10

export function rootOf<T extends DashItem>(item: T, tree: DashTree<T>): T {
  return tree.ancestorsOf(item)[0] ?? item
}

/** The areas above the item, top first. */
export function areaPath<T extends DashItem>(item: T, tree: DashTree<T>): T[] {
  return tree.ancestorsOf(item).filter((up) => up.area)
}

/** True when the item sits inside the focused area, or when nothing is focused. */
export function inFocus<T extends DashItem>(item: T, focus: T | null, tree: DashTree<T>): boolean {
  return focus === null || areaPath(item, tree).includes(focus)
}

/** The area one level below the focus that holds the item, or null when the item sits directly in the focus. */
export function groupUnder<T extends DashItem>(item: T, focus: T | null, tree: DashTree<T>): T | null {
  const path = areaPath(item, tree)
  return path[focus === null ? 0 : path.indexOf(focus) + 1] ?? null
}

/** The nearest area above the item, or null when it sits in no area. */
export function areaOf<T extends DashItem>(item: T, tree: DashTree<T>): T | null {
  return tree.ancestorsOf(item).reverse().find((up) => up.area) ?? null
}

/** Live cards under the root, or under every root when root is null. Areas are projects, not cards. */
export function cardsInScope<T extends DashItem>(items: T[], root: T | null, tree: DashTree<T>): T[] {
  return items.filter((item) =>
    item.parentLink !== null && item.status !== undefined && !item.area && !item.effectiveArchived &&
    (root === null || rootOf(item, tree) === root))
}

export function sameName(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase()
}

function hasOpenChild<T extends DashItem>(item: T, tree: DashTree<T>): boolean {
  return tree.childrenOf(item).some((child) => child.status !== 'done' && !child.effectiveArchived)
}

export function waitsForReview<T extends DashItem>(item: T, you: string, tree: DashTree<T>, text: string): boolean {
  // A card closed without a verdict note, as cards were before Send for review, waits no longer.
  return item.status !== 'done' && sameName(item.owner, you) && awaitsReviewVerdict(text) && !hasOpenChild(item, tree)
}

export interface ReviewLine {
  /** What to check, with the file paths taken out. */
  what: string
  /** Vault-relative paths written in backticks, each with an extension, and web addresses. */
  paths: string[]
  /** When the request was written, as the note's `YYYY-MM-DD HH:MM`, or its date alone. Null with neither. */
  requested: string | null
}

/** An http or https address, not a vault path. */
export function isWebAddress(path: string): boolean {
  return /^https?:\/\/\S+$/.test(path)
}

export type WebReviewMode = 'webviewer' | 'browser' | 'off'

/** Parse the saved setting. Old or unknown values use the default Web viewer mode. */
export function parseWebReviewMode(value: unknown): WebReviewMode {
  return value === 'browser' || value === 'off' || value === 'webviewer' ? value : 'webviewer'
}

/**
 * Hide web rows when disabled. A card with no file rows also gets its own row, after any web
 * rows, so the reviewer has a row to tick.
 */
export function reviewPathsForMode(paths: string[], fallbackPath: string, mode: WebReviewMode): string[] {
  const visible = mode === 'off' ? fileReviewPaths(paths) : paths
  return fileReviewPaths(paths).length > 0 ? visible : [...visible, fallbackPath]
}

/** The files count toward a verdict. With no file, the card's own row carries the tick. */
export function reviewPresentationForMode(
  paths: string[], fallbackPath: string, mode: WebReviewMode,
): { paths: string[]; verdictPaths: string[] } {
  const files = fileReviewPaths(paths)
  return { paths: reviewPathsForMode(paths, fallbackPath, mode), verdictPaths: files.length > 0 ? files : [fallbackPath] }
}

/** A web row never counts as a file review or toward a verdict. */
export function fileReviewPaths(paths: string[]): string[] {
  return paths.filter((path) => !isWebAddress(path))
}

/** Each ticked path with the `YYYY-MM-DD HH:MM` it was ticked. */
export type ReviewTicks = Record<string, string>

/**
 * A tick counts for a request it does not predate. A tick from an earlier round, such as before a
 * send back, leaves the new request unticked.
 */
export function tickCounts(tick: string | undefined, requested: string | null): boolean {
  return tick !== undefined && (requested === null || tick >= requested)
}

export function allReviewFilesTicked(paths: string[], ticks: ReviewTicks, requested: string | null = null): boolean {
  const files = fileReviewPaths(paths)
  return files.length > 0 && files.every((path) => tickCounts(ticks[path], requested))
}

/** Recompute every card after a tick, because one file can appear on several review cards. */
export function reviewVerdictReadiness<T>(
  requests: Map<T, { paths: string[]; requested: string | null }>, ticks: ReviewTicks,
): Map<T, boolean> {
  return new Map([...requests].map(([card, { paths, requested }]) => [card, allReviewFilesTicked(paths, ticks, requested)]))
}

/** True for web addresses that only work on the computer hosting the local service. */
export function isLoopbackWebAddress(address: string): boolean {
  if (!isWebAddress(address)) return false
  try {
    const hostname = new URL(address).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '[::1]' || hostname === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  } catch {
    return false
  }
}

/**
 * Reads the card's newest `**Review:**` line. A `wi note` prefix before it is fine. Returns null
 * when the card has none.
 */
export function parseReviewLine(text: string): ReviewLine | null {
  const match = [...text.matchAll(/^(.*)\*\*Review:\*\*\s*(.+)$/gm)].pop()
  if (!match) return null
  const stamp = /(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/.exec(match[1]!)
  const line = match[2]!
  return {
    requested: stamp ? (stamp[2] ? `${stamp[1]} ${stamp[2]}` : stamp[1]!) : null,
    paths: [...line.matchAll(/`([^`]+)`/g)].map((found) => found[1]!)
      .filter((path) => isWebAddress(path) || /\.[A-Za-z0-9]+$/.test(path)),
    what: line.replace(/`[^`]+`/g, '').replace(/[\s:,]+([.;]?)\s*$/, '$1').trim(),
  }
}

export interface Group<T> {
  /** The area, or null for the cards directly in the focus (or in no area, with no focus). */
  area: T | null
  name: string
}

export const NO_AREA = 'No area'

export function groupName<T extends DashItem>(area: T | null, focus: T | null): string {
  return area?.title ?? (focus ? `Directly in ${focus.title}` : NO_AREA)
}

/** Areas by title, with the cards in no area last. */
export function compareGroups<T extends DashItem>(a: Group<T>, b: Group<T>): number {
  return Number(a.area === null) - Number(b.area === null) || a.name.localeCompare(b.name)
}

function groupBy<T extends DashItem, G extends Group<T>>(
  cards: T[], tree: DashTree<T>, focus: T | null, make: (area: T | null, cards: T[]) => G,
): G[] {
  const byArea = new Map<T | null, T[]>()
  for (const card of cards) {
    if (!inFocus(card, focus, tree)) continue
    const area = groupUnder(card, focus, tree)
    byArea.set(area, [...(byArea.get(area) ?? []), card])
  }
  return [...byArea].map(([area, list]) => make(area, list)).sort(compareGroups)
}

export interface Progress<T> extends Group<T> {
  done: number
  doing: number
  /** Cards in options, doing and done. */
  total: number
  backlog: number
}

/**
 * Progress counts leaf cards. A board is a container, and its children carry the work.
 * An area in backlog or done is not active, so its row is left out.
 */
export function progress<T extends DashItem>(cards: T[], tree: DashTree<T>, focus: T | null = null): Progress<T>[] {
  const rows = groupBy(cards.filter((card) => !card.board), tree, focus, (area, list) => ({
    area,
    name: groupName(area, focus),
    done: list.filter((card) => card.status === 'done').length,
    doing: list.filter((card) => card.status === 'doing').length,
    // Backlog cards are not planned yet, so they stay out of the total and are counted apart.
    total: list.filter((card) => card.status !== 'backlog').length,
    backlog: list.filter((card) => card.status === 'backlog').length,
  }))
  return rows.filter((row) => row.area?.status !== 'backlog' && row.area?.status !== 'done')
}

export interface Claim<T> {
  card: T
  /** The newest change to the card or its children. */
  active: number
  steps: T[]
}

export interface AgentRow<T> extends Claim<T> {
  /** The area one level under the focus that holds the card, or null when it sits directly in the focus. */
  area: T | null
  /** True when every open step is in doing, so the agent only waits on them and does not count. */
  waiting: boolean
}

export interface PersonRow<T> {
  person: string
  cards: { card: T; status: Status }[]
}

/** Open cards held by known people. A person appears only when they hold an open card. */
export function peopleFeed<T extends DashItem>(cards: T[], people: string[]): PersonRow<T>[] {
  const rows = new Map<string, PersonRow<T>>()
  for (const person of people) rows.set(person.trim().toLowerCase(), { person, cards: [] })
  for (const card of cards) {
    if (card.holder === undefined || card.status === undefined || card.status === 'done') continue
    const row = rows.get(card.holder.trim().toLowerCase())
    if (row) row.cards.push({ card, status: card.status })
  }
  return [...rows.values()].filter((row) => row.cards.length > 0)
    .sort((a, b) => a.person.localeCompare(b.person))
}

/** Requests for an agent remain visible in Agents until a worker claims them. */
export function agentRequests<T extends DashItem>(cards: T[]): T[] {
  return cards.filter((card) => card.status !== undefined && card.status !== 'done' && isAnyAgent(card.holder))
}

/**
 * True when the card has open children and every one is in doing. Its holder only waits on them,
 * so it does no work of its own (docs/adr/0066-count-only-working-agents.md).
 */
export function waitsOnChildren<T extends DashItem>(card: T, tree: DashTree<T>): boolean {
  const open = tree.childrenOf(card).filter((child) => child.status !== 'done' && !child.effectiveArchived)
  return open.length > 0 && open.every((child) => child.status === 'doing')
}

/**
 * Distinct agent holders, in lower case, that work a doing card. People and requests for any agent
 * are not agents. A card that only waits on its children does not make its holder active, so a
 * full tree of agents cannot deadlock on the limit. Nor does a card that waits for a review
 * verdict: `awaitsReview` says which, because only the caller has the card's text.
 */
export function activeAgentNames<T extends DashItem>(
  cards: T[], people: string[], tree: DashTree<T>, awaitsReview: (card: T) => boolean = () => false,
): Set<string> {
  const personNames = new Set(people.map((name) => name.trim().toLowerCase()))
  const active = new Set<string>()
  for (const card of cards) {
    const holder = card.holder?.trim().toLowerCase()
    if (card.status === 'doing' && holder && !isAnyAgent(holder) && !personNames.has(holder) &&
      !waitsOnChildren(card, tree) && !awaitsReview(card)) active.add(holder)
  }
  return active
}

/** The number of agents that count against `maxAgents`. */
export function activeAgentCount<T extends DashItem>(
  cards: T[], people: string[], tree: DashTree<T>, awaitsReview: (card: T) => boolean = () => false,
): number {
  return activeAgentNames(cards, people, tree, awaitsReview).size
}

/** One flat list of claims in the focus, newest first. Idle claims belong to Needs attention. */
export interface AgentFeed<T> {
  working: AgentRow<T>[]
  idle: AgentRow<T>[]
  finished: AgentRow<T>[]
}

/**
 * Agents come from the `holder` field that `wi claim` writes. It stays on the card when done.
 * A card handed to you, or with every step done, has an agent that finished. A request for any
 * agent (`holder: agent`) has no agent on it yet.
 */
export function agentFeed<T extends DashItem>(
  cards: T[], you: string, tree: DashTree<T>, now: number, focus: T | null = null, people: string[] = [],
): AgentFeed<T> {
  const personNames = new Set(people.map((name) => name.trim().toLowerCase()))
  const rows: AgentRow<T>[] = cards
    .filter((card) => card.holder !== undefined && !isAnyAgent(card.holder) &&
      !personNames.has(card.holder.trim().toLowerCase()) && inFocus(card, focus, tree))
    .map((card) => {
      const steps = tree.childrenOf(card).filter((child) => !child.effectiveArchived)
      return {
        card, steps, area: groupUnder(card, focus, tree), waiting: waitsOnChildren(card, tree),
        active: Math.max(tree.mtimeOf(card), ...steps.map((step) => tree.mtimeOf(step))),
      }
    })
    .sort((a, b) => b.active - a.active)
  const handedOver = (row: AgentRow<T>) => sameName(row.card.owner, you) ||
    (row.steps.length > 0 && row.steps.every((step) => step.status === 'done'))
  const doing = rows.filter((row) => row.card.status === 'doing' && !handedOver(row))
  return {
    working: doing.filter((row) => now - row.active < IDLE_MS),
    idle: doing.filter((row) => now - row.active >= IDLE_MS),
    finished: rows.filter((row) => !doing.includes(row) &&
      (row.card.status === 'done' || row.card.status === 'doing') && now - row.active < FINISHED_WINDOW_MS)
      .slice(0, FINISHED_SHOWN),
  }
}

/**
 * The working claims inside one Progress row. It counts the feed's own rows, so the two agree. A
 * claim that only waits on its steps is not work, as in the active count.
 */
export function workingBadge<T>(feed: AgentFeed<T>, area: T | null): number {
  return feed.working.filter((row) => row.area === area && !row.waiting).length
}

export function ago(ms: number, now: number): string {
  const minutes = Math.round((now - ms) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h`
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export interface Attention<T> {
  card: T
  /**
   * `started`: in doing while it waits on open cards. `archived`: it waits on an archived card that
   * is not done. `quiet`: an idle claim, whose agent most likely ended without a release.
   */
  reason: 'started' | 'archived' | 'quiet'
  cards: T[]
}

/**
 * Dependency problems a person should look at (docs/adr/0041-card-dependencies.md). The board lets
 * a person start a waiting card, so the dashboard is where that shows afterwards. The idle claims
 * from `agentFeed` come last.
 */
export function needsAttention<T extends DashItem>(cards: T[], dependenciesOf: (card: T) => T[], idle: T[] = []): Attention<T>[] {
  const found: Attention<T>[] = []
  for (const card of cards) {
    if (card.status === 'done') continue
    const dependencies = dependenciesOf(card)
    const archived = dependencies.filter((dependency) => dependency.effectiveArchived && dependency.status !== 'done')
    if (archived.length > 0) found.push({ card, reason: 'archived', cards: archived })
    const open = dependencies.filter((dependency) => dependency.status !== 'done')
    if (card.status === 'doing' && open.length > 0) found.push({ card, reason: 'started', cards: open })
  }
  for (const card of idle) found.push({ card, reason: 'quiet', cards: [] })
  return found
}
