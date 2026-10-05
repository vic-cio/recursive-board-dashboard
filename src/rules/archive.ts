/** Archive rules shared by the CLI and plugin (docs/adr/0007-archive-is-a-frontmatter-flag.md). */
import type { Edit } from './edits.ts'
import type { Status } from './schema.ts'

/** Absence is the unarchived state, as with `board`. */
export function archiveEdits(archived: boolean, toArchived: boolean): Edit[] | null {
  if (archived === toArchived) return null
  return toArchived
    ? [{ op: 'set', key: 'archived', value: true }]
    : [{ op: 'remove', key: 'archived' }]
}

/** The nearest flagged ancestor, including the item itself. A broken parent cycle terminates. */
export function archiveOwner<Key>(
  item: Key,
  parentOf: (key: Key) => Key | null,
  flagged: (key: Key) => boolean,
): Key | null {
  const seen = new Set<Key>()
  for (let current: Key | null = item; current !== null; current = parentOf(current)) {
    if (seen.has(current)) break
    seen.add(current)
    if (flagged(current)) return current
  }
  return null
}

/** Find an active descendant before hiding a subtree. Only descendants count. */
export function activeDescendant<Key>(
  item: Key,
  childrenOf: (key: Key) => readonly Key[],
  statusOf: (key: Key) => Status | undefined,
): Key | null {
  const seen = new Set<Key>([item])
  const queue = [...childrenOf(item)]
  for (let i = 0; i < queue.length; i++) {
    const child = queue[i]!
    if (seen.has(child)) continue
    seen.add(child)
    if (statusOf(child) === 'doing') return child
    queue.push(...childrenOf(child))
  }
  return null
}
