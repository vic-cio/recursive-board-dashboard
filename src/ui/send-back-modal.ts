import { Modal, type App } from 'obsidian'

/** Offers the comment a send back writes to the card's Notes. The comment is optional; a note is one line. */
export class SendBackModal extends Modal {
  private readonly title: string
  private readonly submit: (comment: string) => void

  constructor(app: App, title: string, submit: (comment: string) => void) {
    super(app)
    this.title = title
    this.submit = submit
  }

  override onOpen(): void {
    this.contentEl.empty()
    this.contentEl.createEl('h2', { text: `Send back ${this.title}` })
    this.contentEl.createDiv({ cls: 'setting-item-description', text: 'Say what to change, or leave it blank. The agent reads it in the card’s Notes.' })
    const input = this.contentEl.createEl('textarea', { cls: 'wi-dash-send-back-comment', attr: { 'aria-label': 'Comment', rows: 4 } })
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' })
    const send = buttons.createEl('button', { text: 'Send back', cls: 'mod-cta' })
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close())
    const comment = () => input.value.replace(/\s+/g, ' ').trim()
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        this.submitAndClose(comment())
      }
    })
    send.addEventListener('click', () => this.submitAndClose(comment()))
    input.focus()
  }

  override onClose(): void {
    this.contentEl.empty()
  }

  private submitAndClose(comment: string): void {
    this.close()
    this.submit(comment)
  }
}
