import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian'

import type { WebReviewMode } from './rules/dashboard.ts'

/** What the settings tab reads and writes. Both choices belong to this device. */
export interface SettingsHost {
  you(): string
  changeYou(you: string): Promise<void>
  webReviewMode(): WebReviewMode
  changeWebReviewMode(mode: WebReviewMode): Promise<void>
  personNames(): string[]
}

export class DashboardSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost

  constructor(app: App, plugin: Plugin, host: SettingsHost) {
    super(app, plugin)
    this.host = host
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()
    new Setting(containerEl)
      .setName('Your name')
      .setDesc('The owner name on cards that wait for your review. The dashboard lists a card that you own, that has no open child and that is not done.')
      .addText((text) => {
        const list = containerEl.createEl('datalist')
        list.id = 'recursive-board-dashboard-person-names'
        for (const name of this.host.personNames()) list.createEl('option', { attr: { value: name } })
        text.inputEl.setAttribute('list', list.id)
        text.setPlaceholder('Name')
          .setValue(this.host.you())
          .onChange((value) => void this.host.changeYou(value.trim()))
      })
    new Setting(containerEl)
      .setName('Web pages in For review')
      .addDropdown((dropdown) => dropdown
        .addOption('webviewer', 'Open in a Web viewer tab')
        .addOption('browser', 'Open in the browser')
        .addOption('off', 'Off')
        .setValue(this.host.webReviewMode())
        .onChange((value) => {
          if (value === 'webviewer' || value === 'browser' || value === 'off') void this.host.changeWebReviewMode(value)
        }))
  }
}
