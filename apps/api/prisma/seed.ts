/**
 * TechStar Store — database seed.
 *
 * Order matters: SKU allocation reads the parent, so nothing may be created
 * before its parent exists (spec Appendix F). The seed is idempotent — running
 * it twice produces the same database, never duplicates.
 *
 *   npm run db:seed            core data + demo catalogue
 *   SEED_DEMO=false npm run db:seed    core data only
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The workspace keeps one .env at the repository root; an app-local .env
// overrides it. Resolved from this file rather than the working directory, so
// the seed behaves the same however it is invoked — by npm, by tsx directly,
// or by the Prisma CLI. This must run before the client is constructed.
for (const file of [
  path.resolve(__dirname, '..', '..', '..', '.env'),
  path.resolve(__dirname, '..', '.env'),
]) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: true });
}

const prisma = new PrismaClient();

const SEED_DEMO = process.env.SEED_DEMO !== 'false';
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'admin@techstar.co.tz';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'TechStar#2026';
const MEDIA_ROOT = path.resolve(__dirname, '..', process.env.MEDIA_ROOT ?? './uploads');
const MEDIA_URL = (process.env.MEDIA_PUBLIC_URL ?? 'http://localhost:4000/media').replace(/\/$/, '');

const slugify = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const attrHash = (pairs: { name: string; value: string }[]) =>
  crypto
    .createHash('sha1')
    .update(
      pairs
        .map((p) => `${p.name.toLowerCase()}=${p.value.toLowerCase()}`)
        .sort()
        .join('|') || 'default',
    )
    .digest('hex')
    .slice(0, 40);

// ══════════════════════════════════════════════ PERMISSIONS & ROLES ══

const PERMISSIONS: [string, string, string][] = [
  ['product.read', 'catalogue', 'View products'],
  ['product.create', 'catalogue', 'Create products'],
  ['product.update', 'catalogue', 'Edit products'],
  ['product.delete', 'catalogue', 'Delete products'],
  ['category.read', 'catalogue', 'View categories'],
  ['category.create', 'catalogue', 'Create categories'],
  ['category.update', 'catalogue', 'Edit categories'],
  ['category.delete', 'catalogue', 'Delete categories'],
  ['discount.read', 'catalogue', 'View discounts'],
  ['discount.create', 'catalogue', 'Create discounts'],
  ['discount.delete', 'catalogue', 'Delete discounts'],
  ['stock.read', 'catalogue', 'View stock'],
  ['stock.adjust', 'catalogue', 'Adjust stock'],
  ['media.read', 'catalogue', 'View media library'],
  ['media.upload', 'catalogue', 'Upload images'],
  ['media.delete', 'catalogue', 'Delete images'],
  ['order.read', 'commerce', 'View orders'],
  ['order.update', 'commerce', 'Change order status'],
  ['order.refund', 'commerce', 'Refund orders'],
  ['payment.verify', 'commerce', 'Verify payments'],
  ['payment.refund', 'commerce', 'Issue refunds'],
  ['invoice.read', 'commerce', 'View invoices'],
  ['invoice.create', 'commerce', 'Create invoices'],
  ['invoice.update', 'commerce', 'Edit invoices'],
  ['invoice.delete', 'commerce', 'Delete invoices'],
  ['shipping.read', 'commerce', 'View shipping methods'],
  ['shipping.create', 'commerce', 'Create shipping methods'],
  ['shipping.update', 'commerce', 'Edit shipping methods'],
  ['shipping.delete', 'commerce', 'Delete shipping methods'],
  ['customer.read', 'customers', 'View customers'],
  ['customer.update', 'customers', 'Edit customers'],
  ['customer.suspend', 'customers', 'Suspend customers'],
  ['banner.read', 'content', 'View banners'],
  ['banner.create', 'content', 'Create banners'],
  ['banner.update', 'content', 'Edit banners'],
  ['banner.delete', 'content', 'Delete banners'],
  ['service.read', 'content', 'View services'],
  ['service.create', 'content', 'Create services'],
  ['service.update', 'content', 'Edit services'],
  ['service.delete', 'content', 'Delete services'],
  ['partner.read', 'content', 'View partners'],
  ['partner.create', 'content', 'Create partners'],
  ['partner.update', 'content', 'Edit partners'],
  ['partner.delete', 'content', 'Delete partners'],
  ['article.read', 'content', 'View articles'],
  ['article.create', 'content', 'Create articles'],
  ['article.update', 'content', 'Edit articles'],
  ['article.delete', 'content', 'Delete articles'],
  ['faq.read', 'content', 'View FAQs'],
  ['faq.create', 'content', 'Create FAQs'],
  ['faq.update', 'content', 'Edit FAQs'],
  ['faq.delete', 'content', 'Delete FAQs'],
  ['comment.moderate', 'content', 'Moderate comments'],
  ['review.moderate', 'content', 'Moderate reviews'],
  ['campaign.read', 'marketing', 'View campaigns'],
  ['campaign.create', 'marketing', 'Create campaigns'],
  ['campaign.send', 'marketing', 'Send campaigns'],
  ['campaign.delete', 'marketing', 'Delete campaigns'],
  ['settings.read', 'platform', 'View settings'],
  ['settings.update', 'platform', 'Change settings'],
  ['staff.manage', 'platform', 'Manage staff and roles'],
  ['audit.view', 'platform', 'View the audit log'],
  ['analytics.view', 'platform', 'View analytics'],
  ['dashboard.view', 'platform', 'View the dashboard'],
];

const ROLES: { key: string; name: string; description: string; match: (k: string) => boolean }[] = [
  { key: 'owner', name: 'Owner', description: 'Full access to everything', match: () => true },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Everything except staff and settings',
    match: (k) => !['staff.manage', 'settings.update'].includes(k),
  },
  {
    key: 'catalogue',
    name: 'Catalogue',
    description: 'Products, categories and media',
    match: (k) =>
      k.startsWith('product.') ||
      k.startsWith('category.') ||
      k.startsWith('discount.') ||
      k.startsWith('stock.') ||
      k.startsWith('media.') ||
      k === 'dashboard.view' ||
      k === 'order.read',
  },
  {
    key: 'fulfilment',
    name: 'Fulfilment',
    description: 'Orders, payments and stock',
    match: (k) =>
      k.startsWith('order.') ||
      k.startsWith('payment.') ||
      k.startsWith('invoice.') ||
      k.startsWith('stock.') ||
      ['customer.read', 'product.read', 'shipping.read', 'dashboard.view'].includes(k),
  },
  {
    key: 'marketing',
    name: 'Marketing',
    description: 'Content and campaigns',
    match: (k) =>
      k.startsWith('banner.') ||
      k.startsWith('article.') ||
      k.startsWith('service.') ||
      k.startsWith('partner.') ||
      k.startsWith('faq.') ||
      k.startsWith('campaign.') ||
      k.startsWith('media.') ||
      ['comment.moderate', 'review.moderate', 'customer.read', 'analytics.view', 'dashboard.view'].includes(k),
  },
  {
    key: 'support',
    name: 'Support',
    description: 'Read-only orders and moderation',
    match: (k) =>
      ['order.read', 'customer.read', 'product.read', 'invoice.read', 'comment.moderate', 'review.moderate', 'dashboard.view'].includes(k),
  },
];


// ═════════════════════════════════════════════════════════ SUPPLIERS ══

const SUPPLIERS = [
  {
    name: 'Shenzhen Component Direct',
    contactName: 'Li Wei',
    email: 'sales@szcomponent.example',
    phone: '255700100001',
    address: 'Futian District, Shenzhen, China',
    leadTimeDays: 28,
    notes: 'Bulk passives, ICs and modules. Sea freight — order early.',
  },
  {
    name: 'Nairobi Electronics Wholesale',
    contactName: 'Wanjiku Kamau',
    email: 'orders@nairobiew.example',
    phone: '255700100002',
    address: 'Industrial Area, Nairobi, Kenya',
    leadTimeDays: 10,
    notes: 'Regional distributor. Good for boards and tools at short notice.',
  },
  {
    name: 'Dar Tools & Hardware',
    contactName: 'Salum Rashid',
    email: 'salum@dartools.example',
    phone: '255700100003',
    address: 'Kariakoo, Dar es Salaam',
    leadTimeDays: 3,
    notes: 'Local. Hand tools and consumables, next-day delivery.',
  },
  {
    name: 'Arduino Distribution EA',
    contactName: 'Grace Otieno',
    email: 'ea@arduino-dist.example',
    phone: '255700100004',
    address: 'Kampala, Uganda',
    leadTimeDays: 14,
    notes: 'Authorised boards and official accessories.',
  },
];

// ═══════════════════════════════════════════════════ DEMO CATALOGUE ══

interface DemoVariant {
  attributes?: { name: string; value: string }[];
  price: number;
  stock: number;
  compareAt?: number;
}
interface DemoProduct {
  image: string;
  name: string;
  sub: string; // subcategory SKU code
  brand?: string;
  mpn?: string;
  short: string;
  body: string;
  attributeNames?: { name: string; unit?: string }[];
  variants: DemoVariant[];
  featured?: boolean;
}

const p = (
  image: string,
  name: string,
  sub: string,
  short: string,
  body: string,
  variants: DemoVariant[],
  extra: Partial<DemoProduct> = {},
): DemoProduct => ({ image, name, sub, short, body, variants, ...extra });

const DEMO_PRODUCTS: DemoProduct[] = [
  p('arduino-uno', 'Arduino Uno R3 Development Board', '0100',
    'The classic ATmega328P board — the best starting point for learning electronics.',
    '<p>The Arduino Uno R3 is the board most projects, tutorials and courses are written for. It carries an ATmega328P microcontroller, 14 digital I/O pins (6 with PWM), 6 analogue inputs, a 16 MHz crystal and a USB-B connector.</p><h3>What you can build</h3><ul><li>Sensor logging and monitoring</li><li>Motor and servo control</li><li>LED and display projects</li><li>Robotics and automation coursework</li></ul><h3>In the box</h3><ul><li>1 × Arduino Uno R3 board</li><li>1 × USB-B cable</li></ul>',
    [{ price: 32000, stock: 42 }], { brand: 'Arduino', mpn: 'A000066', featured: true }),

  p('arduino-nano', 'Arduino Nano V3 Compatible Board', '0100',
    'Breadboard-friendly ATmega328P board for compact builds.',
    '<p>A small-footprint board with the same ATmega328P as the Uno, in a package that plugs straight into a breadboard. Ideal once a prototype needs to shrink.</p><ul><li>ATmega328P at 16 MHz</li><li>Mini-USB, breadboard-compatible pin pitch</li><li>14 digital I/O, 8 analogue inputs</li></ul>',
    [{ price: 18000, stock: 60 }], { brand: 'Arduino' }),

  p('arduino-mega', 'Arduino Mega 2560 R3', '0100',
    '54 digital I/O pins for projects that outgrow the Uno.',
    '<p>When a project runs out of pins, the Mega 2560 is the answer: 54 digital I/O, 16 analogue inputs, 4 hardware serial ports and 256 KB of flash.</p><ul><li>ATmega2560 at 16 MHz</li><li>4 UARTs — useful for GSM plus GPS plus a display</li><li>Shield-compatible with the Uno footprint</li></ul>',
    [{ price: 62000, stock: 18 }], { brand: 'Arduino', mpn: 'A000067' }),

  p('raspberry-pi-4', 'Raspberry Pi 4 Model B', '0111',
    'A full Linux computer the size of a credit card.',
    '<p>The Raspberry Pi 4 Model B is a genuine desktop-class computer: quad-core 64-bit processor, dual micro-HDMI up to 4K, gigabit Ethernet, USB 3.0 and wireless networking.</p><h3>Choose your memory</h3><p>2 GB suits most learning and IoT work. 4 GB and 8 GB are for desktop use, containers and heavier vision workloads.</p>',
    [
      { attributes: [{ name: 'RAM', value: '2GB' }], price: 195000, stock: 12 },
      { attributes: [{ name: 'RAM', value: '4GB' }], price: 255000, stock: 9 },
      { attributes: [{ name: 'RAM', value: '8GB' }], price: 340000, stock: 5 },
    ],
    { brand: 'Raspberry Pi', attributeNames: [{ name: 'RAM' }], featured: true }),

  p('raspberry-pi-pico', 'Raspberry Pi Pico W', '0111',
    'RP2040 microcontroller with wireless, for a fraction of a Pi.',
    '<p>The Pico W puts the dual-core RP2040 and 2.4 GHz wireless on a board smaller than a stick of gum. Programmable in MicroPython or C/C++.</p><ul><li>Dual-core Arm Cortex-M0+ at 133 MHz</li><li>264 KB SRAM, 2 MB flash</li><li>26 multi-function GPIO pins</li></ul>',
    [{ price: 28000, stock: 35 }], { brand: 'Raspberry Pi' }),

  p('raspberry-pi-zero', 'Raspberry Pi Zero 2 W', '0111',
    'The smallest Pi that still runs full Linux.',
    '<p>A quad-core Pi in the Zero form factor. Perfect for embedded builds, camera projects and anything where space and power matter.</p>',
    [{ price: 78000, stock: 14 }], { brand: 'Raspberry Pi' }),

  p('camera_module', 'Raspberry Pi Camera Module 3', '0111',
    '12 MP autofocus camera for Raspberry Pi.',
    '<p>A 12-megapixel autofocus camera that connects to the Pi CSI port. Supports HDR and 1080p50 video — the standard choice for vision projects.</p>',
    [{ price: 85000, stock: 8 }], { brand: 'Raspberry Pi' }),

  p('esp32', 'ESP32 DevKit V1 WiFi + Bluetooth Board', '0102',
    'Dual-core microcontroller with WiFi and Bluetooth built in.',
    '<p>The ESP32 is the workhorse of connected projects: two 240 MHz cores, WiFi, Bluetooth Classic and BLE, and a generous pin count — all for less than the price of a plain microcontroller.</p><ul><li>240 MHz dual-core, 520 KB SRAM</li><li>WiFi 802.11 b/g/n and Bluetooth 4.2</li><li>30 GPIO, ADC, DAC, touch, SPI, I²C, UART</li></ul>',
    [{ price: 26000, stock: 48 }], { brand: 'Espressif', featured: true }),

  p('esp8266', 'ESP8266 NodeMCU V3 WiFi Board', '0102',
    'The low-cost WiFi board that started the ESP era.',
    '<p>Still the cheapest reliable route to putting a project on WiFi. Programmable from the Arduino IDE, with a built-in USB-serial bridge.</p>',
    [{ price: 16000, stock: 55 }], { brand: 'Espressif' }),

  p('breadboard', 'Solderless Breadboard 830 Points', '0001',
    'Build and rebuild circuits without a soldering iron.',
    '<p>An 830-tie-point breadboard with power rails down both sides. Accepts 22–26 AWG solid wire and standard DIP components.</p>',
    [
      { attributes: [{ name: 'Size', value: '400 points' }], price: 4500, stock: 40 },
      { attributes: [{ name: 'Size', value: '830 points' }], price: 7500, stock: 32 },
    ],
    { attributeNames: [{ name: 'Size' }] }),

  p('perfboard', 'Stripboard / Veroboard Prototyping Board', '0001',
    'Move a working breadboard circuit onto something permanent.',
    '<p>Copper-clad stripboard for soldering a finished prototype. Cut tracks where needed and the layout follows your breadboard almost directly.</p>',
    [
      { attributes: [{ name: 'Dimensions', value: '5 x 7 cm' }], price: 1500, stock: 60 },
      { attributes: [{ name: 'Dimensions', value: '9 x 15 cm' }], price: 3000, stock: 45 },
    ],
    { attributeNames: [{ name: 'Dimensions' }] }),

  p('pcb', 'Double-Sided Copper Clad PCB Blank', '0001',
    'Blank FR-4 board for etching your own circuits.',
    '<p>Double-sided copper-clad FR-4 laminate, 1.6 mm thick, for toner-transfer or photoresist PCB fabrication.</p>',
    [{ price: 6000, stock: 25 }]),

  p('resistor', 'Carbon Film Resistor 1/4W 5%', '0004',
    'The most-used component in electronics, sold per 20.',
    '<p>Carbon film resistors, 1/4 watt, 5% tolerance, with tinned axial leads. Sold in packs of 20 of a single value.</p><p>Every project needs these — current limiting for LEDs, pull-ups and pull-downs, voltage dividers, and biasing.</p>',
    [
      { attributes: [{ name: 'Resistance', value: '220 Ω' }], price: 1000, stock: 200 },
      { attributes: [{ name: 'Resistance', value: '470 Ω' }], price: 1000, stock: 180 },
      { attributes: [{ name: 'Resistance', value: '1 kΩ' }], price: 1000, stock: 220 },
      { attributes: [{ name: 'Resistance', value: '10 kΩ' }], price: 1000, stock: 190 },
      { attributes: [{ name: 'Resistance', value: '100 kΩ' }], price: 1000, stock: 150 },
    ],
    { attributeNames: [{ name: 'Resistance', unit: 'Ω' }] }),

  p('capacitor', 'Electrolytic Capacitor 25V Radial', '0004',
    'Smoothing and decoupling capacitors, sold per 10.',
    '<p>Radial-lead aluminium electrolytic capacitors rated at 25 V. Used for power-supply smoothing, decoupling and timing.</p>',
    [
      { attributes: [{ name: 'Capacitance', value: '10 µF' }], price: 1200, stock: 120 },
      { attributes: [{ name: 'Capacitance', value: '100 µF' }], price: 1500, stock: 110 },
      { attributes: [{ name: 'Capacitance', value: '470 µF' }], price: 2200, stock: 80 },
      { attributes: [{ name: 'Capacitance', value: '1000 µF' }], price: 3500, stock: 55 },
    ],
    { attributeNames: [{ name: 'Capacitance', unit: 'µF' }] }),

  p('inductor', 'Toroidal Power Inductor', '0004',
    'Wound toroidal inductor for switching supplies and filters.',
    '<p>A toroidal-core inductor with low leakage, suited to buck and boost converters and to EMI filtering.</p>',
    [
      { attributes: [{ name: 'Inductance', value: '33 µH' }], price: 4500, stock: 30 },
      { attributes: [{ name: 'Inductance', value: '100 µH' }], price: 5500, stock: 24 },
    ],
    { attributeNames: [{ name: 'Inductance', unit: 'µH' }] }),

  p('transistor', 'NPN / PNP Transistor Assortment', '0006',
    'A working set of small-signal and power transistors.',
    '<p>An assortment of the transistors that appear in nearly every schematic: 2N2222, BC547, BC557, TIP31 and TIP32, with a datasheet reference card.</p>',
    [{ price: 12000, stock: 30 }]),

  p('ic-555', 'NE555 Precision Timer IC', '0205',
    'The timer chip every electronics course teaches.',
    '<p>The NE555 in an 8-pin DIP. Configure it as a monostable, astable or bistable — oscillators, delays, pulse generation and PWM.</p>',
    [{ price: 1500, stock: 90 }], { mpn: 'NE555P' }),

  p('ic-7400', '74HC Series Logic IC Assortment', '0201',
    'Core 74HC logic gates in DIP packages.',
    '<p>An assortment of 74HC logic: 74HC00 NAND, 74HC04 inverter, 74HC08 AND, 74HC14 Schmitt inverter and 74HC32 OR. Two of each.</p>',
    [{ price: 15000, stock: 22 }]),

  p('ic-socket', 'DIP IC Socket', '0000',
    'Never solder a chip directly again.',
    '<p>Machined DIP sockets so an integrated circuit can be replaced without desoldering. Sold in packs of 10.</p>',
    [
      { attributes: [{ name: 'Pins', value: '8-pin' }], price: 1000, stock: 80 },
      { attributes: [{ name: 'Pins', value: '16-pin' }], price: 1500, stock: 65 },
      { attributes: [{ name: 'Pins', value: '28-pin' }], price: 2500, stock: 40 },
    ],
    { attributeNames: [{ name: 'Pins' }] }),

  p('connector-header', 'Pin Header Strip 2.54mm', '0000',
    'Male and female headers for boards and shields.',
    '<p>Standard 0.1 inch (2.54 mm) pitch headers — snap them to length with side cutters. Sold in packs of 10 strips.</p>',
    [
      { attributes: [{ name: 'Type', value: 'Male straight' }], price: 3000, stock: 70 },
      { attributes: [{ name: 'Type', value: 'Female straight' }], price: 4000, stock: 55 },
    ],
    { attributeNames: [{ name: 'Type' }] }),

  p('terminal-block', 'Screw Terminal Block 5mm Pitch', '0000',
    'Solid screw connections for power and signals.',
    '<p>PCB-mount screw terminal blocks with a 5 mm pitch, rated 10 A. Sold in packs of 10.</p>',
    [
      { attributes: [{ name: 'Ways', value: '2-way' }], price: 2500, stock: 60 },
      { attributes: [{ name: 'Ways', value: '3-way' }], price: 3200, stock: 45 },
    ],
    { attributeNames: [{ name: 'Ways' }] }),

  p('jumper-wires', 'Dupont Jumper Wire Set (40 pieces)', '0008',
    'The wires that connect everything on a breadboard.',
    '<p>40 pre-crimped 20 cm jumper wires in a rainbow ribbon that separates cleanly. Choose the end configuration your build needs.</p>',
    [
      { attributes: [{ name: 'Ends', value: 'Male – Male' }], price: 5000, stock: 85 },
      { attributes: [{ name: 'Ends', value: 'Male – Female' }], price: 5000, stock: 78 },
      { attributes: [{ name: 'Ends', value: 'Female – Female' }], price: 5000, stock: 62 },
    ],
    { attributeNames: [{ name: 'Ends' }], featured: true }),

  p('ribbon-cable', 'Rainbow Ribbon Cable 40-Way', '0008',
    'Bulk ribbon cable for custom looms.',
    '<p>40-way rainbow ribbon cable, 1 metre, 28 AWG. Split to any width for custom connectors.</p>',
    [{ price: 8000, stock: 30 }]),

  p('usb-cable', 'USB Cable for Development Boards', '0008',
    'Data-capable cables — not charge-only.',
    '<p>Fully wired USB cables that carry data as well as power. Charge-only cables are the single most common reason a board will not connect.</p>',
    [
      { attributes: [{ name: 'Connector', value: 'USB-A to USB-B' }], price: 6000, stock: 50 },
      { attributes: [{ name: 'Connector', value: 'USB-A to Micro-USB' }], price: 5000, stock: 65 },
      { attributes: [{ name: 'Connector', value: 'USB-A to USB-C' }], price: 7000, stock: 44 },
    ],
    { attributeNames: [{ name: 'Connector' }] }),

  p('potentiometer', 'Rotary Potentiometer with Knob', '0007',
    'Analogue control for volume, brightness and calibration.',
    '<p>Linear-taper rotary potentiometers with a 6 mm shaft, supplied with a knob.</p>',
    [
      { attributes: [{ name: 'Resistance', value: '10 kΩ' }], price: 2500, stock: 60 },
      { attributes: [{ name: 'Resistance', value: '100 kΩ' }], price: 2500, stock: 45 },
    ],
    { attributeNames: [{ name: 'Resistance', unit: 'Ω' }] }),

  p('servo-motor', 'SG90 Micro Servo Motor', '0007',
    '180° positional control for robotics and mechanisms.',
    '<p>The SG90 micro servo: 180 degrees of travel, roughly 1.8 kg·cm of torque, and a standard three-wire interface driven from a single PWM pin.</p><ul><li>Operating voltage 4.8–6 V</li><li>Supplied with three horns and screws</li></ul>',
    [{ price: 9000, stock: 55 }], { featured: true }),

  p('stepper-motor', '28BYJ-48 Stepper Motor with ULN2003 Driver', '0007',
    'Precise positioning without feedback.',
    '<p>A 5 V geared stepper with its ULN2003 driver board. 64 steps per revolution through a 1:64 gearbox — fine positioning for plotters, camera sliders and dials.</p>',
    [{ price: 14000, stock: 32 }]),

  p('dc-motor', 'DC Gear Motor 6V', '0007',
    'Geared motor for wheeled robots and small drives.',
    '<p>A 6 V DC motor with a plastic gearbox, matched to standard robot chassis wheels. Roughly 200 rpm at 6 V.</p>',
    [{ price: 11000, stock: 40 }]),

  p('buzzer', 'Piezoelectric Buzzer', '0007',
    'Alerts, alarms and simple tone generation.',
    '<p>Active and passive piezo buzzers. The active type sounds from a DC level; the passive type needs a driven waveform and can play tones.</p>',
    [
      { attributes: [{ name: 'Type', value: 'Active' }], price: 2000, stock: 70 },
      { attributes: [{ name: 'Type', value: 'Passive' }], price: 2000, stock: 65 },
    ],
    { attributeNames: [{ name: 'Type' }] }),

  p('ultrasonic-sensor', 'HC-SR04 Ultrasonic Distance Sensor', '0513',
    'Measures distance from 2 cm to 4 m.',
    '<p>The HC-SR04 sends a 40 kHz pulse and times the echo. Two pins, one trigger and one echo, and a well-documented Arduino library.</p><ul><li>Range 2 cm – 400 cm, roughly 3 mm resolution</li><li>Operating voltage 5 V</li></ul>',
    [{ price: 8500, stock: 48 }], { mpn: 'HC-SR04', featured: true }),

  p('temperature-sensor', 'DHT11 Temperature and Humidity Sensor', '0516',
    'One-wire temperature and humidity readings.',
    '<p>The DHT11 reports temperature and relative humidity over a single data line. The standard sensor for weather stations, greenhouse monitors and classroom projects.</p><ul><li>Temperature 0–50 °C, ±2 °C</li><li>Humidity 20–90% RH, ±5%</li></ul>',
    [{ price: 7000, stock: 52 }], { mpn: 'DHT11' }),

  p('ldr-sensor', 'Light Dependent Resistor (LDR) Module', '0515',
    'Detects light level for automatic switching.',
    '<p>A photoresistor on a breakout with both analogue and digital outputs and an adjustable threshold. Street-light controllers, line followers and darkness alarms.</p>',
    [{ price: 4500, stock: 60 }]),

  p('ir-sensor', 'Infrared Obstacle / Receiver Module', '1005',
    'Obstacle detection and remote-control decoding.',
    '<p>An IR emitter–receiver pair on a breakout with an adjustable range, plus a 38 kHz demodulating receiver for decoding remote controls.</p>',
    [{ price: 5000, stock: 55 }]),

  p('load-cell', 'Load Cell with HX711 Amplifier', '0514',
    'Turn any surface into a digital scale.',
    '<p>A strain-gauge load cell with the HX711 24-bit ADC amplifier. Calibrate once in software and read weight directly.</p>',
    [
      { attributes: [{ name: 'Capacity', value: '1 kg' }], price: 22000, stock: 12 },
      { attributes: [{ name: 'Capacity', value: '5 kg' }], price: 24000, stock: 10 },
      { attributes: [{ name: 'Capacity', value: '20 kg' }], price: 28000, stock: 7 },
    ],
    { attributeNames: [{ name: 'Capacity' }] }),

  p('fingerprint-sensor', 'Optical Fingerprint Sensor Module', '0507',
    'Biometric enrolment and matching over UART.',
    '<p>An optical fingerprint reader that stores and matches templates on-module and reports over UART. Attendance systems, door locks and access control.</p>',
    [{ price: 95000, stock: 6 }]),

  p('lcd-display', '16x2 Character LCD with I²C Backpack', '0002',
    'Two lines of text using only two pins.',
    '<p>A 16 × 2 character LCD with an I²C backpack soldered on, so it needs only SDA and SCL rather than six data lines.</p>',
    [
      { attributes: [{ name: 'Backlight', value: 'Blue' }], price: 16000, stock: 28 },
      { attributes: [{ name: 'Backlight', value: 'Green' }], price: 16000, stock: 22 },
    ],
    { attributeNames: [{ name: 'Backlight' }] }),

  p('seven-segment', '7-Segment LED Display Module', '0002',
    'Big, bright numeric readouts.',
    '<p>Four-digit seven-segment display modules driven over a two-wire interface. Clocks, counters and instrument panels.</p>',
    [{ price: 9500, stock: 30 }]),

  p('micro-sd', 'MicroSD Memory Card', '1102',
    'Storage for Raspberry Pi, data loggers and cameras.',
    '<p>Class 10 / U1 microSD cards with an SD adapter. Fast enough to run a Raspberry Pi operating system and to log sensor data continuously.</p>',
    [
      { attributes: [{ name: 'Capacity', value: '16 GB' }], price: 18000, stock: 40 },
      { attributes: [{ name: 'Capacity', value: '32 GB' }], price: 26000, stock: 34 },
      { attributes: [{ name: 'Capacity', value: '64 GB' }], price: 42000, stock: 21 },
    ],
    { attributeNames: [{ name: 'Capacity' }] }),

  p('gsm-module', 'SIM800L GSM / GPRS Module', '1003',
    'Send SMS and connect over mobile data.',
    '<p>A quad-band GSM/GPRS module that lets a project send and receive SMS, place calls and reach the internet over mobile data. Needs a stable 4 V supply capable of 2 A peaks.</p>',
    [{ price: 38000, stock: 15 }], { mpn: 'SIM800L' }),

  p('gps-module', 'NEO-6M GPS Receiver Module', '1003',
    'Position, speed and precise time.',
    '<p>A NEO-6M GPS receiver with a ceramic patch antenna, reporting standard NMEA sentences over UART. Tracking, geofencing and accurate timekeeping.</p>',
    [{ price: 45000, stock: 11 }], { mpn: 'NEO-6M' }),

  p('bluetooth-module', 'HC-05 Bluetooth Serial Module', '1003',
    'Wireless serial link to a phone or laptop.',
    '<p>The HC-05 presents a transparent serial link over Bluetooth Classic — the simplest way to control a project from a phone without writing any networking code.</p>',
    [{ price: 24000, stock: 26 }], { mpn: 'HC-05' }),

  p('buck-converter', 'LM2596 Adjustable Buck Converter', '0401',
    'Step any DC voltage down efficiently.',
    '<p>An adjustable step-down (buck) module built on the LM2596. Input 4–35 V, output 1.25–30 V at up to 2 A, with a multi-turn trimmer for setting the output.</p>',
    [{ price: 8000, stock: 44 }], { mpn: 'LM2596' }),

  p('transformer', 'Mains Step-Down Transformer', '0400',
    'Isolated low-voltage AC from the mains.',
    '<p>An encapsulated step-down transformer for linear power supplies, providing isolation from the mains.</p>',
    [
      { attributes: [{ name: 'Secondary', value: '9V 1A' }], price: 22000, stock: 10 },
      { attributes: [{ name: 'Secondary', value: '12V 1A' }], price: 25000, stock: 8 },
    ],
    { attributeNames: [{ name: 'Secondary' }] }),

  p('fuse', 'Glass Cartridge Fuse Assortment', '0005',
    'Cheap insurance for every power supply.',
    '<p>An assortment of 5 × 20 mm quick-blow glass fuses from 250 mA to 5 A, with a holder.</p>',
    [{ price: 6500, stock: 35 }]),

  p('solar-panel', 'Polycrystalline Solar Panel', '0800',
    'Off-grid power for outdoor projects.',
    '<p>Small polycrystalline panels for charging batteries in remote sensors, weather stations and irrigation controllers.</p>',
    [
      { attributes: [{ name: 'Power', value: '10 W' }], price: 55000, stock: 9 },
      { attributes: [{ name: 'Power', value: '20 W' }], price: 95000, stock: 6 },
      { attributes: [{ name: 'Power', value: '50 W' }], price: 210000, stock: 3 },
    ],
    { attributeNames: [{ name: 'Power', unit: 'W' }] }),

  p('battery-18650', '18650 Lithium-Ion Cell', '0803',
    'Rechargeable cells for portable builds.',
    '<p>Protected 18650 lithium-ion cells, 3.7 V nominal. Use with a proper charging circuit — never charge lithium cells unattended.</p>',
    [
      { attributes: [{ name: 'Capacity', value: '2000 mAh' }], price: 12000, stock: 40 },
      { attributes: [{ name: 'Capacity', value: '2600 mAh' }], price: 15000, stock: 30 },
      { attributes: [{ name: 'Capacity', value: '3400 mAh' }], price: 22000, stock: 18 },
    ],
    { attributeNames: [{ name: 'Capacity', unit: 'mAh' }] }),

  p('battery-holder', 'Battery Holder with Leads', '0803',
    'Simple battery mounting for prototypes.',
    '<p>Plastic battery holders with flying leads or a DC barrel plug.</p>',
    [
      { attributes: [{ name: 'Cells', value: '4 × AA' }], price: 4000, stock: 45 },
      { attributes: [{ name: 'Cells', value: '2 × 18650' }], price: 6500, stock: 28 },
    ],
    { attributeNames: [{ name: 'Cells' }] }),

  p('heat-sink', 'Aluminium Heat Sink with Thermal Tape', '1604',
    'Keeps regulators and processors within their limits.',
    '<p>Anodised aluminium heat sinks with self-adhesive thermal tape, sized for TO-220 regulators and for Raspberry Pi processors.</p>',
    [{ price: 3500, stock: 60 }]),

  p('multimeter', 'Digital Multimeter', '0704',
    'The one instrument no bench should be without.',
    '<p>An auto-ranging digital multimeter measuring DC and AC voltage, current, resistance, continuity, diodes and transistor gain. Supplied with probes and a battery.</p>',
    [
      { attributes: [{ name: 'Model', value: 'Standard' }], price: 45000, stock: 16 },
      { attributes: [{ name: 'Model', value: 'True RMS' }], price: 120000, stock: 5 },
    ],
    { attributeNames: [{ name: 'Model' }], featured: true }),

  p('oscilloscope', 'Digital Storage Oscilloscope 100MHz', '0703',
    'See what a signal is actually doing.',
    '<p>A two-channel 100 MHz digital storage oscilloscope with a 1 GSa/s sample rate, FFT, automatic measurements and USB export. The instrument that turns guesswork into observation.</p>',
    [{ price: 1450000, stock: 2 }]),

  p('logic-analyzer', '8-Channel USB Logic Analyzer', '0703',
    'Decode SPI, I²C and UART traffic.',
    '<p>An eight-channel USB logic analyzer sampling to 24 MHz, with protocol decoders for SPI, I²C, UART and 1-Wire. Far more useful than an oscilloscope for digital bus problems, and a fraction of the price.</p>',
    [{ price: 65000, stock: 12 }]),

  p('solder-wire', 'Rosin-Core Solder Wire', '0602',
    'Flux-cored solder for reliable joints.',
    '<p>Rosin flux-cored solder on a 100 g reel. The 0.8 mm gauge suits general through-hole work; 0.5 mm is better for fine-pitch parts.</p>',
    [
      { attributes: [{ name: 'Diameter', value: '0.5 mm' }], price: 18000, stock: 22 },
      { attributes: [{ name: 'Diameter', value: '0.8 mm' }], price: 16000, stock: 30 },
    ],
    { attributeNames: [{ name: 'Diameter', unit: 'mm' }] }),

  p('screwdriver-set', 'Precision Screwdriver Set (45 pieces)', '0600',
    'Opens almost anything with a screw in it.',
    '<p>A 45-piece precision bit set with a magnetic driver, covering Phillips, flat, Torx, hex, tri-wing and pentalobe.</p>',
    [{ price: 32000, stock: 18 }]),

  p('pliers', 'Needle-Nose Pliers', '0605',
    'Bending, gripping and placing small parts.',
    '<p>Precision needle-nose pliers with a serrated tip, a side cutter and cushioned handles.</p>',
    [{ price: 14000, stock: 25 }]),

  p('wire-stripper', 'Wire Stripper and Crimping Tool', '0604',
    'Clean strips without nicking the conductor.',
    '<p>An adjustable wire stripper for 10–22 AWG with an integrated crimper for insulated terminals and a bolt cutter.</p>',
    [{ price: 26000, stock: 14 }]),

  p('glue-gun', 'Hot Glue Gun with Sticks', '0608',
    'Strain relief, mounting and quick enclosures.',
    '<p>A 40 W hot glue gun with a stand and ten glue sticks. Indispensable for securing wires and mounting components in a case.</p>',
    [{ price: 19000, stock: 20 }]),

  p('drone', 'Camera Quadcopter Drone', '0902',
    'Ready-to-fly quadcopter with a stabilised camera.',
    '<p>A ready-to-fly quadcopter with GPS hold, return-to-home and a gimbal-stabilised camera. Supplied with a controller, two batteries and a carry case.</p>',
    [{ price: 1250000, stock: 3 }], { featured: true }),

  p('robot-kit', 'Educational Robotic Arm Kit', '0903',
    'Build a working robot arm from the ground up.',
    '<p>A hands-on robotic arm kit with servos, structural parts, a controller and a step-by-step build guide. Designed for classroom and club use.</p>',
    [{ price: 285000, stock: 5 }]),

  p('cctv-camera', 'IP Security Camera 1080p', '1300',
    'Network camera with night vision.',
    '<p>A 1080p IP camera with infrared night vision, motion detection and microSD recording. Connects over WiFi or Ethernet.</p>',
    [{ price: 165000, stock: 7 }]),

  p('calculator', 'Scientific Calculator', '1103',
    'Two-line scientific calculator for coursework.',
    '<p>A 240-function scientific calculator with a two-line display, permitted in most examinations.</p>',
    [{ price: 28000, stock: 30 }]),

  p('keyboard', 'Mechanical Keyboard', '1105',
    'Tactile mechanical keyboard for long sessions.',
    '<p>A full-size mechanical keyboard with tactile switches, N-key rollover and detachable USB-C cable.</p>',
    [{ price: 145000, stock: 8 }]),

  p('mouse', 'Optical USB Mouse', '1106',
    'Reliable wired mouse for lab workstations.',
    '<p>A 1600 DPI optical mouse with a 1.5 m USB cable — no batteries, no pairing, nothing to go wrong.</p>',
    [{ price: 22000, stock: 35 }]),
];

// ═══════════════════════════════════════════════════════════ HELPERS ══

interface ImageManifest {
  images: Record<string, { file: string; sourceTitle?: string; licence?: string; author?: string }>;
}

async function importSeedImages(): Promise<Map<string, number>> {
  const dir = path.join(__dirname, 'seed-images');
  const map = new Map<string, number>();
  if (!fs.existsSync(dir)) {
    console.log('  ! no seed-images directory — run: node prisma/fetch-seed-images.mjs');
    return map;
  }
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest: ImageManifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { images: {} };

  fs.mkdirSync(MEDIA_ROOT, { recursive: true });

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'))) {
    const key = file.replace(/\.jpg$/, '');
    const buffer = fs.readFileSync(path.join(dir, file));
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');

    const existing = await prisma.mediaFile.findFirst({ where: { checksumSha256: digest } });
    if (existing) {
      map.set(key, existing.id);
      continue;
    }

    const publicId = ulid();
    const shard = path.join(publicId.slice(0, 2), publicId.slice(2, 4));
    fs.mkdirSync(path.join(MEDIA_ROOT, shard), { recursive: true });
    const relKey = `${shard.replace(/\\/g, '/')}/${publicId}.jpg`;
    fs.writeFileSync(path.join(MEDIA_ROOT, shard, `${publicId}.jpg`), buffer);

    const url = `${MEDIA_URL}/${relKey}`;
    const meta = manifest.images[key];
    const created = await prisma.mediaFile.create({
      data: {
        publicId,
        storageDriver: 'local',
        storageKey: relKey,
        originalFilename: file,
        mimeType: 'image/jpeg',
        byteSize: buffer.length,
        checksumSha256: digest,
        urlSm: url,
        urlMd: url,
        urlLg: url,
        altText: meta?.sourceTitle
          ? `${key.replace(/-/g, ' ')} — ${meta.licence ?? 'openly licensed'}`
          : key.replace(/-/g, ' '),
        referenceCount: 0,
      },
    });
    map.set(key, created.id);
  }
  console.log(`  ✓ ${map.size} product images imported into the media library`);
  return map;
}

// ══════════════════════════════════════════════════════════════ MAIN ══

async function main() {
  console.log('\nSeeding TechStar Store\n──────────────────────');

  // 1 ─ permissions
  for (const [key, group, description] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, group, description },
      update: { group, description },
    });
  }
  const allPerms = await prisma.permission.findMany();
  console.log(`  ✓ ${allPerms.length} permissions`);

  // 2 ─ roles
  for (const role of ROLES) {
    const r = await prisma.role.upsert({
      where: { key: role.key },
      create: { key: role.key, name: role.name, description: role.description, isSystem: true },
      update: { name: role.name, description: role.description },
    });
    const wanted = allPerms.filter((p) => role.match(p.key));
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
    await prisma.rolePermission.createMany({
      data: wanted.map((p) => ({ roleId: r.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.log(`  ✓ ${ROLES.length} roles`);

  // 3 ─ owner account
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } });
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    create: {
      publicId: ulid(),
      username: 'TechStar Admin',
      email: OWNER_EMAIL,
      phone: '255700000001',
      passwordHash: await bcrypt.hash(OWNER_PASSWORD, 11),
      accountType: 'staff',
      emailVerifiedAt: new Date(),
    },
    update: { accountType: 'staff' },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    create: { userId: owner.id, roleId: ownerRole.id },
    update: {},
  });
  console.log(`  ✓ owner account ${OWNER_EMAIL}`);

  // 4 ─ regions and districts
  const locations = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'locations.json'), 'utf8'),
  ) as { name: string; districts: string[] }[];
  for (const [i, r] of locations.entries()) {
    const region = await prisma.region.upsert({
      where: { name: r.name },
      create: { name: r.name, position: i },
      update: { position: i },
    });
    for (const [j, d] of r.districts.entries()) {
      await prisma.district.upsert({
        where: { regionId_name: { regionId: region.id, name: d } },
        create: { regionId: region.id, name: d, position: j },
        update: { position: j },
      });
    }
  }
  console.log(`  ✓ ${locations.length} regions with districts`);

  // 5 ─ settings
  const SETTINGS: Record<string, string> = {
    'store.name': 'TechStar Store',
    'store.legalName': 'TechStar Store Limited',
    'store.tagline': 'Build. Learn. Innovate.',
    'store.registrationCountry': 'Tanzania',
    'store.registrationAgency': 'BRELA',
    'store.tin': '',
    'store.registrationNumber': '',
    'store.poBox': 'P. O. Box 00000',
    'contact.phonePrimary': '+255 700 000 001',
    'contact.phoneSecondary': '+255 22 000 0000',
    'contact.email': 'info@techstar.co.tz',
    'contact.whatsapp': '255700000001',
    'contact.address': 'Dar es Salaam, Tanzania',
    'contact.latitude': '-6.7924',
    'contact.longitude': '39.2083',
    'contact.openingHours': 'Mon–Fri 08:30–18:00 · Sat 09:00–15:00',
    'social.facebook': '',
    'social.instagram': '',
    'social.x': '',
    'social.linkedin': '',
    'social.youtube': '',
    'payment.tillMpesa': '000000',
    'payment.tillMixx': '000000',
    'payment.tillAirtel': '000000',
    'payment.instructionsSw':
      '<p><strong>Wateja wa M-Pesa</strong></p><ol><li>Piga *150*00# au tumia programu ya M-Pesa</li><li>Chagua LIPA kwa M-Pesa</li><li>Weka LIPA namba</li><li>Weka kiasi unacholipa</li><li>Weka namba ya siri</li><li>Utapokea SMS kuthibitisha muamala</li></ol>',
    'payment.instructionsEn':
      '<p><strong>M-Pesa customers</strong></p><ol><li>Dial *150*00# or open the M-Pesa app</li><li>Choose Lipa kwa M-Pesa</li><li>Enter the till number</li><li>Enter the amount</li><li>Enter your PIN</li><li>You will receive a confirmation SMS</li></ol>',
    'currency.code': 'TZS',
    'currency.fractionDigits': '0',
    'policies.returnsWindowDays': '7',
    'policies.invoiceTerms':
      'Goods are shipped upon confirmation of full payment. Terms and conditions apply to the handling, processing and shipping of purchased goods. All payments must be made through the designated payment methods of TechStar Store Limited.',
    'catalogue.productsPerPage': '24',
    'catalogue.newBadgeDays': '30',
    'catalogue.hideEmptySubcategories': 'true',
    'features.reviews': 'true',
    'features.comments': 'true',
    'features.wishlist': 'true',
    'features.guestCheckout': 'true',
    'features.delegatedPayment': 'true',
    'pages.aboutImage': '',
    'pages.privacyImage': '',
    'pages.termsImage': '',
  };
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.siteSetting.upsert({
      where: { key },
      create: { key, value, group: key.split('.')[0] },
      update: {},
    });
  }
  console.log(`  ✓ ${Object.keys(SETTINGS).length} settings`);

  // 6 ─ shipping methods
  const SHIPPING = [
    {
      name: 'Savings',
      slug: 'savings',
      description:
        'Suited to buyers outside Dar es Salaam. Standard upcountry shipping rates apply and delivery takes two to five working days.',
      costAmount: 15000,
      requiresShippingAddress: true,
      acceptsMobilePayment: true,
      isCashOnDelivery: false,
      estimatedDaysMin: 2,
      estimatedDaysMax: 5,
      position: 0,
    },
    {
      name: 'Cash on delivery',
      slug: 'cash-on-delivery',
      description:
        'Pay the courier when your package arrives. Available within Dar es Salaam for orders up to TZS 300,000.',
      costAmount: 5000,
      requiresShippingAddress: true,
      acceptsMobilePayment: false,
      isCashOnDelivery: true,
      estimatedDaysMin: 1,
      estimatedDaysMax: 2,
      position: 1,
    },
    {
      name: 'Office pickup',
      slug: 'office-pickup',
      description:
        'Collect from our shop in Dar es Salaam. No shipping fee. We will call you when your order is ready.',
      costAmount: 0,
      requiresShippingAddress: false,
      acceptsMobilePayment: true,
      isCashOnDelivery: false,
      estimatedDaysMin: 0,
      estimatedDaysMax: 1,
      position: 2,
    },
  ];
  for (const m of SHIPPING) {
    await prisma.shippingMethod.upsert({ where: { slug: m.slug }, create: m, update: m });
  }
  console.log(`  ✓ ${SHIPPING.length} shipping methods`);

  // 7 ─ taxonomy
  const taxonomy = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'taxonomy.json'), 'utf8'),
  ) as { name: string; skuCode: string; subcategories: { name: string; skuCode: string }[] }[];

  const subBySku = new Map<string, number>();
  for (const [i, c] of taxonomy.entries()) {
    const category = await prisma.category.upsert({
      where: { skuCode: c.skuCode },
      create: { name: c.name, slug: slugify(c.name), skuCode: c.skuCode, position: i },
      update: { name: c.name, position: i },
    });
    for (const [j, s] of c.subcategories.entries()) {
      const sub = await prisma.subcategory.upsert({
        where: { skuCode: s.skuCode },
        create: {
          categoryId: category.id,
          name: s.name,
          slug: slugify(`${s.name}-${s.skuCode}`),
          skuCode: s.skuCode,
          position: j,
        },
        update: { name: s.name, position: j },
      });
      subBySku.set(s.skuCode, sub.id);
    }
  }
  console.log(
    `  ✓ ${taxonomy.length} categories, ${taxonomy.reduce((n, c) => n + c.subcategories.length, 0)} subcategories`,
  );

  // 8 ─ suppliers
  const supplierIds: number[] = [];
  for (const sup of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({ where: { name: sup.name } });
    const row = existing ?? (await prisma.supplier.create({ data: sup }));
    supplierIds.push(row.id);
  }
  console.log(`  ✓ ${supplierIds.length} suppliers`);

  // 9 ─ media
  const images = await importSeedImages();

  if (!SEED_DEMO) {
    console.log('\nCore data seeded (SEED_DEMO=false). Done.\n');
    return;
  }

  // 10 ─ demo catalogue
  let productCount = 0;
  for (const d of DEMO_PRODUCTS) {
    const subId = subBySku.get(d.sub);
    if (!subId) {
      console.log(`  ! skipping ${d.name} — subcategory ${d.sub} not found`);
      continue;
    }
    const existing = await prisma.product.findFirst({ where: { name: d.name } });
    if (existing) continue;

    const used = await prisma.product.findMany({
      where: { skuPrefix: { startsWith: d.sub } },
      select: { skuPrefix: true },
    });
    const taken = new Set(used.map((u) => u.skuPrefix.slice(4)));
    let seq = 0;
    while (taken.has(pad(seq, 3))) seq += 1;
    const skuPrefix = `${d.sub}${pad(seq, 3)}`;

    const imageId = images.get(d.image) ?? null;
    const prices = d.variants.map((v) => v.price);
    const totalStock = d.variants.reduce((n, v) => n + v.stock, 0);

    const product = await prisma.product.create({
      data: {
        subcategoryId: subId,
        name: d.name,
        slug: slugify(d.name),
        skuPrefix,
        shortDescription: d.short,
        descriptionHtml: d.body,
        descriptionText: d.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
        brand: d.brand ?? null,
        manufacturerPartNumber: d.mpn ?? null,
        displayImageId: imageId,
        status: 'active',
        isFeatured: Boolean(d.featured),
        totalStock,
        minPriceAmount: Math.min(...prices),
        maxPriceAmount: Math.max(...prices),
        publishedAt: new Date(Date.now() - Math.floor(Math.random() * 60) * 86_400_000),
        metaDescription: d.short.slice(0, 160),
      },
    });

    if (imageId) {
      await prisma.productImage.create({
        data: { productId: product.id, mediaFileId: imageId, position: 0, altText: d.name },
      });
      await prisma.mediaFile.update({
        where: { id: imageId },
        data: { referenceCount: { increment: 2 } },
      });
    }

    const attrRows = [];
    for (const [i, a] of (d.attributeNames ?? []).entries()) {
      attrRows.push(
        await prisma.productAttribute.create({
          data: { productId: product.id, name: a.name, unit: a.unit ?? null, position: i },
        }),
      );
    }

    for (const [i, v] of d.variants.entries()) {
      // A realistic landed cost, so margin reporting has something true to
      // work with. Cheap commodity parts carry a fatter percentage margin than
      // expensive instruments — which is how this trade actually prices.
      const marginRate = v.price < 5_000 ? 0.55
        : v.price < 50_000 ? 0.40
          : v.price < 300_000 ? 0.28
            : 0.18;
      const jitter = 0.9 + ((i * 7 + skuPrefix.charCodeAt(6)) % 21) / 100; // ±10%, deterministic
      const cost = Math.max(1, Math.round(v.price * (1 - marginRate) * jitter));

      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `${skuPrefix}${pad(i + 1, 2)}`,
          attributeHash: attrHash(v.attributes ?? []),
          priceAmount: v.price,
          compareAtAmount: v.compareAt ?? null,
          costAmount: cost,
          stockQuantity: v.stock,
          lowStockThreshold: 5,
          supplierId: supplierIds.length
            ? supplierIds[(skuPrefix.charCodeAt(1) + i) % supplierIds.length]
            : null,
          position: i,
        },
      });
      for (const av of v.attributes ?? []) {
        const attr = attrRows.find((a) => a.name === av.name);
        if (attr) {
          await prisma.variantAttributeValue.create({
            data: { variantId: variant.id, productAttributeId: attr.id, value: av.value },
          });
        }
      }
      if (v.stock > 0) {
        await prisma.stockMovement.create({
          data: {
            productVariantId: variant.id,
            delta: v.stock,
            balanceAfter: v.stock,
            reason: 'purchase',
            note: 'Opening stock',
          },
        });
      }
    }
    productCount += 1;
  }

  // taxonomy counters
  for (const [, subId] of subBySku) {
    const count = await prisma.product.count({
      where: { subcategoryId: subId, deletedAt: null, status: 'active' },
    });
    await prisma.subcategory.update({ where: { id: subId }, data: { productCount: count } });
  }
  for (const c of await prisma.category.findMany()) {
    const [subCount, agg] = await Promise.all([
      prisma.subcategory.count({ where: { categoryId: c.id, deletedAt: null } }),
      prisma.subcategory.aggregate({
        where: { categoryId: c.id, deletedAt: null },
        _sum: { productCount: true },
      }),
    ]);
    await prisma.category.update({
      where: { id: c.id },
      data: { subcategoryCount: subCount, productCount: agg._sum.productCount ?? 0 },
    });
  }
  console.log(`  ✓ ${productCount} demo products with real photography`);

  // 11 ─ banners
  if ((await prisma.banner.count()) === 0) {
    const banners = [
      {
        title: 'Arduino Uno R3',
        subtitle:
          'The board that starts most electronics journeys. In stock now, with same-day pickup in Dar es Salaam.',
        image: 'arduino-uno',
        background: '#0A5C43',
        button: 'SHOP ARDUINO',
        link: '/products?q=arduino',
      },
      {
        title: 'Raspberry Pi 4',
        subtitle:
          'A full Linux computer for the price of a textbook. 2 GB, 4 GB and 8 GB models available.',
        image: 'raspberry-pi-4',
        background: '#1B2A4A',
        button: 'BUY NOW',
        link: '/products?q=raspberry',
      },
      {
        title: 'Build. Learn. Innovate.',
        subtitle:
          'Components, kits, tools and instruments for students, technicians and engineers across Tanzania.',
        image: 'drone',
        background: '#2E2E2E',
        button: 'BROWSE PRODUCTS',
        link: '/products',
      },
    ];
    for (const [i, b] of banners.entries()) {
      await prisma.banner.create({
        data: {
          title: b.title,
          subtitle: b.subtitle,
          backgroundColor: b.background,
          buttonText: b.button,
          buttonBackground: '#0E7C5A',
          linkUrl: b.link,
          imageId: images.get(b.image) ?? null,
          position: i,
        },
      });
    }
    console.log(`  ✓ ${banners.length} home banners`);
  }

  // 12 ─ partners, services, articles, FAQs
  if ((await prisma.partner.count()) === 0) {
    const partners = [
      { name: 'Arduino', image: 'arduino-uno', url: 'https://www.arduino.cc' },
      { name: 'Raspberry Pi', image: 'raspberry-pi-4', url: 'https://www.raspberrypi.com' },
      { name: 'Espressif', image: 'esp32', url: 'https://www.espressif.com' },
    ];
    for (const [i, p2] of partners.entries()) {
      await prisma.partner.create({
        data: {
          name: p2.name,
          websiteUrl: p2.url,
          logoId: images.get(p2.image) ?? null,
          position: i,
        },
      });
    }
    console.log(`  ✓ ${partners.length} partners`);
  }

  if ((await prisma.service.count()) === 0) {
    const services = [
      {
        heading: 'PCB Design and Printing',
        image: 'pcb',
        excerpt: 'From schematic to finished board, we design and produce printed circuit boards.',
        body: '<p>We take a project from schematic capture through layout to a manufactured board. Single and double-sided boards, silkscreen and solder mask, and small production runs.</p><h3>What we need from you</h3><ul><li>A schematic, or a working breadboard prototype</li><li>Mechanical constraints — board size, mounting holes, connector positions</li><li>Quantity</li></ul>',
      },
      {
        heading: 'Prototype Development and Testing',
        image: 'oscilloscope',
        excerpt: 'Bench testing, debugging and firmware help for your build.',
        body: '<p>Bring a project that does not work and we will find out why. Bench instruments, protocol analysis and firmware review — for students, startups and workshops.</p>',
      },
    ];
    for (const [i, s] of services.entries()) {
      await prisma.service.create({
        data: {
          heading: s.heading,
          slug: slugify(s.heading),
          excerpt: s.excerpt,
          contentHtml: s.body,
          contentText: s.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          imageId: images.get(s.image) ?? null,
          position: i,
          publishedAt: new Date(),
        },
      });
    }
    console.log(`  ✓ ${services.length} services`);
  }

  if ((await prisma.article.count()) === 0) {
    const articles = [
      {
        title: 'Choosing your first microcontroller board',
        image: 'arduino-uno',
        excerpt:
          'Arduino, ESP32 or Raspberry Pi Pico? A practical comparison for anyone buying their first board.',
        body: '<p>Every week someone asks us which board to start with. The honest answer is that it depends on what you want to build, and the difference matters less than people think at the beginning.</p><h3>Start with an Arduino Uno if…</h3><p>You are following a course or a tutorial series. Almost every beginner resource is written for the Uno, and matching your hardware to your instructions removes an entire class of problem.</p><h3>Start with an ESP32 if…</h3><p>Your project needs WiFi or Bluetooth. Adding wireless to an Uno costs more than an ESP32 does on its own, and you get two faster cores as well.</p><h3>Start with a Raspberry Pi Pico if…</h3><p>You want to write Python. MicroPython on the Pico is the gentlest route from writing code on a laptop to running code on hardware.</p>',
      },
      {
        title: 'Reading a resistor colour code',
        image: 'resistor',
        excerpt:
          'Four bands, five bands, and the trick for telling which end to read from.',
        body: '<p>The colour code looks like memorisation, but there is a pattern underneath it that makes it much easier to hold on to.</p><h3>The sequence</h3><p>Black, brown, red, orange, yellow, green, blue, violet, grey, white — 0 through 9. The first two bands are digits, the third is the multiplier, and the last is tolerance.</p><h3>Which end do you read from?</h3><p>The tolerance band is usually gold or silver, and it sits slightly further from the others. Put it on your right and read left to right.</p>',
      },
      {
        title: 'Five soldering mistakes worth avoiding',
        image: 'solder-wire',
        excerpt: 'Cold joints, wrong tip temperature and the flux problem nobody mentions.',
        body: '<p>Most soldering problems come down to heat, and specifically to heating the joint rather than the solder.</p><h3>1. Heating the solder instead of the joint</h3><p>Touch the iron to the pad and the lead, wait a moment, then feed solder into the joint. Melting solder on the iron and dabbing it on gives a cold joint every time.</p><h3>2. A dirty tip</h3><p>Wipe on a damp sponge or brass wool before every joint. An oxidised tip does not transfer heat.</p><h3>3. Too low a temperature</h3><p>350 °C for leaded solder is a reasonable starting point. Too cool and you hold the iron on far longer, which damages more than a brief hotter contact would.</p>',
      },
    ];
    for (const a of articles) {
      await prisma.article.create({
        data: {
          title: a.title,
          slug: slugify(a.title),
          excerpt: a.excerpt,
          contentHtml: a.body,
          contentText: a.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          coverImageId: images.get(a.image) ?? null,
          authorId: owner.id,
          status: 'published',
          publishedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 86_400_000),
        },
      });
    }
    console.log(`  ✓ ${articles.length} articles`);
  }

  if ((await prisma.faq.count()) === 0) {
    const faqs: [string, string, string][] = [
      ['Ordering', 'Do I need an account to place an order?', '<p>No. You can check out as a guest with just your name and phone number. Creating an account lets you track orders, save an address and reorder in one click.</p>'],
      ['Ordering', 'Can I change or cancel my order?', '<p>You can cancel from your order page while the status is still Awaiting payment. Once we have started preparing your order, contact us on WhatsApp and we will help where we can.</p>'],
      ['Payment', 'How do I pay?', '<p>By mobile money to our Lipa Namba till, or with cash on delivery within Dar es Salaam. Enter the number you will pay from at checkout so we can match your payment quickly.</p>'],
      ['Payment', 'How long does payment confirmation take?', '<p>Usually within one business hour. You will receive an SMS and an email when we confirm it, and your order page updates automatically.</p>'],
      ['Payment', 'Can someone else pay for my order?', '<p>Yes. At checkout, expand "Someone else is paying" and enter their email address. We will send them a secure payment link. They never see your address or phone number.</p>'],
      ['Shipping & Delivery', 'How long does delivery take?', '<p>Within Dar es Salaam, one to two working days. Upcountry, two to five working days depending on the region. Office pickup is usually ready the same day.</p>'],
      ['Shipping & Delivery', 'Do you deliver outside Dar es Salaam?', '<p>Yes, to all mainland regions using our Savings shipping method.</p>'],
      ['Returns', 'Can I return a component?', '<p>Faulty items can be returned within 7 days of delivery. Components sold in opened anti-static packaging cannot be returned unless they are faulty, because we cannot resell them.</p>'],
      ['Products', 'Are your components genuine?', '<p>We source from established distributors. Where a part is a compatible equivalent rather than the original manufacturer’s, the product page says so.</p>'],
      ['Products', 'Can you source something not listed?', '<p>Often, yes. Message us on WhatsApp with the part number and quantity and we will tell you whether we can get it and what it would cost.</p>'],
      ['Account', 'I did not receive my verification email', '<p>Check your spam folder first. You can request a new link from the banner at the top of the page once you are signed in.</p>'],
    ];
    for (const [group, question, answerHtml] of faqs) {
      await prisma.faq.create({
        data: { group, question, answerHtml, position: faqs.findIndex((f) => f[1] === question) },
      });
    }
    console.log(`  ✓ ${faqs.length} FAQs`);
  }

  // 13 ─ demo customers and orders
  if ((await prisma.user.count({ where: { accountType: 'customer' } })) === 0) {
    const people = [
      ['Amina Mushi', 'amina@example.com', '255712345001', 'DAR-ES-SALAAM', 'KINONDONI'],
      ['Joseph Kimaro', 'joseph@example.com', '255712345002', 'MWANZA', 'Nyamagana'],
      ['Grace Mwakalinga', 'grace@example.com', '255712345003', 'DODOMA', 'Dodoma Urban'],
      ['Daniel Massawe', 'daniel@example.com', '255712345004', 'DAR-ES-SALAAM', 'ILALA'],
      ['Neema Shirima', 'neema@example.com', '255712345005', 'ARUSHA', 'Arusha City'],
      ['Frank Mbwana', 'frank@example.com', '255712345006', 'DAR-ES-SALAAM', 'UBUNGO'],
      ['Halima Juma', 'halima@example.com', '255712345007', 'TANGA', 'Tanga City'],
      ['Peter Ndosi', 'peter@example.com', '255712345008', 'KILIMANJARO', 'Moshi Urban'],
    ];
    const hash = await bcrypt.hash('Customer#2026', 11);
    for (const [name, email, phone, region, district] of people) {
      const u = await prisma.user.create({
        data: {
          publicId: ulid(),
          username: name,
          email,
          phone,
          passwordHash: hash,
          accountType: 'customer',
          emailVerifiedAt: Math.random() > 0.3 ? new Date() : null,
          marketingOptIn: Math.random() > 0.4,
          addresses: {
            create: {
              receiverName: name,
              email,
              phone,
              region,
              district,
              streetAddress: `Plot ${Math.floor(Math.random() * 200) + 1}, ${district}`,
              isDefault: true,
            },
          },
        },
      });
      await prisma.contact.create({
        data: {
          userId: u.id,
          name,
          email,
          phone,
          source: 'registration',
          emailOptIn: u.marketingOptIn,
          smsOptIn: u.marketingOptIn,
        },
      });
    }
    console.log(`  ✓ ${people.length} demo customers`);
  }

  if ((await prisma.order.count()) === 0) {
    const customers = await prisma.user.findMany({
      where: { accountType: 'customer' },
      include: { addresses: true },
    });
    const variants = await prisma.productVariant.findMany({
      where: { deletedAt: null },
      include: { product: { include: { displayImage: true } } },
      take: 200,
    });
    const methods = await prisma.shippingMethod.findMany({ where: { deletedAt: null } });

    const plan: { status: string; paymentStatus: string; fulfilment: string; days: number }[] = [
      { status: 'completed', paymentStatus: 'paid', fulfilment: 'delivered', days: 40 },
      { status: 'completed', paymentStatus: 'paid', fulfilment: 'delivered', days: 34 },
      { status: 'delivered', paymentStatus: 'paid', fulfilment: 'delivered', days: 21 },
      { status: 'delivered', paymentStatus: 'paid', fulfilment: 'delivered', days: 18 },
      { status: 'shipped', paymentStatus: 'paid', fulfilment: 'shipped', days: 9 },
      { status: 'shipped', paymentStatus: 'paid', fulfilment: 'shipped', days: 7 },
      { status: 'processing', paymentStatus: 'paid', fulfilment: 'processing', days: 4 },
      { status: 'confirmed', paymentStatus: 'paid', fulfilment: 'unfulfilled', days: 3 },
      { status: 'confirmed', paymentStatus: 'unpaid', fulfilment: 'unfulfilled', days: 2 },
      { status: 'awaiting_payment', paymentStatus: 'pending_verification', fulfilment: 'unfulfilled', days: 1 },
      { status: 'awaiting_payment', paymentStatus: 'pending_verification', fulfilment: 'unfulfilled', days: 1 },
      { status: 'awaiting_payment', paymentStatus: 'unpaid', fulfilment: 'unfulfilled', days: 0 },
      { status: 'cancelled', paymentStatus: 'unpaid', fulfilment: 'unfulfilled', days: 12 },
      { status: 'expired', paymentStatus: 'unpaid', fulfilment: 'unfulfilled', days: 15 },
    ];

    let seq = 1;
    for (const spec of plan) {
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const address = customer.addresses[0];
      const method = methods[Math.floor(Math.random() * methods.length)];
      const lineCount = 1 + Math.floor(Math.random() * 3);
      const picked: typeof variants = [];
      while (picked.length < lineCount) {
        const v = variants[Math.floor(Math.random() * variants.length)];
        if (v && !picked.find((x) => x.id === v.id)) picked.push(v);
      }

      const items = picked.map((v) => {
        const quantity = 1 + Math.floor(Math.random() * 3);
        return {
          productId: v.productId,
          productVariantId: v.id,
          productName: v.product.name,
          productSlug: v.product.slug,
          variantSku: v.sku,
          variantAttributes: JSON.stringify([]),
          imageUrl: v.product.displayImage?.urlMd ?? null,
          unitPriceAmount: v.priceAmount,
          unitCostAmount: v.costAmount,
          quantity,
          lineTotalAmount: v.priceAmount * quantity,
        };
      });
      const subtotal = items.reduce((n, i) => n + i.lineTotalAmount, 0);
      const total = subtotal + method.costAmount;
      const placedAt = new Date(Date.now() - spec.days * 86_400_000);

      const order = await prisma.order.create({
        data: {
          orderNumber: `TS-${placedAt.getFullYear()}-${pad(seq++, 6)}`,
          userId: customer.id,
          status: spec.status,
          paymentStatus: spec.paymentStatus,
          fulfilmentStatus: spec.fulfilment,
          customerName: customer.username,
          customerEmail: customer.email,
          customerPhone: customer.phone ?? '255700000000',
          shippingMethodId: method.id,
          shippingMethodName: method.name,
          subtotalAmount: subtotal,
          shippingAmount: method.costAmount,
          totalAmount: total,
          paidAmount: spec.paymentStatus === 'paid' ? total : 0,
          paymentMethod: method.isCashOnDelivery ? 'cash' : 'lipa_namba',
          paymentNumber: method.isCashOnDelivery ? null : customer.phone,
          placedAt,
          paidAt: spec.paymentStatus === 'paid' ? new Date(placedAt.getTime() + 3_600_000) : null,
          shippedAt: ['shipped', 'delivered', 'completed'].includes(spec.status)
            ? new Date(placedAt.getTime() + 2 * 86_400_000)
            : null,
          deliveredAt: ['delivered', 'completed'].includes(spec.status)
            ? new Date(placedAt.getTime() + 4 * 86_400_000)
            : null,
          cancelledAt: spec.status === 'cancelled' ? new Date(placedAt.getTime() + 86_400_000) : null,
          cancelReason: spec.status === 'cancelled' ? 'Changed my mind' : null,
          items: { create: items },
          ...(method.requiresShippingAddress && address
            ? {
                address: {
                  create: {
                    receiverName: address.receiverName,
                    email: address.email,
                    phone: address.phone,
                    region: address.region,
                    district: address.district,
                    streetAddress: address.streetAddress,
                  },
                },
              }
            : {}),
          events: {
            create: [
              {
                eventType: 'placed',
                toValue: 'awaiting_payment',
                actorType: 'customer',
                message: 'Order placed',
                createdAt: placedAt,
              },
            ],
          },
        },
      });

      if (spec.paymentStatus === 'paid') {
        await prisma.payment.create({
          data: {
            orderId: order.id,
            method: order.paymentMethod ?? 'lipa_namba',
            provider: 'manual',
            amount: total,
            status: 'succeeded',
            payerPhone: customer.phone,
            providerReference: `MP${Date.now().toString().slice(-8)}${seq}`,
            merchantReference: order.orderNumber,
            verifiedById: owner.id,
            verifiedAt: new Date(placedAt.getTime() + 3_600_000),
          },
        });
      } else if (spec.paymentStatus === 'pending_verification') {
        await prisma.payment.create({
          data: {
            orderId: order.id,
            method: 'lipa_namba',
            provider: 'manual',
            amount: total,
            status: 'pending',
            payerPhone: customer.phone,
            merchantReference: order.orderNumber,
          },
        });
      }
    }
    console.log(`  ✓ ${plan.length} demo orders across every status`);
  }

  // 14 ─ a few reviews and search logs so the dashboard has something to show
  if ((await prisma.review.count()) === 0) {
    const products = await prisma.product.findMany({ take: 8 });
    const customers = await prisma.user.findMany({ where: { accountType: 'customer' }, take: 8 });
    const bodies = [
      ['Exactly what I needed', 5, 'Arrived the next day in Dar. Works perfectly with the tutorial I was following.'],
      ['Good value', 4, 'Does the job. Packaging could be a little better for the price.'],
      ['Recommended for students', 5, 'Bought three for our robotics club. All working, no faults.'],
      ['Fast delivery upcountry', 4, 'Took three days to Mwanza which is quicker than I expected.'],
    ];
    for (const [i, product] of products.entries()) {
      const [title, rating, body] = bodies[i % bodies.length];
      const customer = customers[i % customers.length];
      if (!customer) continue;
      await prisma.review.create({
        data: {
          productId: product.id,
          userId: customer.id,
          authorName: customer.username,
          rating: rating as number,
          title: title as string,
          body: body as string,
          status: 'approved',
        },
      });
      const agg = await prisma.review.aggregate({
        where: { productId: product.id, status: 'approved' },
        _count: { rating: true },
        _avg: { rating: true },
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { reviewCount: agg._count.rating, averageRating: agg._avg.rating ?? 0 },
      });
    }
    console.log('  ✓ demo reviews');
  }

  if ((await prisma.searchLog.count()) === 0) {
    const terms: [string, number][] = [
      ['arduino', 8], ['resistor', 12], ['raspberry pi', 7], ['esp32', 5],
      ['sensor', 9], ['breadboard', 4], ['servo', 3], ['74hc14', 0],
      ['soldering station', 0], ['lipo battery', 0], ['motor driver', 0], ['multimeter', 2],
    ];
    for (const [term, results] of terms) {
      const times = 1 + Math.floor(Math.random() * 6);
      for (let i = 0; i < times; i += 1) {
        await prisma.searchLog.create({
          data: {
            term,
            normalisedTerm: term,
            resultCount: results,
            createdAt: new Date(Date.now() - Math.floor(Math.random() * 20) * 86_400_000),
          },
        });
      }
    }
    console.log('  ✓ demo search analytics (including zero-result terms)');
  }

  console.log('\n──────────────────────');
  console.log(`  Admin sign-in:  ${OWNER_EMAIL}  /  ${OWNER_PASSWORD}`);
  console.log('  Customer:       amina@example.com  /  Customer#2026');
  console.log('\nSeed complete.\n');
}

main()
  .catch((e) => {
    console.error('\nSeed failed:\n', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
