const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

test('Photoshop worker preserves PSD-authored schedule dot visibility', () => {
  const enginePath = path.resolve(__dirname, '../photoshop-worker/src/ps-engine.js');
  const engine = fs.readFileSync(enginePath, 'utf8');

  expect(engine).not.toContain('scheduleDot');
  expect(engine).not.toContain('setLayerVisible');
});
