import { scanMarkdown, wrapAnglePlaceholders } from './markdown.ts'
import { frontmatterBody } from './frontmatter.ts'
import { today } from './schema.ts'

/** Add one line to Notes without changing any existing body text. */
export function appendNote(text: string, line: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const body = frontmatterBody(text)
  const offset = text.length - body.length
  const scan = scanMarkdown(body)
  const all = scan.lines
    .map((line, index) => ({ line, index, heading: line.heading }))
    .filter((entry) => entry.heading !== undefined)
  const noteIndex = all.findIndex((entry) => entry.heading!.level === 2 && entry.heading!.title.trim().toLowerCase() === 'notes')
  const heading = all[noteIndex]
  if (!heading) {
    const gap = text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol
    return `${text}${gap}## Notes${eol}${eol}${line}${eol}`
  }

  const headingLine = scan.lines[heading.index]!
  const start = offset + headingLine.contentEnd
  const next = all.slice(noteIndex + 1).find((entry) => entry.heading!.level <= 2)
  const end = next ? offset + scan.lines[next.index]!.start : text.length
  const content = text.slice(start, end)
  if (content === '') return `${text.slice(0, start)}${eol}${eol}${line}${eol}${text.slice(end)}`
  const trailing = /(?:\r?\n[ \t]*)*$/.exec(content)?.[0] ?? ''
  const prose = content.slice(0, content.length - trailing.length)
  const insertion = prose === ''
    ? `${eol}${eol}${line}${eol}${next ? eol : ''}`
    : `${prose}${eol}${line}${trailing || eol}`
  return text.slice(0, start) + insertion + text.slice(end)
}

/**
 * A progress line for Notes: `- 2026-09-25 14:03, codex: Priced the demolition lines.`
 * The time is local, like every date here, and tells two lines on one day apart.
 */
export function noteLine(text: string, agent?: string, now: Date = new Date()): string {
  const body = wrapAnglePlaceholders(text.trim())
  if (body === '') throw new Error('a note needs text.')
  if (/[\r\n]/.test(body)) throw new Error('a note must be one line.')
  const who = agent?.trim() ? `, ${agent.trim()}` : ''
  return `- ${noteStamp(now)}${who}: ${body}`
}

/** The local date and minute a note starts with: `YYYY-MM-DD HH:MM`. These sort as text. */
export function noteStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${today(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}
