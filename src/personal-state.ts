import { parseWebReviewMode, type WebReviewMode } from './rules/dashboard.ts'

export interface DeviceDashboardState {
  you: string
  root: string
  focus: string | null
  webReviewMode: WebReviewMode
  /** The finished fold under the Agents feed. Per device, so opening it on one device leaves another closed. */
  finishedOpen: boolean
  /** The For review groups folded on this device, by group key (the area's path, '' for no area). */
  foldedGroups: string[]
}

/** Each ticked path with the `YYYY-MM-DD HH:MM` it was ticked (ReviewTicks in src/shared/dashboard.ts). */
export type DashboardTicks = Record<string, string>

const EMPTY_DEVICE_STATE: DeviceDashboardState = {
  you: '',
  root: '',
  focus: null,
  webReviewMode: 'webviewer',
  finishedOpen: false,
  foldedGroups: [],
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parseDeviceDashboardState(value: unknown): DeviceDashboardState {
  const data = record(value)
  return {
    you: typeof data['you'] === 'string' ? data['you'] : EMPTY_DEVICE_STATE.you,
    root: typeof data['root'] === 'string' ? data['root'] : EMPTY_DEVICE_STATE.root,
    focus: typeof data['focus'] === 'string' ? data['focus'] : null,
    webReviewMode: parseWebReviewMode(data['webReviewMode']),
    finishedOpen: data['finishedOpen'] === true,
    foldedGroups: Array.isArray(data['foldedGroups'])
      ? [...new Set(data['foldedGroups'].filter((key): key is string => typeof key === 'string'))]
      : [],
  }
}

/** The folded group keys with one group folded or unfolded. */
export function withFold(folded: readonly string[], key: string, fold: boolean): string[] {
  const rest = folded.filter((other) => other !== key)
  return fold ? [...rest, key] : rest
}

export function parsePersonTicks(value: unknown): DashboardTicks {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return {} }
  }
  const data = record(record(parsed)['ticks'])
  const ticks: DashboardTicks = {}
  // An old tick is `true`, with no time. It cannot say which review round it belongs to, so it is dropped.
  for (const [path, ticked] of Object.entries(data)) {
    if (typeof ticked === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ticked)) ticks[path] = ticked
  }
  return ticks
}

/** All the ticks, with the newer time where two sets tick the same path. */
export function mergeTicks(...sets: DashboardTicks[]): DashboardTicks {
  const merged: DashboardTicks = {}
  for (const set of sets) {
    for (const [path, ticked] of Object.entries(set)) {
      const current = merged[path]
      if (current === undefined || ticked > current) merged[path] = ticked
    }
  }
  return merged
}

/**
 * The dashboard's data with the review ticks that Recursive Board kept before the dashboard moved
 * out of it. It copies them once: only when this data has no ticks yet. Recursive Board's file is
 * read, never written.
 */
export function withCopiedPeople(own: Record<string, unknown>, core: unknown): Record<string, unknown> {
  const people = record(record(core)['people'])
  if ('people' in own || Object.keys(people).length === 0) return own
  return { ...own, people }
}

/** One person's ticks in the plugin data, which Obsidian Sync carries: `people.<name>.ticks`. */
export function personTicks(data: unknown, name: string): DashboardTicks {
  return parsePersonTicks(record(record(record(data)['people'])[name.trim()]))
}

/** The plugin data with one person's ticks replaced. Every other key and person is kept. */
export function withPersonTicks(data: Record<string, unknown>, name: string, ticks: DashboardTicks): Record<string, unknown> {
  const people = { ...record(data['people']) }
  if (Object.keys(ticks).length > 0) people[name.trim()] = { ticks }
  else delete people[name.trim()]
  const next = { ...data }
  if (Object.keys(people).length > 0) next['people'] = people
  else delete next['people']
  return next
}

/** Applies what changed between two tick sets on this device to the stored set, keeping ticks made elsewhere. */
export function applyTickChanges(stored: DashboardTicks, before: DashboardTicks, after: DashboardTicks): DashboardTicks {
  const next = { ...stored }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue
    const ticked = after[key]
    if (ticked !== undefined) next[key] = ticked
    else delete next[key]
  }
  return next
}
