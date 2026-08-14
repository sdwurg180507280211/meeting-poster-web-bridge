'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('claimed jobs are not renewed after an agent restart', () => {
  const agentSource = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');

  assert.match(agentSource, /\.in\('status', \['rendering', 'uploading'\]\)/);
  assert.doesNotMatch(agentSource, /\.in\('status', \['claimed', 'rendering', 'uploading'\]\)/);
});
