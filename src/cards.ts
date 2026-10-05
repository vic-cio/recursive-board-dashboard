/**
 * The cards the dashboard reads, built from Obsidian's metadata cache.
 *
 * Nothing here runs `wi` or imports Node, so the dashboard works on a phone. Parent links resolve
 * through `getFirstLinkpathDest`, Obsidian's own link resolver, as in Recursive Board. The cache is
 * already in memory, so a full rebuild on each read is cheap and cannot drift.
 */
import type { App, TFile } from 'obsidian'

import { archiveOwner } from './rules/archive.ts'
import { displayName } from './rules/authorship.ts'
import { readBoardSettings, parsePluginData, BOARD_SETTINGS_KEY } from './rules/board-settings.ts'
import type { DashItem } from './rules/dashboard.ts'
import { dependsOnValues, parseDependsOn } from './rules/dependencies.ts'
import { holderOf } from './rules/holder.ts'
import { isStatus, parseWikilink, WORK_ITEM_TYPE } from './rules/schema.ts'
import { DEFAULT_VAULT_CONFIG, type VaultConfig } from './rules/vault-config.ts'

export interface Card extends DashItem {
  file: TFile
  id: string | undefined
  /** The file the parent link resolves to, or null when the card is a root or an orphan. */
  parent: TFile | null
  archived: boolean
  /** The files the `depends_on` links resolve to. */
  dependsOn: TFile[]
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The Recursive Board plugin's data file, where its board settings live. The dashboard only reads it. */
export function boardDataPath(app: App): string {
  return `${app.vault.configDir}/plugins/recursive-board/data.json`
}

/**
 * Reads the board settings from the Recursive Board plugin data: the card folder, the default
 * root and the agent limit. With no file or no board key, the defaults apply.
 */
export async function readBoardConfig(app: App): Promise<VaultConfig> {
  const path = boardDataPath(app)
  if (!(await app.vault.adapter.exists(path))) return { ...DEFAULT_VAULT_CONFIG, extraSections: [] }
  const data = parsePluginData(await app.vault.adapter.read(path))
  return BOARD_SETTINGS_KEY in data ? readBoardSettings(data).config : { ...DEFAULT_VAULT_CONFIG, extraSections: [] }
}

export class CardIndex {
  private readonly app: App
  config: VaultConfig = { ...DEFAULT_VAULT_CONFIG, extraSections: [] }
  private cards = new Map<string, Card>()
  private kids = new Map<string, Card[]>()

  constructor(app: App) {
    this.app = app
  }

  /** Reads every card again. Call it before each render. */
  rebuild(config: VaultConfig = this.config): void {
    this.config = config
    this.cards = new Map()
    this.kids = new Map()
    for (const file of this.app.vault.getMarkdownFiles()) {
      const card = this.read(file)
      if (card) this.cards.set(file.path, card)
    }
    for (const card of this.cards.values()) {
      if (!card.parent) continue
      this.kids.set(card.parent.path, [...(this.kids.get(card.parent.path) ?? []), card])
    }
    for (const card of this.cards.values()) {
      card.effectiveArchived = archiveOwner(
        card.file.path,
        (key) => this.cards.get(key)?.parent?.path ?? null,
        (key) => this.cards.get(key)?.archived ?? false,
      ) !== null
    }
  }

  private read(file: TFile): Card | null {
    // Cards sit directly in the card folder, as Recursive Board reads them.
    if (file.parent?.path !== this.config.workItemFolder) return null
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
    if (!frontmatter || frontmatter['type'] !== WORK_ITEM_TYPE) return null
    const parentLink = parseWikilink(frontmatter['parent'])
    const status: unknown = frontmatter['status']
    const dependsOn: TFile[] = []
    for (const target of parseDependsOn(dependsOnValues(frontmatter['depends_on']).map(String)).targets) {
      const found = this.app.metadataCache.getFirstLinkpathDest(target, file.path)
      if (found && !dependsOn.includes(found)) dependsOn.push(found)
    }
    return {
      file,
      id: text(frontmatter['id']),
      title: text(frontmatter['title']) ?? file.basename,
      status: isStatus(status) ? status : undefined,
      parentLink,
      parent: parentLink ? this.app.metadataCache.getFirstLinkpathDest(parentLink, file.path) : null,
      board: frontmatter['board'] === true,
      area: frontmatter['area'] === true,
      archived: frontmatter['archived'] === true,
      effectiveArchived: false,
      owner: displayName(frontmatter['owner']),
      holder: holderOf((key) => frontmatter[key]),
      dependsOn,
    }
  }

  /** The card a file is, or null when the file is not one. */
  get(file: TFile | null): Card | null {
    return file ? this.cards.get(file.path) ?? null : null
  }

  childrenOf(file: TFile): Card[] {
    return this.kids.get(file.path) ?? []
  }

  /** The chain from the root down to, but not including, this card. It never loops, even on a broken vault. */
  ancestorsOf(file: TFile): Card[] {
    const chain: Card[] = []
    const seen = new Set<string>([file.path])
    for (let up = this.cards.get(file.path)?.parent ?? null; up && !seen.has(up.path); up = this.cards.get(up.path)?.parent ?? null) {
      seen.add(up.path)
      const card = this.cards.get(up.path)
      if (!card) break
      chain.unshift(card)
    }
    return chain
  }

  all(): Card[] {
    return [...this.cards.values()]
  }
}
