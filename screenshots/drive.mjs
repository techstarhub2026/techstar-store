/**
 * Minimal Chrome DevTools Protocol driver — no dependencies, uses Node's
 * built-in WebSocket. Used to sign in through the real UI and capture the
 * admin console, which is behind an httpOnly refresh cookie.
 *
 *   node drive.mjs <outputPrefix> <path> [<path> ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = 9222;
const ORIGIN = 'http://127.0.0.1:5173';
const OUT = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));

async function cdpTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no CDP target');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          id += 1;
          const mid = id;
          return new Promise((res, rej) => {
            pending.set(mid, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [prefix, ...paths] = process.argv.slice(2);
  const ws = await cdpTarget();
  const cdp = await connect(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false,
  });

  const go = async (url, settle = 2600) => {
    await cdp.send('Page.navigate', { url });
    await sleep(settle);
  };
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  // 1 ─ sign in through the API from the page origin so the refresh cookie
  //     lands in the browser jar exactly as it does for a real user.
  await go(`${ORIGIN}/`);
  const login = await evaluate(`
    fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@techstar.co.tz', password: 'TechStar#2026' })
    }).then(r => r.json()).then(b => b.data.user.username)
  `);
  console.log('signed in as', login);

  // 2 ─ capture each requested path
  for (const [i, p] of paths.entries()) {
    const url = `${ORIGIN}${p}`;
    await go(url, 3800);
    const height = await evaluate(
      'Math.min(6000, Math.max(document.body.scrollHeight, 900))',
    );
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(700);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${prefix}-${String(i + 1).padStart(2, '0')}.png`);
    await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
    console.log('captured', p, '→', path.basename(file), `(${height}px)`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false,
    });
  }

  cdp.close();
}

main().catch((e) => {
  console.error('drive failed:', e.message);
  process.exit(1);
});
