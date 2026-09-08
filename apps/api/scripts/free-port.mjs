/**
 * Frees the API port before the server starts.
 *
 * A crashed or orphaned `tsx watch` keeps its listener open, and the next
 * `npm run dev` then dies with EADDRINUSE — an error about the port that says
 * nothing about the cause. This clears the stale listener and reports what it
 * did, so the common case needs no intervention.
 *
 * It only ever touches a process listening on our own configured port.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readPort() {
  for (const file of [
    path.resolve(HERE, '..', '..', '..', '.env'),
    path.resolve(HERE, '..', '.env'),
  ]) {
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^\s*API_PORT\s*=\s*"?(\d+)"?/m);
    if (m) return Number(m[1]);
  }
  return 4100;
}

const PORT = Number(process.env.API_PORT) || readPort();

function pidsOnPort() {
  const pids = new Set();
  try {
    // netstat is present on every Windows install; no PowerShell startup cost.
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] ?? '';
      const pid = Number(cols[cols.length - 1]);
      // Match :PORT at the end of the local address, not a substring of it.
      if (new RegExp(`[:.]${PORT}$`).test(local) && Number.isFinite(pid) && pid > 0) {
        pids.add(pid);
      }
    }
  } catch {
    /* not Windows, or netstat unavailable — nothing to clear */
  }
  return [...pids];
}

const held = pidsOnPort();

if (held.length === 0) {
  process.exit(0);
}

for (const pid of held) {
  if (pid === process.pid) continue;
  try {
    process.kill(pid);
    console.log(`[free-port] cleared a stale listener on ${PORT} (pid ${pid})`);
  } catch (err) {
    // EPERM means it is not ours to stop — say so rather than failing silently.
    console.warn(
      `[free-port] port ${PORT} is held by pid ${pid} and could not be stopped: ${err.code ?? err.message}.\n` +
      `            Stop it yourself, or set API_PORT in .env to a free port.`,
    );
  }
}

// Give Windows a moment to release the socket before the server binds.
const until = Date.now() + 4000;
while (pidsOnPort().length > 0 && Date.now() < until) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
}
