/**
 * Drives a complete guest purchase through the real UI: add to cart from a
 * product page, fill the checkout form, place the order, and land on the
 * confirmation page. Proves the React app is wired to the API, not just that
 * the API works on its own.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = 9222;
const ORIGIN = 'http://127.0.0.1:5173';
const OUT = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl).webSocketDebuggerUrl;
}

function connect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
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
      }));
  });
}

const steps = [];
const log = (ok, msg) => {
  steps.push({ ok, msg });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};

async function main() {
  const cdp = await connect(await target());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1700, deviceScaleFactor: 1, mobile: false,
  });

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const go = async (url, settle = 3000) => {
    await cdp.send('Page.navigate', { url });
    await sleep(settle);
  };
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(OUT, name), Buffer.from(s.data, 'base64'));
  };
  // Clicks the first element whose visible text matches, the way a person would.
  const clickText = async (selector, text) => ev(`
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()
  `);
  const setInput = async (label, value) => ev(`
    (() => {
      const lab = [...document.querySelectorAll('label.ts-label')]
        .find(l => l.textContent.trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}));
      if (!lab) return false;
      const el = document.getElementById(lab.getAttribute('for'));
      if (!el) return false;
      const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement : window.HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);

  // ── 1 · product page → add to cart ───────────────────────────────
  await go(`${ORIGIN}/product/hc-sr04-ultrasonic-distance-sensor`, 3600);
  const name = await ev(`document.querySelector('h1')?.textContent ?? ''`);
  log(name.includes('HC-SR04'), `product page loaded: ${name.trim()}`);

  await clickText('button.ts-btn', 'add to cart');
  await sleep(2200);
  const cartCount = await ev(
    `[...document.querySelectorAll('.ts-navicon__count')].pop()?.textContent ?? '0'`,
  );
  log(Number(cartCount) >= 1, `cart badge shows ${cartCount} after add to cart`);
  await shot('flow-01-cart-drawer.png');

  // ── 2 · checkout ─────────────────────────────────────────────────
  await go(`${ORIGIN}/checkout`, 3600);
  log(await ev(`!!document.body.textContent.includes('Getting your order')`), 'checkout page rendered');

  await setInput('username', 'Asha Mwinyi');
  await setInput('phone', '0754112233');
  await setInput('email', 'asha@example.com');
  await sleep(400);

  // pick the upcountry method, which requires a delivery address
  await ev(`
    (() => {
      const r = [...document.querySelectorAll('input[name="shipping"]')];
      const label = r.map(i => i.closest('label'));
      const idx = label.findIndex(l => l && l.textContent.includes('Savings'));
      if (idx < 0) return false;
      r[idx].click();
      return true;
    })()
  `);
  await sleep(1400);

  await setInput("receiver's name", 'Asha Mwinyi');
  await setInput('phone', '0754112233');
  await setInput('region', 'MWANZA');
  await sleep(1300);
  await setInput('district', 'Nyamagana');
  await setInput('street address', 'Plot 44, Nyakato Road');
  await sleep(400);

  await ev(`
    (() => {
      const r = [...document.querySelectorAll('input[name="pm"]')];
      if (!r.length) return false;
      r[0].click();
      return true;
    })()
  `);
  await sleep(900);
  await setInput('payment number', '0754112233');
  await sleep(500);
  await shot('flow-02-checkout.png');

  const totalText = await ev(`
    [...document.querySelectorAll('.ts-panel div')]
      .filter(d => d.textContent.trim().startsWith('Total'))
      .map(d => d.textContent.trim())[0] ?? ''
  `);
  log(totalText.includes('TZS'), `order total computed on screen: ${totalText}`);

  // ── 3 · place the order ──────────────────────────────────────────
  await clickText('button.ts-btn', 'place order');
  await sleep(5000);

  const url = await ev('location.pathname');
  const confirmed = url.startsWith('/order/confirmation/');
  log(confirmed, `redirected to confirmation: ${url}`);

  if (confirmed) {
    const height = await ev('Math.min(4000, document.body.scrollHeight)');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(600);
    await shot('flow-03-confirmation.png');
    const body = await ev('document.body.textContent');
    log(body.includes('Order placed'), 'confirmation shows "Order placed"');
    log(/TS-\d{4}-\d{6}/.test(body), `order number rendered: ${(body.match(/TS-\d{4}-\d{6}/) ?? ['none'])[0]}`);
    log(body.includes('Lipa namba') || body.includes('Pay exactly'), 'payment instructions shown');
  }

  cdp.close();
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n${steps.length - failed}/${steps.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('flow error:', e.message);
  process.exit(1);
});
