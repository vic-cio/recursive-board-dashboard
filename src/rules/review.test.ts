import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseReviewLine } from './dashboard.ts'
import { applyReviewRequest, applyVerdict, awaitsReviewVerdict } from './review.ts'

const card = [
  '---',
  'type: work-item',
  'id: wi-a7f3',
  'title: Price the lines',
  'status: doing',
  'parent: "[[Quote]]"',
  'owner: Ana',
  'agent: codex',
  'updated: 2026-09-20',
  '---',
  '',
  '## Notes',
  '',
  "- 2026-09-20 10:00, codex: **Review:** Check the totals: `Work/quote.xlsx`",
  '',
  '## Knowledge',
  '',
  '- ',
  '',
].join('\n')

const now = new Date(2026, 8, 28, 15, 4)

test('send for review sets the owner and appends a dated Review line with the files in one result', () => {
  const after = applyReviewRequest(card, { to: 'Ana', files: ['Work/quote.xlsx', 'Docs/check.md'], writer: 'Writer', now })
  assert.match(after, /^owner: Ana$/m)
  assert.ok(after.includes('- 2026-09-28 15:04, Writer: **Review:** Please review `Work/quote.xlsx`, `Docs/check.md`.\n'))
  assert.equal(after.match(/^owner:/gm)?.length, 1)
  assert.match(after, /^agent: codex$/m)
})

test('send for review puts what to check before the files, on one line', () => {
  const after = applyReviewRequest(card, { to: 'Ana', files: ['Work/quote.xlsx'], note: 'Check the totals.\nAnd the VAT.', now })
  assert.ok(after.includes('**Review:** Check the totals. And the VAT: `Work/quote.xlsx`\n'))
  assert.equal(parseReviewLine(after)?.what, 'Check the totals. And the VAT')
  assert.ok(applyReviewRequest(card, { to: 'Ana', note: '  Try it on the phone. ', now }).includes('**Review:** Try it on the phone.\n'))
  assert.ok(applyReviewRequest(card, { to: 'Ana', note: ' ', now }).includes('**Review:** Please review.\n'))
})

test('send for review needs an owner and makes a one-line note', () => {
  assert.throws(() => applyReviewRequest(card, { to: ' ', now }), /person/)
  assert.throws(() => applyReviewRequest(card, { to: 'Ana', files: ['a\nb'], now }), /one line/)
})

test('only the last Review or verdict note decides whether review is waiting', () => {
  const notes = (lines: string) => `---\ntype: work-item\n---\n\n## Objective\n\n**Review:** in body is not a note.\n\n## Notes\n\n${lines}`
  assert.equal(awaitsReviewVerdict(notes('- **Review:** Check this.\n')), true)
  assert.equal(awaitsReviewVerdict(notes('- **Review:** Check this.\n- Approved by Ana.\n')), false)
  assert.equal(awaitsReviewVerdict(notes('- **Review:** First.\n- Sent back by Ana.\n- **Review:** Again.\n')), true)
  assert.equal(awaitsReviewVerdict(notes('- Approved by Ana.\n')), false)
  assert.equal(awaitsReviewVerdict('## Objective\n\n- **Review:** Not sent.\n'), false)
})

test('approve notes who approved and closes the card', () => {
  const after = applyVerdict(card, { verdict: 'approve', you: 'Ana' }, now)
  assert.match(after, /^status: done$/m)
  assert.match(after, /^prev_status: doing$/m)
  assert.match(after, /^owner: Ana$/m)
  assert.match(after, /^updated: 2026-09-28$/m)
  assert.ok(after.includes('`Work/quote.xlsx`\n- 2026-09-28 15:04: Approved by Ana.\n\n## Knowledge'))
})

test('send back notes the comment and hands the card back to its agent', () => {
  const after = applyVerdict(card, { verdict: 'send back', you: 'Ana', comment: ' Recheck the VAT. ' }, now)
  assert.match(after, /^status: doing$/m)
  assert.doesNotMatch(after, /^owner:/m)
  assert.match(after, /^agent: codex$/m)
  assert.ok(after.includes('- 2026-09-28 15:04: Sent back by Ana: Recheck the VAT.\n\n## Knowledge'))
})

test('a blank send back notes no comment and still hands the card back', () => {
  const after = applyVerdict(card, { verdict: 'send back', you: 'Ana', comment: '  ' }, now)
  assert.doesNotMatch(after, /^owner:/m)
  assert.ok(after.includes('- 2026-09-28 15:04: Sent back by Ana.\n\n## Knowledge'))
})

test('a send back comment is one line', () => {
  assert.throws(() => applyVerdict(card, { verdict: 'send back', you: 'Ana', comment: 'a\nb' }, now), /one line/)
})

test('a verdict needs your name and a card in doing', () => {
  assert.throws(() => applyVerdict(card, { verdict: 'approve', you: ' ' }, now), /your name/)
  const done = card.replace('status: doing', 'status: done')
  assert.throws(() => applyVerdict(done, { verdict: 'approve', you: 'Ana' }, now), /in doing/)
})

test('a verdict comes only from the person the card waits on', () => {
  assert.throws(() => applyVerdict(card, { verdict: 'approve', you: 'Bo' }, now), /waits for review by Ana, not Bo/)
  assert.throws(() => applyVerdict(card, { verdict: 'send back', you: 'Bo', comment: '' }, now), /by Ana, not Bo/)
  // The name matches as the dashboard matches it: case and outer spaces do not count.
  assert.match(applyVerdict(card, { verdict: 'approve', you: ' ana ' }, now), /Approved by ana\./)
  const linked = card.replace('owner: Ana', 'owner: "[[Ana]]"')
  assert.match(applyVerdict(linked, { verdict: 'approve', you: 'Ana' }, now), /^status: done$/m)
  const noOwner = card.replace('owner: Ana\n', '')
  assert.throws(() => applyVerdict(noOwner, { verdict: 'approve', you: 'Ana' }, now), /no one is asked to review/)
})

test('a verdict needs an open review request', () => {
  const approved = applyVerdict(card, { verdict: 'approve', you: 'Ana' }, now).replace('status: done', 'status: doing')
  assert.throws(() => applyVerdict(approved, { verdict: 'approve', you: 'Ana' }, now), /no review request waits/)
  const never = card.replace(/^- .*\*\*Review:\*\*.*\n/m, '')
  assert.throws(() => applyVerdict(never, { verdict: 'send back', you: 'Ana', comment: '' }, now), /no review request waits/)
})

test('a verdict note names who wrote it when a writer is given', () => {
  const after = applyVerdict(card, { verdict: 'approve', you: 'Ana', writer: 'Worker x (model-1)' }, now)
  assert.ok(after.includes('- 2026-09-28 15:04, Worker x (model-1): Approved by Ana.\n'))
  assert.equal(awaitsReviewVerdict(after), false)
  const back = applyVerdict(card, { verdict: 'send back', you: 'Ana', comment: 'Redo it.', writer: 'Worker x' }, now)
  assert.ok(back.includes('- 2026-09-28 15:04, Worker x: Sent back by Ana: Redo it.\n'))
})
