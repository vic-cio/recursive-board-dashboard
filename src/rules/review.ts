/**
 * Your verdict on a card that waits for your review (docs/adr/0043-review-verdicts.md).
 *
 * Approve writes a note and closes the card. Send back writes a note, with your comment if any, and removes
 * the owner, so the card leaves For review and goes back to its agent in doing. Each is one write
 * to the card's own file. The dashboard and `wi approve` / `wi send-back` call the same function, so
 * both refuse the same cards (docs/adr/0065-review-verdicts-in-wi.md). This module imports nothing from Node.
 */
import { displayName } from './authorship.ts'
import { applyStampedEdits, type Edit } from './edits.ts'
import { frontmatterBody, parseFrontmatter } from './frontmatter.ts'
import { scanMarkdown } from './markdown.ts'
import { appendNote, noteLine } from './notes.ts'
import { isStatus, today } from './schema.ts'
import { statusEdits } from './transitions.ts'

export interface ReviewRequestInput {
  to: string
  files?: string[]
  /** What the reviewer should check. A note is one line, so line breaks become spaces. */
  note?: string
  writer?: string
  now?: Date
}

/** Sets the reviewer and adds the request to Notes in the same card write. */
export function applyReviewRequest(text: string, request: ReviewRequestInput): string {
  const owner = request.to.trim()
  if (owner === '') throw new Error('a person is required for review.')
  const paths = (request.files ?? []).map((file) => file.trim()).filter((file) => file !== '')
  const listed = paths.map((file) => `\`${file}\``).join(', ')
  const note = (request.note ?? '').replace(/\s+/g, ' ').trim()
  // The dashboard shows the text without the paths as what to check (parseReviewLine).
  const body = note === ''
    ? `Please review${listed === '' ? '' : ` ${listed}`}.`
    : listed === '' ? note : `${note.replace(/[\s.:;,]+$/, '')}: ${listed}`
  const now = request.now ?? new Date()
  const line = noteLine(`**Review:** ${body}`, request.writer, now)
  return applyStampedEdits(appendNote(text, line), [{ op: 'set', key: 'owner', value: owner }], today(now))
}

/** True when the newest review request follows the newest verdict in the card's Notes. */
export function awaitsReviewVerdict(text: string): boolean {
  let latest: 'review' | 'verdict' | undefined
  for (const line of notesText(text).split(/\r?\n/)) {
    if (/\*\*Review:\*\*/.test(line)) latest = 'review'
    else if (/\b(?:Approved by|Sent back by)\b/.test(line)) latest = 'verdict'
  }
  return latest === 'review'
}

function notesText(text: string): string {
  const body = frontmatterBody(text)
  const lines = scanMarkdown(body).lines
  const headings = lines.map((line, index) => ({ line, index, heading: line.heading }))
    .filter((entry) => entry.heading !== undefined)
  const notesIndex = headings.findIndex((entry) => entry.heading!.level === 2 && entry.heading!.title.trim().toLowerCase() === 'notes')
  if (notesIndex < 0) return ''
  const heading = headings[notesIndex]!
  const next = headings.slice(notesIndex + 1).find((entry) => entry.heading!.level <= 2)
  const start = lines[heading.index]!.contentEnd
  const end = next ? lines[next.index]!.start : body.length
  return body.slice(start, end)
}

/**
 * `you` is the reviewer: the person the card's owner names. `writer` signs the note line, as
 * `wi note` does, when someone other than the reviewer records the verdict, such as an agent the
 * reviewer told. The dashboard passes no writer.
 */
export type Verdict =
  | { verdict: 'approve'; you: string; writer?: string }
  | { verdict: 'send back'; you: string; comment: string; writer?: string }

/**
 * The verdict's one card write. It refuses a card that does not wait for this reviewer: a card not
 * in doing, a card whose owner is someone else, and a card with no review request after its last
 * verdict. The caller checks open children, because they live in other files.
 */
export function applyVerdict(text: string, verdict: Verdict, now: Date = new Date()): string {
  const you = verdict.you.trim()
  if (you === '') throw new Error('set your name in the Recursive Board settings first.')
  const frontmatter = parseFrontmatter(text)
  const status = frontmatter?.get('status')
  if (status !== 'doing') throw new Error(`the card is ${isStatus(status) ? status : 'not a card'}, and a review needs it in doing.`)
  // The owner may be a link to the person note, as the dashboard reads it.
  const owner = displayName(frontmatter?.get('owner')) ?? ''
  if (owner === '') throw new Error('no one is asked to review this card. Send it for review first.')
  if (owner.toLowerCase() !== you.toLowerCase()) throw new Error(`the card waits for review by ${owner}, not ${you}.`)
  if (!awaitsReviewVerdict(text)) throw new Error('no review request waits on this card. Send it for review first.')

  if (verdict.verdict === 'approve') {
    const edits = statusEdits('doing', 'done', false)!
    return applyStampedEdits(appendNote(text, noteLine(`Approved by ${you}.`, verdict.writer, now)), edits, today(now))
  }

  const comment = verdict.comment.trim()
  const edits: Edit[] = [{ op: 'remove', key: 'owner' }]
  const note = comment === '' ? `Sent back by ${you}.` : `Sent back by ${you}: ${comment}`
  return applyStampedEdits(appendNote(text, noteLine(note, verdict.writer, now)), edits, today(now))
}
