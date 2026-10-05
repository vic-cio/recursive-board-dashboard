/** The one vault-level setting read by both wi and the plugin. No platform imports belong here. */
import { fileNameStem } from './schema.ts'

export interface VaultConfig {
  /** Vault-relative directory. Work items sit directly in it. */
  workItemFolder: string
  /** Filename stem of the root item, or null when new items require an explicit parent. */
  defaultRoot: string | null
  /** Headings appended to every new work-item body. */
  extraSections: string[]
  /** Advisory maximum number of claimed doing cards for dispatchers. */
  maxAgents: number | null
  /** Both writers promote a parent to a board when it gets its first child. */
  autoPromote: boolean
}

export const DEFAULT_VAULT_CONFIG: Readonly<VaultConfig> = {
  workItemFolder: 'Boards',
  defaultRoot: null,
  extraSections: [],
  maxAgents: null,
  autoPromote: true,
}

/** Parse at the vault boundary; malformed config must never silently select another folder. */
export function parseVaultConfigValues(value: Record<string, unknown>, source: string): VaultConfig {

  const folderValue = 'workItemFolder' in value ? value.workItemFolder : undefined
  const rootValue = 'defaultRoot' in value ? value.defaultRoot : undefined
  const sectionsValue = 'extraSections' in value ? value.extraSections : undefined
  const maxAgentsValue = 'maxAgents' in value ? value.maxAgents : undefined
  const autoPromoteValue = 'autoPromote' in value ? value.autoPromote : undefined
  let workItemFolder = DEFAULT_VAULT_CONFIG.workItemFolder
  if (folderValue !== undefined) {
    if (typeof folderValue !== 'string') {
      throw new Error(`${source}: workItemFolder must be a vault-relative folder path.`)
    }
    workItemFolder = folderValue.replace(/\/$/, '')
    if (
      workItemFolder === '' || workItemFolder.startsWith('/') ||
      workItemFolder.split('/').some((part) => part === '' || part === '.' || part === '..') ||
      /[\\:\0]/.test(workItemFolder)
    ) {
      throw new Error(`${source}: workItemFolder must be a vault-relative folder path.`)
    }
  }

  let defaultRoot: string | null = null
  if (rootValue !== undefined && rootValue !== null) {
    if (typeof rootValue !== 'string' || rootValue === '' || fileNameStem(rootValue) !== rootValue) {
      throw new Error(`${source}: defaultRoot must be a work-item filename stem.`)
    }
    defaultRoot = rootValue
  }
  const extraSections: string[] = []
  if (sectionsValue !== undefined) {
    if (!Array.isArray(sectionsValue)) {
      throw new Error(`${source}: extraSections must be an array of non-empty, single-line headings.`)
    }
    const headings: unknown[] = sectionsValue
    for (const heading of headings) {
      if (typeof heading !== 'string' || heading.trim() === '' || /[\r\n]/.test(heading)) {
        throw new Error(`${source}: extraSections must be an array of non-empty, single-line headings.`)
      }
      extraSections.push(heading)
    }
  }
  let maxAgents: number | null = null
  if (maxAgentsValue !== undefined && maxAgentsValue !== null) {
    if (typeof maxAgentsValue !== 'number' || !Number.isSafeInteger(maxAgentsValue) || maxAgentsValue < 0) {
      throw new Error(`${source}: maxAgents must be a non-negative whole number or null.`)
    }
    maxAgents = maxAgentsValue
  }
  if (autoPromoteValue !== undefined && typeof autoPromoteValue !== 'boolean') {
    throw new Error(`${source}: autoPromote must be true or false.`)
  }
  const autoPromote = autoPromoteValue ?? DEFAULT_VAULT_CONFIG.autoPromote
  return { workItemFolder, defaultRoot, extraSections, maxAgents, autoPromote }
}
