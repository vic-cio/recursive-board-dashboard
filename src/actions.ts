/**
 * The dashboard's one write: a review verdict. It applies the same edit as `wi approve` and
 * `wi send-back`, from the copied rules in `src/rules/review.ts`, as one write to the card file.
 */
import { Notice, type App } from 'obsidian'

import type { Card } from './cards.ts'
import { applyVerdict, type Verdict } from './rules/review.ts'

export class Actions {
  private readonly app: App

  constructor(app: App) {
    this.app = app
  }

  /** Approve or send back a card that waits for your review. Returns true when it was written. */
  async review(card: Card, verdict: Verdict): Promise<boolean> {
    const what = verdict.verdict === 'approve' ? `approve ${card.title}` : `send back ${card.title}`
    try {
      let before = ''
      const after = await this.app.vault.process(card.file, (data) => {
        before = data
        return applyVerdict(data, verdict)
      })
      this.undoableNotice(verdict.verdict === 'approve' ? `Approved ${card.title}` : `Sent back ${card.title}`,
        () => this.undo(card, before, after, what))
      return true
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      new Notice(`The dashboard could not ${what}: ${reason}`)
      return false
    }
  }

  /** Puts the card back as it was, unless something changed it after the verdict. */
  private async undo(card: Card, before: string, after: string, what: string): Promise<void> {
    let changed = false
    await this.app.vault.process(card.file, (data) => {
      if (data !== after) {
        changed = true
        return data
      }
      return before
    })
    new Notice(changed ? `The card changed after you chose to ${what}, so nothing was undone.` : `Undid: ${what}`)
  }

  private undoableNotice(message: string, undo: () => Promise<void>): void {
    const fragment = createFragment((f) => {
      f.createSpan({ text: `${message}. ` })
      const link = f.createEl('a', { text: 'Undo', href: '#' })
      link.addEventListener('click', (event) => {
        event.preventDefault()
        notice.hide()
        void undo()
      })
    })
    const notice = new Notice(fragment, 6000)
  }
}
