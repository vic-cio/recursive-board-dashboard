/**
 * Line-wise YAML frontmatter editing.
 *
 * The vault is the canonical layer, so this module never reserialises a frontmatter block. It
 * rewrites the one line it was asked to change and copies every other byte. That is what keeps
 * `AGENTS.md` integrity rule 5 ("change the one key you mean to change") and the rule that an
 * unknown key is preserved untouched.
 *
 * It understands scalars, which is every field in the v1 schema. A block entry such as a `tags:`
 * list parses as a keyed entry with no scalar value, so it is preserved and can be replaced or
 * removed as a unit. `getList` and `setList` read and replace a list of strings, such as `tags`,
 * as that unit.
 */

export type Scalar = string | number | boolean

export interface Entry {
  key: string
  /** Index of the entry's first line within the frontmatter lines. */
  start: number
  /** Index one past the entry's last line. */
  end: number
  /** The parsed value of a single-line `key: value` entry. A block entry has none. */
  value: Scalar | undefined
}

export interface Frontmatter {
  entries: Entry[]
  keys(): string[]
  has(key: string): boolean
  get(key: string): Scalar | undefined
  entry(key: string): Entry | undefined
}

/** A key line: no leading space, a key, a colon, then an optional value. */
const KEY_LINE = /^([A-Za-z_][\w.-]*)\s*:(?:[ \t]+(.*))?$/

/** A block list item at column 0: a dash followed by a space, a tab or the line end. */
const INDENTLESS_ITEM = /^-(?:[ \t]|$)/

interface Block {
  /** Frontmatter lines, without their terminators. */
  lines: string[]
  /** The line terminator each line carried, parallel to `lines`. */
  ends: string[]
  /** Offset in the source text where the first frontmatter line begins. */
  contentStart: number
  /** Offset in the source text where the closing fence line begins. */
  contentEnd: number
}

function splitBlock(text: string): Block | null {
  if (!text.startsWith('---')) return null
  const first = /^---[ \t]*\r?\n/.exec(text)
  if (!first) return null

  const lines: string[] = []
  const ends: string[] = []
  const contentStart = first[0].length
  let cursor = contentStart

  while (cursor < text.length) {
    const nl = text.indexOf('\n', cursor)
    const hasNewline = nl !== -1
    const lineEnd = hasNewline ? nl + 1 : text.length
    const raw = text.slice(cursor, lineEnd)
    const line = raw.replace(/\r?\n$/, '')
    const end = raw.slice(line.length)

    if (/^---[ \t]*$/.test(line)) {
      return { lines, ends, contentStart, contentEnd: cursor }
    }
    lines.push(line)
    ends.push(end)
    cursor = lineEnd
    if (!hasNewline) break
  }
  // The block never closed, so this file has no frontmatter.
  return null
}

function readEntries(lines: string[]): Entry[] {
  const entries: Entry[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = KEY_LINE.exec(lines[i]!)
    if (!match) continue
    const [, key, rest] = match
    const value = rest === undefined || rest.trim() === '' ? undefined : parseScalar(rest)
    // A block entry owns every following line that is indented or blank, and the items of a
    // block list written at column 0, which YAML allows under a mapping key.
    let end = i + 1
    if (value === undefined) {
      while (end < lines.length && (/^[ \t]/.test(lines[end]!) || lines[end]!.trim() === '' ||
        INDENTLESS_ITEM.test(lines[end]!))) end++
    }
    entries.push({ key: key!, start: i, end, value })
    i = end - 1
  }
  return entries
}

/** The escapes a double-quoted YAML scalar can hold, other than the numeric ones. */
const ESCAPES: Record<string, string> = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
}

/** The length of each numeric escape's hex digits. */
const HEX_ESCAPES: Record<string, number> = { x: 2, u: 4, U: 8 }

/**
 * Reads a quoted scalar at the start of `text`. Returns its value and the offset one past the
 * closing quote, or null when the quote never closes or holds an escape YAML rejects.
 */
function readQuoted(text: string): { value: string, end: number } | null {
  const quote = text[0]
  let value = ''
  let i = 1
  while (i < text.length) {
    const char = text[i]!
    if (quote === "'") {
      if (char === "'") {
        if (text[i + 1] === "'") { value += "'"; i += 2; continue }
        return { value, end: i + 1 }
      }
      value += char
      i++
      continue
    }
    if (char === '"') return { value, end: i + 1 }
    if (char !== '\\') { value += char; i++; continue }
    const code = text[i + 1]
    if (code === undefined) return null
    const simple = ESCAPES[code]
    if (simple !== undefined) { value += simple; i += 2; continue }
    const digits = HEX_ESCAPES[code]
    if (digits === undefined) return null
    const hex = text.slice(i + 2, i + 2 + digits)
    if (!new RegExp(`^[0-9A-Fa-f]{${digits}}$`).test(hex)) return null
    value += String.fromCodePoint(parseInt(hex, 16))
    i += 2 + digits
  }
  return null
}

/** True when `rest` is empty or only whitespace and a comment. */
function onlyComment(rest: string): boolean {
  return /^(?:[ \t]+#.*)?[ \t]*$/.test(rest)
}

/** A plain scalar without its trailing comment, which starts at a `#` after a space or a tab. */
function stripComment(text: string): string {
  if (text.startsWith('#')) return ''
  const hash = /[ \t]#/.exec(text)
  return (hash ? text.slice(0, hash.index) : text).trim()
}

/** Reads a single-line YAML scalar. Returns undefined for a value this module will not interpret. */
export function parseScalar(raw: string): Scalar | undefined {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quoted = readQuoted(trimmed)
    if (quoted && onlyComment(trimmed.slice(quoted.end))) return quoted.value
  }
  const text = stripComment(trimmed)
  if (text === '') return undefined
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d*\.\d+$/.test(text)) return Number(text)
  // A flow collection is a block entry as far as this module is concerned.
  if (text.startsWith('[') || text.startsWith('{')) return undefined
  return text
}

/** True when the plain form of this string would read back as something other than that string. */
function needsQuotes(text: string): boolean {
  if (text === '') return true
  if (text !== text.trim()) return true
  if (/^[[\]{}#&*!|>'"%@`,?-]/.test(text)) return true
  if (/:[ \t]/.test(text) || /[ \t]#/.test(text)) return true
  // A line break would end the line, and a tab or other control character is safer escaped.
  if (/[\u0000-\u001f\u007f]/.test(text)) return true
  if (text.endsWith(':')) return true
  if (/["'\\]/.test(text)) return true
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(text)) return true
  if (/^-?\d+(\.\d+)?$/.test(text)) return true
  return false
}

/** The escape `formatScalar` writes for each control character with a short form. */
const SHORT_ESCAPES: Record<string, string> = { '\t': '\\t', '\n': '\\n', '\r': '\\r' }

/**
 * Renders a scalar for a frontmatter line, quoting only when YAML would otherwise misread it.
 * A string is always one line: a line break or other control character is written as a
 * double-quoted escape, which YAML reads back as the same character.
 */
export function formatScalar(value: Scalar): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (!needsQuotes(value)) return value
  const escaped = value
    .replace(/([\\"])/g, '\\$1')
    .replace(/[\u0000-\u001f\u007f]/g, (char) =>
      SHORT_ESCAPES[char] ?? `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
  return `"${escaped}"`
}

/** Reads the frontmatter of a Markdown file. Returns null when the file has none. */
export function parseFrontmatter(text: string): Frontmatter | null {
  const block = splitBlock(text)
  if (!block) return null
  const entries = readEntries(block.lines)
  const byKey = new Map(entries.map((e) => [e.key, e]))
  return {
    entries,
    keys: () => entries.map((e) => e.key),
    has: (key) => byKey.has(key),
    get: (key) => byKey.get(key)?.value,
    entry: (key) => byKey.get(key),
  }
}

/** The body of a Markdown file, with its frontmatter removed. */
export function frontmatterBody(text: string): string {
  const block = splitBlock(text)
  if (!block) return text
  const fenceEnd = text.indexOf('\n', block.contentEnd)
  return fenceEnd === -1 ? '' : text.slice(fenceEnd + 1)
}

function rewrite(text: string, block: Block, lines: string[], ends: string[]): string {
  const head = text.slice(0, block.contentStart)
  const tail = text.slice(block.contentEnd)
  const middle = lines.map((line, i) => line + (ends[i] ?? '\n')).join('')
  return head + middle + tail
}

/**
 * Sets one frontmatter key, appending it before the closing fence when it is absent.
 * Every other line, including a key this module does not recognise, is copied verbatim.
 */
export function setKey(text: string, key: string, value: Scalar): string {
  const block = splitBlock(text)
  if (!block) throw new Error(`cannot set "${key}": the file has no frontmatter`)

  const entry = readEntries(block.lines).find((e) => e.key === key)
  if (entry?.value === value) return text
  const line = `${key}: ${formatScalar(value)}`
  const lines = [...block.lines]
  const ends = [...block.ends]

  if (entry) {
    lines.splice(entry.start, entry.end - entry.start, line)
    ends.splice(entry.start, entry.end - entry.start, ends[entry.start] ?? '\n')
  } else {
    lines.push(line)
    ends.push(ends[ends.length - 1] ?? defaultEnd(text))
  }
  return rewrite(text, block, lines, ends)
}

/** Removes one frontmatter key, and every continuation line of a block entry. */
export function removeKey(text: string, key: string): string {
  const block = splitBlock(text)
  if (!block) return text

  const entry = readEntries(block.lines).find((e) => e.key === key)
  if (!entry) return text

  const lines = [...block.lines]
  const ends = [...block.ends]
  lines.splice(entry.start, entry.end - entry.start)
  ends.splice(entry.start, entry.end - entry.start)
  return rewrite(text, block, lines, ends)
}

function defaultEnd(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * Reads a list of strings: a block list, a flow list, or one string split on commas and spaces,
 * the three forms Obsidian accepts for `tags`. Returns undefined when the key is absent.
 */
export function getList(text: string, key: string): string[] | undefined {
  const block = splitBlock(text)
  if (!block) return undefined
  const entry = readEntries(block.lines).find((e) => e.key === key)
  if (!entry) return undefined
  const first = KEY_LINE.exec(block.lines[entry.start]!)?.[2]?.trim() ?? ''
  let values: string[]
  if (first.startsWith('[')) {
    values = splitFlowList(first).map(scalarText)
  } else if (first !== '') {
    values = scalarText(first).split(/[,\s]+/)
  } else {
    values = block.lines.slice(entry.start + 1, entry.end)
      .map((line) => scalarText(/^[ \t]*-[ \t]+(.*)$/.exec(line)?.[1] ?? ''))
  }
  return values.map((value) => value.trim()).filter((value) => value !== '')
}

/** A scalar read as text, or an empty string when it is not a scalar. */
function scalarText(raw: string): string {
  const value = parseScalar(raw)
  return value === undefined ? '' : String(value)
}

/**
 * Splits a one-line flow list such as `[a, "b, c"]` into its raw items. A comma inside quotes or
 * inside a nested bracket does not split, and a comment after the closing bracket is dropped.
 */
function splitFlowList(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let item = ''
  let i = 0
  while (i < text.length) {
    const char = text[i]!
    if ((char === '"' || char === "'") && item.trim() === '') {
      const quoted = readQuoted(text.slice(i))
      if (quoted) {
        item += text.slice(i, i + quoted.end)
        i += quoted.end
        continue
      }
    }
    if (char === '[' || char === '{') {
      depth++
      if (depth === 1) { i++; continue }
    } else if (char === ']' || char === '}') {
      depth--
      if (depth === 0) { parts.push(item); return parts }
    } else if (char === ',' && depth === 1) {
      parts.push(item)
      item = ''
      i++
      continue
    }
    item += char
    i++
  }
  // The list never closed on this line: keep what was read.
  parts.push(item)
  return parts
}

/**
 * Replaces a list as one entry, written as a block list the way Obsidian writes `tags`.
 * An empty list removes the key. The entry keeps its place; a new one goes before the fence.
 */
export function setList(text: string, key: string, values: readonly string[]): string {
  if (values.length === 0) return removeKey(text, key)
  const block = splitBlock(text)
  if (!block) throw new Error(`cannot set "${key}": the file has no frontmatter`)
  const entry = readEntries(block.lines).find((e) => e.key === key)
  const current = getList(text, key)
  if (entry && current !== undefined && current.length === values.length &&
    current.every((value, i) => value === values[i]) &&
    block.lines.slice(entry.start + 1, entry.end).every((line) => /^[ \t]*-[ \t]/.test(line))) {
    return text
  }
  const eol = defaultEnd(text)
  const replacement = [`${key}:`, ...values.map((value) => `  - ${formatScalar(value)}`)]
  const lines = [...block.lines]
  const ends = [...block.ends]
  if (entry) {
    lines.splice(entry.start, entry.end - entry.start, ...replacement)
    ends.splice(entry.start, entry.end - entry.start, ...replacement.map(() => eol))
  } else {
    lines.push(...replacement)
    ends.push(...replacement.map(() => eol))
  }
  return rewrite(text, block, lines, ends)
}
