'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const net = require('net');
const path = require('path');

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

async function readLock(lockPath) {
  try {
    const value = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function lockPortFor(value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest();
  return 41000 + (digest.readUInt32BE(0) % 20000);
}

function listenExclusive(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function writeLockMetadata(lockPath, metadata) {
  const temporaryPath = `${lockPath}.${metadata.pid}.${metadata.token}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(metadata)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, lockPath);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function acquireSingleInstance(lockPath, options = {}) {
  const pid = options.pid || process.pid;
  const token = crypto.randomUUID();
  const port = options.port || lockPortFor(options.workspace || lockPath);
  const metadata = {
    pid,
    token,
    port,
    workspace: options.workspace || null,
    startedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(lockPath), 0o700);

  const server = net.createServer();
  try {
    await listenExclusive(server, port);
  } catch (error) {
    server.close();
    if (error.code !== 'EADDRINUSE') throw error;
    const current = await readLock(lockPath);
    const duplicate = new Error(current && processIsAlive(Number(current.pid))
      ? `Mac Agent 已经在运行（PID ${current.pid}）`
      : `Mac Agent 单实例端口 ${port} 已被占用`);
    duplicate.code = 'AGENT_ALREADY_RUNNING';
    duplicate.pid = current?.pid || null;
    throw duplicate;
  }

  try {
    await writeLockMetadata(lockPath, metadata);
  } catch (error) {
    await closeServer(server).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    metadata,
    async release() {
      if (released) return;
      released = true;
      const current = await readLock(lockPath);
      if (current && current.pid === pid && current.token === token) {
        await fs.unlink(lockPath).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      await closeServer(server);
    },
  };
}

module.exports = { acquireSingleInstance, lockPortFor, processIsAlive, readLock };
