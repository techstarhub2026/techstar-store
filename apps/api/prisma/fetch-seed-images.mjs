/**
 * Downloads real, openly-licensed product photography from Wikimedia Commons
 * for the demo catalogue, and records the attribution each file requires.
 *
 *   node prisma/fetch-seed-images.mjs
 *
 * Output: prisma/seed-images/<key>.jpg  +  prisma/seed-images/manifest.json
 *
 * Every image is CC-licensed or public domain. The manifest keeps the source
 * page, licence and author so attribution can be honoured — these are demo
 * assets, and TechStar must replace them with its own photography before the
 * catalogue goes live.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'seed-images');
const UA = 'TechStarStoreSeed/1.0 (https://techstar.co.tz; contact: admin@techstar.co.tz)';
const API = 'https://commons.wikimedia.org/w/api.php';

/** key → Commons search term. Keys are referenced by seed.ts. */
const WANTED = {
  'arduino-uno': 'Arduino Uno board',
  'arduino-nano': 'Arduino Nano',
  'arduino-mega': 'Arduino Mega 2560',
  'raspberry-pi-4': 'Raspberry Pi 4 Model B',
  'raspberry-pi-pico': 'Raspberry Pi Pico',
  'raspberry-pi-zero': 'Raspberry Pi Zero',
  'esp32': 'ESP32 development board',
  'esp8266': 'ESP8266 NodeMCU',
  breadboard: 'Solderless breadboard',
  resistor: 'Resistors electronic component',
  capacitor: 'Electrolytic capacitor',
  'ceramic-capacitor': 'Ceramic capacitor',
  inductor: 'Inductor coil component',
  led: 'Light emitting diodes',
  transistor: 'Transistor electronic component',
  diode: 'Rectifier diode',
  'ic-555': 'NE555 integrated circuit',
  'ic-7400': '7400 series integrated circuit',
  'ic-socket': 'DIP socket integrated circuit',
  potentiometer: 'Potentiometer electronics',
  'push-button': 'Tactile push button switch',
  'toggle-switch': 'Toggle switch electronics',
  keypad: 'Matrix membrane keypad',
  'servo-motor': 'Hobby servo motor',
  'stepper-motor': 'Stepper motor',
  'dc-motor': 'Small DC electric motor',
  relay: 'Electromechanical relay module',
  buzzer: 'Piezoelectric buzzer',
  'ultrasonic-sensor': 'HC-SR04 ultrasonic sensor',
  'temperature-sensor': 'DHT11 temperature humidity sensor',
  'ldr-sensor': 'Photoresistor light dependent resistor',
  'ir-sensor': 'Infrared receiver module',
  'lcd-display': 'Character LCD display module',
  'oled-display': 'OLED screen module electronics',
  'seven-segment': 'Seven segment LED display digit',
  'jumper-wires': 'Dupont jumper wire cable',
  'usb-cable': 'USB cable type A',
  'micro-sd': 'MicroSD memory card',
  'soldering-iron': 'Soldering iron',
  'solder-wire': 'Solder wire spool',
  multimeter: 'Digital multimeter',
  oscilloscope: 'Digital storage oscilloscope',
  'power-supply': 'Laboratory DC power supply unit',
  'function-generator': 'Signal generator laboratory equipment',
  'solar-panel': 'Photovoltaic solar panel small',
  'battery-18650': '18650 lithium ion battery',
  'battery-holder': 'Battery holder AA',
  pcb: 'Printed circuit board',
  'perfboard': 'Perfboard prototyping',
  'heat-sink': 'Heat sink electronics',
  'heat-shrink': 'Heat shrink tube electronics',
  'screwdriver-set': 'Screwdriver bit set tool',
  pliers: 'Needle nose pliers',
  tweezers: 'Tweezers hand tool',
  'wire-stripper': 'Wire stripper pliers',
  'glue-gun': 'Glue gun tool',
  drone: 'Quadcopter',
  'robot-kit': 'Educational robot toy',
  'rf-module': 'Radio transceiver module electronics',
  'gsm-module': 'GSM modem module',
  'gps-module': 'GPS receiver module',
  'bluetooth-module': 'Bluetooth module electronics',
  camera_module: 'Raspberry Pi camera module',
  'cctv-camera': 'Dome surveillance camera',
  'fingerprint-sensor': 'Fingerprint reader device',
  'load-cell': 'Load cell strain gauge',
  'buck-converter': 'DC DC buck converter module',
  'voltage-regulator': 'Voltage regulator TO-220 component',
  'connector-header': 'Pin header electronics',
  'terminal-block': 'Terminal block electrical connector',
  'ribbon-cable': 'Ribbon cable',
  'fuse': 'Electrical fuse cartridge',
  'transformer': 'Toroidal transformer electronics',
  'crystal-oscillator': 'Quartz crystal oscillator',
  'sd-card-module': 'SD card reader',
  'motor-driver': 'H bridge motor driver board',
  'logic-analyzer': 'Logic analyzer instrument',
  'calculator': 'Pocket calculator',
  keyboard: 'Mechanical computer keyboard',
  mouse: 'Optical computer mouse',
};

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function pickBest(pages) {
  const list = Object.values(pages || {});
  // Prefer JPEG/PNG raster photographs of a reasonable size, skip SVG diagrams.
  const scored = list
    .map((p) => {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl) return null;
      const title = (p.title || '').toLowerCase();
      if (/\.(svg|gif|webm|ogv|pdf|djvu|tif|tiff|xcf)$/.test(title)) return null;
      let score = 0;
      if (title.endsWith('.jpg') || title.endsWith('.jpeg')) score += 3;
      if (title.endsWith('.png')) score += 2;
      if ((info.width || 0) >= 800) score += 2;
      if (/diagram|schematic|symbol|chart|graph|logo|catalog|report|manual|guide|patent/.test(title)) score -= 8;
      if (/(iss0|nasa|substation|station|yacht|street|building)/.test(title)) score -= 6;
      return { page: p, info, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function meta(info, field) {
  const raw = info.extmetadata?.[field]?.value;
  if (!raw) return null;
  return String(raw).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const manifest = {};
  const keys = Object.keys(WANTED);
  let ok = 0;
  let failed = 0;

  for (const [i, key] of keys.entries()) {
    const term = WANTED[key];
    const target = path.join(OUT_DIR, `${key}.jpg`);
    try {
      await fs.access(target);
      const cached = manifest[key];
      if (cached) continue;
    } catch {
      /* not cached — download */
    }

    try {
      const data = await api({
        action: 'query',
        generator: 'search',
        gsrsearch: `${term} filetype:bitmap`,
        gsrnamespace: '6',
        gsrlimit: '8',
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata',
        iiurlwidth: '900',
      });
      const best = pickBest(data.query?.pages);
      if (!best) throw new Error('no suitable image');

      const imgRes = await fetch(best.info.thumburl, { headers: { 'User-Agent': UA } });
      if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length < 3000) throw new Error('image too small');
      await fs.writeFile(target, buf);

      manifest[key] = {
        file: `${key}.jpg`,
        bytes: buf.length,
        width: best.info.thumbwidth || null,
        height: best.info.thumbheight || null,
        sourceTitle: best.page.title,
        sourcePage: best.info.descriptionurl || null,
        licence: meta(best.info, 'LicenseShortName') || 'See source page',
        author: meta(best.info, 'Artist') || 'Unknown',
      };
      ok += 1;
      process.stdout.write(`  [${i + 1}/${keys.length}] ${key} ← ${best.page.title}\n`);
    } catch (err) {
      failed += 1;
      process.stdout.write(`  [${i + 1}/${keys.length}] ${key} FAILED: ${err.message}\n`);
    }
    await new Promise((r) => setTimeout(r, 220)); // be polite to the API
  }

  await fs.writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        note:
          'Demo assets only. Openly licensed images from Wikimedia Commons, retained with ' +
          'attribution. Replace with TechStar Store photography before launch.',
        fetchedAt: new Date().toISOString(),
        images: manifest,
      },
      null,
      2,
    ),
  );
  console.log(`\nDone: ${ok} downloaded, ${failed} failed, manifest written.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
