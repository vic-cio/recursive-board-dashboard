/**
 * What a board interaction does to a work item's frontmatter.
 *
 * These are the rules the CLI and the plugin must agree on exactly, because a card ticked on the
 * phone and a card moved by an agent are the same operation. Keeping them here means the rule is
 * tested once and cannot drift between the two writers.
 *
 * Every transition touches one file. That is what makes a card move safe on a synced vault
 * (spec section 37), so nothing here may produce an edit to a parent.
 */
import type { Edit } from './edits.ts'
import { cardState } from './card-state.ts'
import { clearHolderEdits, isAnyAgent, setHolderEdits } from './holder.ts'
import { formatWikilink, type Status } from './schema.ts'

/**
 * Moving a card between columns, including the recorded previous status for `done`.
 * Returns null when the move is a no-op, so a caller can avoid a pointless sync event.
 */
export function statusEdits(
  from: Status | undefined,
  to: Status,
  hasPrevStatus: boolean,
): Edit[] | null {
  if (from === to) return null

  const edits: Edit[] = [{ op: 'set', key: 'status', value: to }]
  if (to === 'done') {
    // Record what it was, so unticking restores it exactly rather than guessing at backlog.
    if (from !== undefined) edits.push({ op: 'set', key: 'prev_status', value: from })
  } else if (hasPrevStatus) {
    // Leaving done: the record has served its purpose and would only go stale.
    edits.push({ op: 'remove', key: 'prev_status' })
  }
  return edits
}

/** `statusEdits` for the card as its text is now. */
export function statusEditsIn(text: string, to: Status): Edit[] | null {
  const state = cardState(text)
  return statusEdits(state.status, to, state.hasPrevStatus)
}

/** Unticking the card as its text is now. A card that is no longer done is left alone. */
export function untickEditsIn(text: string): Edit[] | null {
  const state = cardState(text)
  if (state.status !== 'done') return null
  return statusEdits(state.status, untickTarget(state.prevStatus), state.hasPrevStatus)
}

/**
 * A claim is one status transition and one holder edit on the same card.
 * `hasOtherDoingChild` is a child in doing that someone other than this agent works: a person, or
 * another agent. A child this agent holds does not block, so an agent can hold a card and the
 * subtask it works now, in either order. The reserved holder `agent` asks for any agent, so any
 * claim replaces it.
 */
export function claimEdits(
  from: Status | undefined,
  currentHolder: string | undefined,
  agent: string,
  hasPrevStatus: boolean,
  hasOtherDoingChild: boolean,
): Edit[] | null {
  if (isAnyAgent(agent)) throw new Error('agent is the reserved holder that means any agent. Claim with your own name.')
  if (from === 'done') throw new Error('a done card cannot be claimed.')
  const holder = isAnyAgent(currentHolder) ? undefined : currentHolder
  if (holder && holder !== agent) {
    throw new Error(`already claimed by ${holder}. Release that claim first.`)
  }
  if (holder === agent && from === 'doing') return null
  if (hasOtherDoingChild) {
    throw new Error('this board has a child in doing that another agent or a person works. Release or finish that child first.')
  }
  const status = statusEdits(from, 'doing', hasPrevStatus)
  if (holder === agent) return status
  return [...(status ?? []), ...setHolderEdits(agent)]
}

/** Release retains normal status history rules while removing the holder. */
export function releaseEdits(from: Status | undefined, hasPrevStatus: boolean): Edit[] {
  return [...(statusEdits(from, 'options', hasPrevStatus) ?? []), ...clearHolderEdits()]
}

/**
 * Where unticking a done item sends it.
 * `prev_status` is what it was. Its absence means the item arrived at done some other way, and
 * `backlog` is the creation default rather than a guess at intent.
 */
export function untickTarget(prevStatus: Status | undefined): Status {
  return prevStatus ?? 'backlog'
}

/**
 * Promotion and demotion.
 * Demotion deletes the key: absence means not a board, and `board: false` would litter the vault
 * with a key that says nothing.
 */
export function boardEdits(promoted: boolean): Edit[] {
  return promoted
    ? [{ op: 'set', key: 'board', value: true }]
    : [{ op: 'remove', key: 'board' }]
}

export interface FirstChildParent {
  isRoot: boolean
  area: boolean
  /** True when the parent carries a `board` key, set or invalid. */
  hasBoardKey: boolean
  /** Children before the new one, archived ones included. */
  childCount: number
}

/**
 * Whether giving a parent a new child also promotes the parent (docs/adr/0035-promote-a-parent-on-its-first-child.md).
 * Only the first child promotes. A parent that already has children and no board is a checklist
 * someone chose or demoted, and a later child must not undo that.
 */
export function firstChildPromotion(parent: FirstChildParent, autoPromote: boolean): Edit[] | null {
  if (!autoPromote || parent.isRoot || parent.area || parent.hasBoardKey || parent.childCount > 0) return null
  return boardEdits(true)
}

/**
 * Reparenting: moving an item to another board.
 *
 * It rewrites the child's `parent` and nothing else. The status stays, because a move changes
 * where an item sits and not how far along it is, and the item's own children follow it for
 * free because they point at it by link. Returns null when the target is already the parent.
 * Stems compare without case, because Obsidian resolves a wikilink that way.
 */
export function moveEdits(currentParentStem: string | null, targetStem: string): Edit[] | null {
  if (currentParentStem !== null && currentParentStem.toLowerCase() === targetStem.toLowerCase()) {
    return null
  }
  return [{ op: 'set', key: 'parent', value: formatWikilink(targetStem) }]
}

export interface MoveCheck {
  /** The item being moved, as a key the caller's index uses. */
  item: string
  /** The proposed new parent, keyed the same way. */
  target: string
  /**
   * True when the item has no `parent` at all. Stated rather than derived from `parentOf`,
   * because an orphan also has no resolved parent, and moving an orphan is how it is repaired.
   */
  isRoot: boolean
  /** The parent of a key, or null for a root or an orphan. */
  parentOf(this: void, key: string): string | null
}

/**
 * Why a move must not happen, or null when it may.
 *
 * A root has no parent to change. A move under the item itself or under one of its descendants
 * would make the parent chain loop, and the whole subtree would then render on no board. The
 * walk carries a seen set, so a vault whose chain already loops cannot hang it (integrity rule 3).
 */
export function moveRefusal(check: MoveCheck): string | null {
  const { item, target, isRoot, parentOf } = check
  if (isRoot) {
    return 'it is a root, and a root has no parent to change.'
  }
  if (item === target) return 'an item cannot be moved under itself.'

  const seen = new Set<string>()
  for (let key: string | null = target; key !== null; key = parentOf(key)) {
    if (key === item) return 'the target is under its own subtree, so the move would make a loop.'
    if (seen.has(key)) break
    seen.add(key)
  }
  return null
}
