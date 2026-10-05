/**
 * Who does a card's work now (docs/adr/0061-holder-names-who-does-the-work.md).
 *
 * A card's `holder` names a person or an agent's worker name. Cards written before the rename
 * carry the same fact in `agent`, so every reader takes `agent` when `holder` is absent, and every
 * writer that sets or clears the holder also removes `agent` in the same write. No bulk edit is
 * needed. This module imports nothing from Node.
 */
import type { Edit } from './edits.ts'

export const HOLDER = 'holder'
/** The key that held the holder before the rename. Read, never written. */
export const LEGACY_HOLDER = 'agent'
/** The reserved holder: any agent may take the card. A worker's claim replaces it with its name. */
export const ANY_AGENT = 'agent'

/** The holder from a frontmatter lookup. A blank value is no holder; `holder` wins over `agent`. */
export function holderOf(get: (key: string) => unknown): string | undefined {
  for (const key of [HOLDER, LEGACY_HOLDER]) {
    const value = get(key)
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

export function isAnyAgent(name: string | undefined): boolean {
  return name?.trim().toLowerCase() === ANY_AGENT
}

export function setHolderEdits(name: string): Edit[] {
  return [{ op: 'set', key: HOLDER, value: name }, { op: 'remove', key: LEGACY_HOLDER }]
}

export function clearHolderEdits(): Edit[] {
  return [{ op: 'remove', key: HOLDER }, { op: 'remove', key: LEGACY_HOLDER }]
}

/** The holder as a person reads it: the reserved holder reads Agent. */
export function holderLabel(name: string): string {
  return isAnyAgent(name) ? 'Agent' : name
}
