'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { validateManifest } = require('./template');

test('chronic-care manifest is structurally valid without binary template files', () => {
  const file = path.resolve(__dirname, '..', 'templates', 'chronic-care-2026', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(validateManifest(manifest, 'chronic-care-2026').projectId, 'chronic-care-2026');
});

test('manifest rejects schedule rows outside fixed four-row template', () => {
  const file = path.resolve(__dirname, '..', 'templates', 'chronic-care-2026', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.schedule.rows = [1, 2, 3];
  assert.throws(() => validateManifest(manifest), /4 行/);
});
