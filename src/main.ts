/**
 * Recursive Board Dashboard: one page over every Recursive Board in the vault.
 *
 * It reads the card files through Obsidian and never runs `wi`, so it works on a phone. Nothing in
 * this bundle may import `node`, `fs`, `path` or `electron`: `build/forbidden-imports.mjs` fails the
 * build, and `src/ios-safety.test.ts` scans the source and the bundle.
 *
 * Device choices (your name, root, focus, folds) live in Obsidian's per-device local storage.
 * Review ticks live in this plugin's data, per person, so Obsidian Sync carries them to the phone.
 */
import { Notice, Plugin } from 'obsidian'

import { Actions } from './actions.ts'
import { boardDataPath, CardIndex, readBoardConfig } from './cards.ts'
import {
  applyTickChanges, parseDeviceDashboardState, personTicks, withCopiedPeople, withPersonTicks, type DashboardTicks,
} from './personal-state.ts'
import { DashboardSettingTab } from './settings.ts'
import { DASHBOARD_ICON, DASHBOARD_VIEW, DashboardView, type DashboardState } from './ui/dashboard-view.ts'

const STATE_KEY = 'recursive-board-dashboard:state'
/** Where Recursive Board kept these choices before the dashboard moved out of it. Read once, as a fallback. */
const CORE_STATE_KEY = 'recursive-board:dashboard'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {}
}

export default class RecursiveBoardDashboard extends Plugin {
  private index!: CardIndex
  private storedData: Record<string, unknown> = {}
  private state!: DashboardState
  /** The board settings could not be read. Shown once per change, not on every redraw. */
  private configProblem: string | null = null

  override async onload(): Promise<void> {
    this.index = new CardIndex(this.app)
    await this.loadState()
    const actions = new Actions(this.app)

    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, {
      index: this.index,
      loadCards: () => this.loadCards(),
      actions,
      state: () => this.state,
      save: (patch) => this.save(patch),
      personNames: () => this.personNames(),
      reloadTicks: () => this.reloadTicks(),
    }))
    this.addRibbonIcon(DASHBOARD_ICON, 'Open dashboard', () => void this.openDashboard())
    this.addCommand({ id: 'open', name: 'Open dashboard', icon: DASHBOARD_ICON, callback: () => void this.openDashboard() })
    this.addSettingTab(new DashboardSettingTab(this.app, this, {
      you: () => this.state.you,
      changeYou: (you) => this.save({ you }),
      webReviewMode: () => this.state.webReviewMode,
      changeWebReviewMode: (webReviewMode) => this.save({ webReviewMode }),
      personNames: () => this.personNames(),
    }))

    // Any change to a card, or to the board settings, redraws the open dashboard.
    const refresh = () => this.refreshDashboards()
    this.registerEvent(this.app.metadataCache.on('changed', refresh))
    this.registerEvent(this.app.metadataCache.on('resolved', refresh))
    this.registerEvent(this.app.vault.on('create', refresh))
    this.registerEvent(this.app.vault.on('delete', refresh))
    this.registerEvent(this.app.vault.on('rename', refresh))
  }

  /** Reads Recursive Board's board settings and every card. A bad settings file keeps the last good settings. */
  private async loadCards(): Promise<void> {
    try {
      this.index.rebuild(await readBoardConfig(this.app))
      this.configProblem = null
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.configProblem !== reason) new Notice(`The dashboard could not read the board settings: ${reason}`)
      this.configProblem = reason
      this.index.rebuild()
    }
  }

  /** Loads the device choices and this person's ticks. On the first load, takes over what Recursive Board kept. */
  private async loadState(): Promise<void> {
    this.storedData = record(await this.loadData())
    const corePath = boardDataPath(this.app)
    if (!('people' in this.storedData) && await this.app.vault.adapter.exists(corePath)) {
      try {
        const copied = withCopiedPeople(this.storedData, JSON.parse(await this.app.vault.adapter.read(corePath)))
        if (copied !== this.storedData) {
          this.storedData = copied
          await this.saveData(this.storedData)
        }
      } catch {
        // A file that is not JSON has no ticks to copy.
      }
    }
    const device = parseDeviceDashboardState(this.app.loadLocalStorage(STATE_KEY) ?? this.app.loadLocalStorage(CORE_STATE_KEY))
    this.state = { ...device, ticks: personTicks(this.storedData, device.you) }
  }

  private async save(patch: Partial<DashboardState>): Promise<void> {
    const previousTicks = this.state.ticks
    this.state = { ...this.state, ...patch, ...('you' in patch ? { ticks: personTicks(this.storedData, patch.you ?? '') } : {}) }
    if ('ticks' in patch) await this.saveTicks(patch.ticks ?? {}, previousTicks)
    const { you, root, focus, webReviewMode, finishedOpen, foldedGroups } = this.state
    this.app.saveLocalStorage(STATE_KEY, { you, root, focus, webReviewMode, finishedOpen, foldedGroups })
    // These change what the dashboard draws or how a row opens, so it redraws at once.
    if ('you' in patch || 'webReviewMode' in patch) this.refreshDashboards()
  }

  /** Reads the plugin data from disk again, so ticks synced from another device are current. */
  private async freshData(): Promise<Record<string, unknown>> {
    this.storedData = record(await this.loadData())
    return this.storedData
  }

  private async reloadTicks(): Promise<DashboardTicks> {
    this.state.ticks = personTicks(await this.freshData(), this.state.you)
    return this.state.ticks
  }

  /** Applies only this device's change to the stored ticks, so a tick made elsewhere survives. */
  private async saveTicks(ticks: DashboardTicks, previous: DashboardTicks): Promise<void> {
    const name = this.state.you
    if (name.trim() === '') return
    const data = await this.freshData()
    this.storedData = withPersonTicks(data, name, applyTickChanges(personTicks(data, name), previous, ticks))
    await this.saveData(this.storedData)
  }

  /** Obsidian calls this when Sync changes the plugin data, for example a tick made on the phone. */
  override async onExternalSettingsChange(): Promise<void> {
    await this.freshData()
    this.state.ticks = personTicks(this.storedData, this.state.you)
    this.refreshDashboards()
  }

  private personNames(): string[] {
    return this.app.vault.getMarkdownFiles()
      .filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.['type'] === 'person')
      .map((file) => file.basename)
      .sort((a, b) => a.localeCompare(b))
  }

  /** Reuses an open dashboard tab, like the graph view. */
  private async openDashboard(): Promise<void> {
    const { workspace } = this.app
    let leaf = workspace.getLeavesOfType(DASHBOARD_VIEW)[0]
    if (!leaf) {
      leaf = workspace.getLeaf('tab')
      await leaf.setViewState({ type: DASHBOARD_VIEW, active: true })
    }
    await workspace.revealLeaf(leaf)
  }

  private refreshDashboards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) {
      if (leaf.view instanceof DashboardView) leaf.view.refresh()
    }
  }
}
