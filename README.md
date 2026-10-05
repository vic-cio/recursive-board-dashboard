# Recursive Board Dashboard

An example dashboard for [Recursive Board](https://github.com/vic-cio/recursive-board). It is an
Obsidian plugin that shows one page over every board in a vault.

**This is an example to copy.** It has no releases and no listing in Obsidian's community
plugins. Copy the repo, change it to suit your vault, and build it yourself. Recursive Board stays
small on purpose, so each vault can have the dashboard it needs.

## What it shows

The ribbon's dashboard icon, or the command **Open dashboard**, opens the page. Pick a root board
to narrow it. It shows five panels:

- **For review.** Cards that you own, that have no open child and that are not done, whose newest
  `**Review:**` note follows the last verdict note. Each row opens a file the note lists. Tick each
  file when you have looked. When every file of a card is ticked, **Approve** or **Send back**
  records your verdict. A card that lists no file has its own row to tick. Web pages have no tick.
- **Progress.** Done cards out of all cards, for each top area. Click an area to see the areas
  inside it, and to narrow the other panels to it.
- **Agents.** Claimed cards: working, idle for an hour, or recently finished, with the active
  count and the limit. A claim whose open children are all in doing, or that waits for a review
  verdict, does not count. A card with `holder: agent` waits here for a worker.
- **People.** Open cards grouped by the person who holds them. It starts folded.
- **Needs attention.** Cards that started before a dependency finished, wait on an archived card,
  or have an idle agent claim.

On a phone, a link opens in the same tab. On a desktop, it opens in a new tab.

## Settings

- **Your name.** The owner name on cards that wait for your review. Pick a person note
  (`type: person`) or type a name.
- **Web pages in For review.** Open web rows in a Web viewer tab, in the browser, or hide them.

Your name, the root, the focus and the folds belong to the device. Review ticks are stored per
person in this plugin's `data.json`, so Obsidian Sync carries them to your other devices. On its
first load, the dashboard copies the ticks that Recursive Board kept before the dashboard moved
out of it.

## How it works

The dashboard reads the card files through Obsidian. It never runs `wi`, because a phone cannot
run a CLI. It reads the card folder, the default root and the agent limit from Recursive Board's
plugin data, and writes nothing there.

`src/rules/` holds copies of the Recursive Board rules it needs, so a verdict makes the same edit
as `wi approve` and `wi send-back`. `src/rules/README.md` says how to refresh them.

`wi` gives an agent the same facts: `wi agents` for the agent count and limit, `wi children` and
`wi show --json` for the cards, and `wi review`, `wi approve` and `wi send-back` for the review
loop.

## Build and install

Node 22.18 or later runs the TypeScript directly.

```sh
npm install
npm test
npm run build
npm run install:vault -- --vault /path/to/vault
```

Then turn on **Recursive Board Dashboard** in Obsidian's community plugins. It needs Recursive
Board in the same vault. Reload Obsidian on a desktop. Force-quit and reopen it on a phone.

The plugin must load on iOS, so nothing in `src/` may import from Node. The build fails on such an
import, and `src/ios-safety.test.ts` checks the source and the bundle.

## Licence

MIT
