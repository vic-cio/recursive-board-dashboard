/**
 * The work-item fields shared by both writers (docs/adr/0004-wi-is-the-programmatic-write-interface.md).
 *
 * This schema applies to the work-item folder (`Boards/`) only. Other folders in a vault follow
 * their owner's conventions, and the validator leaves them outside the product's work-item scope.
 * Nothing here may grow a field without a decision recorded in `docs/adr/`.
 */

export const STATUSES = ['backlog', 'options', 'doing', 'done'] as const
export type Status = (typeof STATUSES)[number]

/** The nine core fields, in the order `wi new` writes them. */
export const CORE_FIELDS = [
  'type',
  'id',
  'title',
  'status',
  'parent',
  'created',
  'updated',
  'board',
  'prev_status',
] as const

/** Fields a work item may carry. Anything outside both lists is an unknown key, and is preserved. */
export const OPTIONAL_FIELDS = [
  'owner',
  'holder', // docs/adr/0061-holder-names-who-does-the-work.md: who does the work now.
  'agent', // The holder on a card written before the rename. Read, never written.
  'priority',
  'due',
  'depends_on',
  'tags',
  'archived', // docs/adr/0007-archive-is-a-frontmatter-flag.md: a flag, not a status.
  'area', // docs/adr/0028-area-work-items.md: an ongoing space that keeps its status.
  'creator', // docs/adr/0064-validate-checks-no-creator.md: kept on old cards; nothing writes or checks it.
  'creator_model',
] as const

export const WORK_ITEM_TYPE = 'work-item'

export function isArea(value: unknown): boolean {
  return value === true
}

/**
 * The folders this product reads. The validator limits them to the work-item folder and the
 * templates folder; everything else in a vault belongs to its owner. Nothing nests inside either.
 *
 * `Boards/` is the default work-item folder. docs/adr/0003-flat-configurable-work-item-folder.md makes it configurable, so this constant
 * is the fallback rather than the final word.
 */
export const FOLDERS = ['Boards', 'Templates'] as const
export type Folder = (typeof FOLDERS)[number]

export const BOARDS = 'Boards'

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

/**
 * Reads the target of a wikilink. Returns null when the value is not a wikilink.
 * A display alias and a heading anchor are both dropped: the target is what resolves to a file.
 */
export function parseWikilink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\s*\[\[([^\]]+)\]\]\s*$/.exec(value)
  if (!match) return null
  const target = match[1]!.split('|')[0]!.split('#')[0]!.trim()
  return target === '' ? null : target
}

export function formatWikilink(target: string): string {
  return `[[${target}]]`
}

const UNSAFE_IN_FILENAME = /[\\/:*?"<>|[\]#^]/g

/** Turns a title into a filename stem Obsidian and macOS both accept. */
export function fileNameStem(title: string): string {
  const stem = title
    .replace(UNSAFE_IN_FILENAME, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return stem === '' ? 'Untitled' : stem
}

/** The short half of an id: `wi-a7f3` gives `a7f3`. */
export function idSuffix(id: string): string {
  return id.startsWith('wi-') ? id.slice(3) : id
}

/**
 * The filename stem for a work item, with the id collision suffix when the plain title is taken.
 * The suffix is the id's short half, so the file is recoverable from the id alone.
 */
export function fileNameFor(title: string, id: string, taken: ReadonlySet<string>): string {
  const stem = fileNameStem(title)
  if (!taken.has(stem.toLowerCase())) return stem
  return `${stem}--${idSuffix(id)}`
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Mints a `wi-<short>` id that no existing item holds. Random, so it needs no global counter. */
export function newId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let length = 4; length <= 12; length++) {
    for (let attempt = 0; attempt < 200; attempt++) {
      let short = ''
      for (let i = 0; i < length; i++) {
        short += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)]
      }
      const id = `wi-${short}`
      if (!taken.has(id)) return id
    }
  }
  throw new Error('could not mint an unused work item id')
}

/** Today in the `YYYY-MM-DD` form every date field uses. Local time, because the vault is personal. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** How long a done item stays visible on the board; older items remain in Markdown. */
export const DONE_WINDOW_DAYS = 14

/** The earliest `updated` a done item may have and still show. */
export function doneCutoff(now: Date = new Date(), days = DONE_WINDOW_DAYS): string {
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return today(then)
}
