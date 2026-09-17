import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, decide, startRun, stepRun } from './model.mjs';

test('a reason is required before confirming one proposition', () => {
  assert.throws(() => decide(createState(), 'timeout', 'code', ''), /依据/);
});
test('a decision records an unfamiliar reason and only its proposition', () => {
  const next = decide(createState(), 'timeout', 'code', 'sentinel-审核理由-83');
  assert.equal(next.decisions.length, 1);
  assert.equal(next.decisions[0].question, 'timeout');
  assert.equal(next.decisions[0].reason, 'sentinel-审核理由-83');
  assert.equal(next.decisions[0].state, 'human');
  assert.equal(next.revision, 4);
});
test('deferral is not human confirmation and does not revise the graph', () => {
  const next = decide(createState(), 'timeout', 'defer', '需业务确认');
  assert.equal(next.decisions[0].state, 'deferred');
  assert.equal(next.revision, 3);
});
test('deferral cannot silently revoke a previously confirmed proposition', () => {
  const confirmed = decide(createState(), 'timeout', 'code', '限定默认配置');
  assert.throws(() => decide(confirmed, 'timeout', 'defer', '再看一下'), /不能撤销/);
});
test('blocked preflight cannot start a run', () => {
  assert.throws(() => startRun(createState(), 'sample', false), /预检/);
});
test('pause freezes progress; cancelled run cannot become complete', () => {
  let state = startRun(createState(), 'sentinel-run-27', true);
  const id = state.runs[0].id;
  state = stepRun(state, id, 'pause');
  state = stepRun(state, id, 'advance');
  assert.equal(state.runs[0].progress, 0);
  state = stepRun(state, id, 'resume');
  state = stepRun(state, id, 'advance');
  assert.equal(state.runs[0].progress, 1);
  state = stepRun(state, id, 'cancel');
  state = stepRun(state, id, 'advance');
  assert.equal(state.runs[0].status, 'cancelled');
});
