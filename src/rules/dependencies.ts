/**
 * Card dependencies (docs/adr/0041-card-dependencies.md).
 *
 * `depends_on` is a list of wikilinks to the cards this card waits on. A dependency is open until
 * its card is done. An archived card that is not done stays open: archiving drops the work, and
 * the card that needed it must not start without a decision. Nothing is written when a dependency
 * closes; the wait is derived at read time.
 *
 * Both writers use these rules. This module imports nothing from Node.
 */
import type { Edit } from './edits.ts'
import { getList, parseFrontmatter } from './frontmatter.ts'
import { formatWikilink, parseWikilink, type Status } from './schema.ts'

export const DEPENDS_ON = 'depends_on'

export interface ParsedDependencies {
  /** Wikilink targets, in file order, without repeats. */
  targets: string[]
  /** Entries that are not wikilinks. */
  malformed: string[]
}

export function parseDependsOn(values: readonly unknown[] | undefined): ParsedDependencies {
  const targets: string[] = []
  const malformed: string[] = []
  for (const value of values ?? []) {
    const target = parseWikilink(value)
    if (target === null) malformed.push(String(value))
    else if (!targets.includes(target)) targets.push(target)
  }
  return { targets, malformed }
}

/** Reads the `depends_on` value Obsidian's metadata cache gives: a list, one string, or nothing. */
export function dependsOnValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

/**
 * The raw `depends_on` entries in a card's text. One wikilink on the key line is a string, not a
 * list to split on spaces as `tags` would be.
 */
export function dependsOnRaw(text: string): string[] {
  const scalar = parseFrontmatter(text)?.get(DEPENDS_ON)
  return typeof scalar === 'string' ? [scalar] : getList(text, DEPENDS_ON) ?? []
}

export interface Dependency {
  status: Status | undefined
}

export function isOpenDependency(dependency: Dependency): boolean {
  return dependency.status !== 'done'
}

/**
 * The list edit that adds or removes one dependency. Returns null when nothing changes.
 * Other entries keep their text and order, so an unresolved or odd entry survives. `names`
 * says whether an entry's link target means the card, since two spellings can resolve to one file.
 */
export function dependencyEdit(
  current: readonly string[], target: string, on: boolean,
  names: (linkTarget: string) => boolean = (linkTarget) => linkTarget === target,
): Edit | null {
  const means = (value: string) => {
    const linkTarget = parseWikilink(value)
    return linkTarget !== null && names(linkTarget)
  }
  const has = current.some(means)
  if (on === has) return null
  const values = on ? [...current, formatWikilink(target)] : current.filter((value) => !means(value))
  return { op: 'list', key: DEPENDS_ON, values }
}

/** `dependencyEdit` on the list as the card's text holds it now. */
export function dependencyEditIn(
  text: string, target: string, on: boolean,
  names?: (linkTarget: string) => boolean,
): Edit | null {
  return dependencyEdit(dependsOnRaw(text), target, on, names)
}

/** A chain of dependencies from `from` back to `from`, or null when there is none. Nodes compare by identity. */
export function dependencyCycle<T>(from: T, dependsOn: (node: T) => readonly T[]): T[] | null {
  return dependencyPath(from, from, dependsOn)
}

/** A chain of dependencies from `from` to `to`, both included, or null when `from` does not wait on `to`. Nodes compare by identity. */
export function dependencyPath<T>(from: T, to: T, dependsOn: (node: T) => readonly T[]): T[] | null {
  return dependencyPathByKey(from, to, (node) => node, dependsOn)
}

/**
 * `dependencyPath` for nodes that are rebuilt, such as the plugin's index entries: nodes compare
 * by `key`, so a copy taken before a rebuild still matches its replacement.
 */
export function dependencyPathByKey<T>(
  from: T, to: T, key: (node: T) => unknown, dependsOn: (node: T) => readonly T[],
): T[] | null {
  const target = key(to)
  const seen = new Set<unknown>([key(from)])
  const walk = (node: T, path: T[]): T[] | null => {
    for (const next of dependsOn(node)) {
      const nextKey = key(next)
      if (nextKey === target) return [...path, next]
      if (seen.has(nextKey)) continue
      seen.add(nextKey)
      const found = walk(next, [...path, next])
      if (found) return found
    }
    return null
  }
  return walk(from, [from])
}

/** The refusal `wi claim` and `wi status doing` give a card that waits on open cards. */
export function waitingRefusal(card: string, open: readonly string[]): string {
  return `${card} waits on ${open.join(', ')}. Finish ${open.length === 1 ? 'that card' : 'those cards'} first, ` +
    `or remove the dependency with wi depend <card> --on <dependency> --off.`
}
