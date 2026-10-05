/**
 * The values an edit rule reads from a card, taken from the file's text at write time
 * (docs/adr/0054-edits-from-the-file-at-write-time.md).
 *
 * A writer that decides from a loaded copy can undo a change made since. Both writers read these
 * values from the text they are about to rewrite: the CLI under its lock, the plugin inside
 * `vault.process`. This module imports nothing from Node.
 */
import { parseFrontmatter } from './frontmatter.ts'
import { holderOf } from './holder.ts'
import { isArea, isStatus, type Status } from './schema.ts'

export interface CardState {
  status: Status | undefined
  prevStatus: Status | undefined
  /** True when the key is present, valid or not: a status move removes it either way. */
  hasPrevStatus: boolean
  /** The person or agent who does the work: `holder`, or an old card's `agent`. A blank value is no holder. */
  holder: string | undefined
  archived: boolean
  board: boolean
  /** True when the card carries a `board` key, set or invalid. */
  hasBoardKey: boolean
  area: boolean
}

export function cardState(text: string): CardState {
  const fm = parseFrontmatter(text)
  const get = (key: string) => fm?.get(key)
  const status = get('status')
  const prev = get('prev_status')
  return {
    status: isStatus(status) ? status : undefined,
    prevStatus: isStatus(prev) ? prev : undefined,
    hasPrevStatus: fm?.has('prev_status') ?? false,
    holder: holderOf(get),
    archived: get('archived') === true,
    board: get('board') === true,
    hasBoardKey: fm?.has('board') ?? false,
    area: isArea(get('area')),
  }
}
