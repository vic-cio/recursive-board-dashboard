import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cardState } from './card-state.ts'
import { applyEdits } from './edits.ts'
import { ANY_AGENT, clearHolderEdits, holderLabel, holderOf, isAnyAgent, setHolderEdits } from './holder.ts'
import { claimEdits, releaseEdits } from './transitions.ts'

const card = (fields: string) => `---\ntype: work-item\nid: wi-a1\ntitle: Price the job\n${fields}updated: 2026-09-30\n---\n\nBody\n`
const lookup = (fields: Record<string, unknown>) => (key: string) => fields[key]

test('holderOf reads holder, and an old card\'s agent when holder is absent', () => {
  assert.equal(holderOf(lookup({ holder: 'Ana' })), 'Ana')
  assert.equal(holderOf(lookup({ agent: 'codex-x' })), 'codex-x', 'an old card keeps its holder')
  assert.equal(holderOf(lookup({ holder: 'Ana', agent: 'codex-x' })), 'Ana', 'a card with both uses holder')
  assert.equal(holderOf(lookup({ holder: '  ', agent: 'codex-x' })), 'codex-x', 'a blank holder is no holder')
  assert.equal(holderOf(lookup({ holder: 3 })), undefined)
  assert.equal(holderOf(lookup({})), undefined)
})

test('cardState reads the holder through the same rule', () => {
  assert.equal(cardState(card('status: doing\nagent: alpha\n')).holder, 'alpha')
  assert.equal(cardState(card('status: doing\nholder: beta\nagent: alpha\n')).holder, 'beta')
  assert.equal(cardState(card('status: doing\nholder: ""\n')).holder, undefined)
})

test('agent is the reserved holder that means any agent', () => {
  assert.equal(ANY_AGENT, 'agent')
  assert.deepEqual(['agent', ' Agent ', 'agents', undefined].map(isAnyAgent), [true, true, false, false])
  assert.equal(holderLabel('agent'), 'Agent')
  assert.equal(holderLabel('Ana'), 'Ana')
})

test('setting the holder writes holder and drops the old agent key in the same write', () => {
  assert.deepEqual(setHolderEdits('Ana'), [{ op: 'set', key: 'holder', value: 'Ana' }, { op: 'remove', key: 'agent' }])
  const out = applyEdits(card('status: options\nagent: codex-x\nmystery: keep\n'), setHolderEdits('Ana'))
  assert.match(out, /^holder: Ana$/m)
  assert.doesNotMatch(out, /^agent:/m)
  assert.match(out, /^mystery: keep$/m)
  assert.deepEqual(clearHolderEdits(), [{ op: 'remove', key: 'holder' }, { op: 'remove', key: 'agent' }])
})

test('a claim writes holder, and a claim on an old card moves its agent to holder', () => {
  assert.deepEqual(claimEdits('options', undefined, 'w1', false, false), [
    { op: 'set', key: 'status', value: 'doing' },
    { op: 'set', key: 'holder', value: 'w1' }, { op: 'remove', key: 'agent' },
  ])
  // The holder starts its own card: only the status moves.
  assert.deepEqual(claimEdits('options', 'w1', 'w1', false, false), [{ op: 'set', key: 'status', value: 'doing' }])
  assert.equal(claimEdits('doing', 'w1', 'w1', false, false), null)
  assert.throws(() => claimEdits('options', 'w2', 'w1', false, false), /already claimed by w2/)
})

test('any worker\'s claim replaces holder: agent with its own name', () => {
  assert.deepEqual(claimEdits('options', 'agent', 'w1', false, false), [
    { op: 'set', key: 'status', value: 'doing' },
    { op: 'set', key: 'holder', value: 'w1' }, { op: 'remove', key: 'agent' },
  ])
  assert.deepEqual(claimEdits('doing', 'agent', 'w1', false, false), [
    { op: 'set', key: 'holder', value: 'w1' }, { op: 'remove', key: 'agent' },
  ])
})

test('a claim refuses the reserved name agent as a claimant', () => {
  assert.throws(() => claimEdits('options', undefined, 'agent', false, false), /reserved/)
  assert.throws(() => claimEdits('options', undefined, 'Agent', false, false), /reserved/)
})

test('a release clears holder and the old agent key', () => {
  assert.deepEqual(releaseEdits('doing', false), [
    { op: 'set', key: 'status', value: 'options' },
    { op: 'remove', key: 'holder' }, { op: 'remove', key: 'agent' },
  ])
})
