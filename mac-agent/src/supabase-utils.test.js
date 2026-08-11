'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { boundedErrorMessage, checkedResult, isMissingRpcError } = require('./supabase-utils');

test('recognizes only missing RPC errors for the expected function', () => {
  assert.equal(isMissingRpcError({ code: 'PGRST202', message: 'Could not find recover_stale_poster_jobs' }, 'recover_stale_poster_jobs'), true);
  assert.equal(isMissingRpcError({ code: '42883', message: 'function claim_next_poster_job does not exist' }, 'claim_next_poster_job'), true);
  assert.equal(isMissingRpcError({ code: '42501', message: 'permission denied' }, 'claim_next_poster_job'), false);
  assert.equal(isMissingRpcError({ code: 'PGRST202', message: 'Could not find another_function' }, 'claim_next_poster_job'), false);
});

test('checkedResult never treats a returned Supabase error as success', () => {
  assert.equal(checkedResult({ data: { id: 1 }, error: null }, '读取').id, 1);
  assert.throws(
    () => checkedResult({ data: null, error: { code: '42501', message: 'permission denied', hint: 'grant select' } }, '更新'),
    /42501.*permission denied.*grant select/,
  );
  assert.throws(() => checkedResult({ data: null, error: null }, '更新', { requireData: true }), /状态已变化/);
});

test('boundedErrorMessage strips unsafe controls and limits database text', () => {
  const value = boundedErrorMessage(new Error(`bad\u0000${'x'.repeat(200)}`), '阶段：', 40);
  assert.equal(value.length, 40);
  assert.equal(value.includes('\u0000'), false);
  assert.match(value, /^阶段：bad /);
});
