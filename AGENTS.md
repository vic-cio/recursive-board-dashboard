# Recursive Board Dashboard

An example Obsidian dashboard for Recursive Board. People copy it and change it. It has no
releases and no community listing.

## Rules

- **It must load on iOS.** Nothing in `src/` imports from Node. `build/forbidden-imports.mjs`
  fails the build, and `src/ios-safety.test.ts` scans the source and the bundle.
- **It never runs `wi`.** It reads card files through Obsidian's metadata cache and vault API.
- **`src/rules/` is a copy.** Keep each file except `dashboard.ts` the same as Recursive Board's
  `src/shared/`, so a verdict here makes the same edit as `wi approve`. Refresh by copying.
- **It reads Recursive Board's plugin data and never writes it.** Its own state goes in its own
  `data.json` and in Obsidian's per-device local storage.

## Working here

`npm test` typechecks and runs every test. `npm run build` writes `dist/`. Verify a view change
by loading the plugin in a test vault next to Recursive Board, and looking.
