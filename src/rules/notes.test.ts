import { test } from 'node:test'
import assert from 'node:assert/strict'

import { appendNote, noteLine } from './notes.ts'

test('appendNote adds a line after a bare Notes heading', () => {
  assert.equal(appendNote('## Notes', '- Released.'), '## Notes\n\n- Released.\n')
})

test('appendNote accepts an indented Notes heading', () => {
  const before = '  ## Notes\n\nHuman note.\n'
  assert.equal(appendNote(before, '- Released.'), '  ## Notes\n\nHuman note.\n- Released.\n')
})

test('appendNote preserves CRLF and keeps the next section separate', () => {
  const before = '## Notes\r\n\r\nHuman note.\r\n\r\n## Next\r\nKeep this.\r\n'
  const after = appendNote(before, '- Released.')
  assert.equal(after, '## Notes\r\n\r\nHuman note.\r\n- Released.\r\n\r\n## Next\r\nKeep this.\r\n')
})

test('appendNote ignores a Notes heading inside a code fence', () => {
  const before = '## Objective\n\n```md\n## Notes\nExample.\n```\n\n## Notes\n\nHuman note.\n'
  const after = appendNote(before, '- Released.')
  assert.equal(after, '## Objective\n\n```md\n## Notes\nExample.\n```\n\n## Notes\n\nHuman note.\n- Released.\n')
})

test('appendNote keeps an info-string fence open across a fence-like line', () => {
  const before = '## Objective\n\n```md\nExample.\n```js\n## Notes\nExample note.\n## Knowledge\n- Example knowledge.\n```\n\n## Notes\n\nHuman note.\n'
  const after = appendNote(before, '- Released.')
  assert.equal(after, `${before.slice(0, before.length - 'Human note.\n'.length)}Human note.\n- Released.\n`)
})

test('noteLine stamps the local date and time and names the agent', () => {
  const now = new Date(2026, 8, 25, 9, 5)
  assert.equal(noteLine(' Priced it. ', 'codex', now), '- 2026-09-25 09:05, codex: Priced it.')
  assert.equal(noteLine('Priced it.', undefined, now), '- 2026-09-25 09:05: Priced it.')
})

test('noteLine refuses empty or multi-line text', () => {
  assert.throws(() => noteLine('  '), /needs text/)
  assert.throws(() => noteLine('one\ntwo'), /one line/)
})

test('appendNote leaves a blank line under an empty Notes heading', () => {
  assert.equal(appendNote('## Notes\n', '- A.'), '## Notes\n\n- A.\n')
  assert.equal(appendNote('## Notes\n\n## Knowledge\n\n- \n', '- A.'), '## Notes\n\n- A.\n\n## Knowledge\n\n- \n')
})
