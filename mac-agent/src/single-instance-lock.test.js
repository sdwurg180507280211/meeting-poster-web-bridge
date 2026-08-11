'use strict';

const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { acquireSingleInstance, lockPortFor, readLock } = require('./single-instance-lock');

test('only one concurrent contender acquires the OS-level lock', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poster-agent-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, 'mac-agent.lock');
  const port = lockPortFor(directory);

  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireSingleInstance(lockPath, { workspace: directory, port })),
  );
  const acquired = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(acquired.length, 1);
  assert.equal(rejected.length, 7);
  for (const result of rejected) assert.equal(result.reason.code, 'AGENT_ALREADY_RUNNING');

  const metadata = await readLock(lockPath);
  assert.equal(metadata.pid, process.pid);
  assert.equal(metadata.port, port);
  await acquired[0].value.release();

  const reacquired = await acquireSingleInstance(lockPath, { workspace: directory, port });
  await reacquired.release();
});

test('stale metadata cannot prevent a new owner when the OS lock is free', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poster-agent-stale-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, 'mac-agent.lock');
  await fs.writeFile(lockPath, '{"pid":999999,"token":"stale"}\n');

  const lock = await acquireSingleInstance(lockPath, { workspace: directory });
  const metadata = await readLock(lockPath);
  assert.equal(metadata.pid, process.pid);
  assert.notEqual(metadata.token, 'stale');
  await lock.release();
});
