/**
 * Frontmatter edits as data, so both writers apply the same rules.
 *
 * Integrity rule 5 says to change the one key you mean to change. An edit names a key, which is
 * why nothing here ever rebuilds a frontmatter block. This module imports nothing from Node, so
 * the plugin bundle can carry it to iOS.
 */
import { setKey, removeKey, setList, type Scalar } from './frontmatter.ts'
import { today } from './schema.ts'

export type Edit =
  | { op: 'set'; key: string; value: Scalar }
  | { op: 'remove'; key: string }
  | { op: 'list'; key: string; values: readonly string[] }

/**
 * The edits to apply, or a rule that computes them from the file's text at write time
 * (docs/adr/0054-edits-from-the-file-at-write-time.md). A writer runs a rule on the text it is
 * about to rewrite, so an edit that depends on a current value never works from a stale copy.
 * A rule returns null for no change, and throws to refuse.
 */
export type EditPlan = readonly Edit[] | ((text: string) => readonly Edit[] | null)

export function editsFor(text: string, plan: EditPlan): readonly Edit[] {
  return typeof plan === 'function' ? plan(text) ?? [] : plan
}

export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text
  for (const edit of edits) {
    out = edit.op === 'set'
      ? setKey(out, edit.key, edit.value)
      : edit.op === 'list' ? setList(out, edit.key, edit.values) : removeKey(out, edit.key)
  }
  return out
}

/** Adds the `updated` stamp an edit implies, unless the caller already set it. */
export function withStamp(edits: readonly Edit[], stamp: string = today()): Edit[] {
  if (edits.some((e) => e.key === 'updated')) return [...edits]
  return [...edits, { op: 'set', key: 'updated', value: stamp }]
}

/** Stamp only when the requested edits change the file. */
export function applyStampedEdits(text: string, plan: EditPlan, stamp: string = today()): string {
  const edits = editsFor(text, plan)
  if (applyEdits(text, edits) === text) return text
  return applyEdits(text, withStamp(edits, stamp))
}
