/**
 * Names for card ownership and note signatures (docs/adr/0042-creator-and-role.md).
 *
 * `owner` holds a plain name, not a link: a link from every card to its owner turns the graph into
 * one star around each person. A person note has `type: person`, in any folder.
 * A role is a tag (docs/adr/0062-role-tags.md). Old `creator` fields stay on cards, and nothing
 * writes or checks them (docs/adr/0064-validate-checks-no-creator.md).
 * This module imports nothing from Node.
 */
import { parseWikilink } from './schema.ts'

export const PERSON_TYPE = 'person'

/** The plain name to write. A link given by habit becomes its target: `[[Ana]]` is `Ana`. */
export function asName(name: string): string {
  const plain = displayName(name)
  if (plain === undefined) throw new Error('a name cannot be empty.')
  return plain
}

/** The name to show: a link's target, or the plain text. */
export function displayName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return parseWikilink(value) ?? value.trim()
}

/** "Checker (gpt-6-luna)", "Ana", or undefined when there is no name. */
export function authorLabel(name: string | undefined, model: string | undefined): string | undefined {
  const who = displayName(name)
  if (who === undefined) return undefined
  const runtime = model?.trim()
  return runtime ? `${who} (${runtime})` : who
}
