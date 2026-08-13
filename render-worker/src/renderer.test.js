'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { cleanSchedule, textValue } = require('./renderer');

test('first schedule row never carries a speaker', () => {
  const rows = cleanSchedule([
    { time: '19:00-19:10', content: '开场致辞', speaker: '错误讲者', chair: '张三 教授' },
  ]);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].speaker, '');
  assert.equal(rows[0].chair, '张三 教授');
});

test('text slot composes prefix and suffix around meeting value', () => {
  assert.equal(textValue({ source: 'chair.name', prefix: '[', suffix: '] 教授' }, { chair: { name: '张三' } }), '[张三] 教授');
  assert.equal(textValue({ source: 'chair.name', suffix: ' 教授' }, { chair: { name: '' } }), '');
});
