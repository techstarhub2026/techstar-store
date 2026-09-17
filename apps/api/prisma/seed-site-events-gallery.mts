/**
 * Imports the events and gallery photographs that are hard-coded into
 * techstarhub.or.tz's events.html and gallery.html, so they become records
 * staff can edit instead of markup.
 *
 *     STORE_ADMIN_EMAIL=… STORE_ADMIN_PASSWORD=… \
 *       npm run seed:events-gallery --workspace apps/api
 *
 * Runs over HTTP rather than straight to the database, for the same reason
 * upload-team-photos.mts does: the pictures live in the separate website repo,
 * which never ships with the API, so a seed running inside the container has
 * no files to read. This runs from a machine that has that folder.
 *
 * Idempotent: events are keyed on title and photos on their caption, so a
 * re-run creates nothing twice and leaves alone anything since edited.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'techstarhub');

const API = process.env.STORE_API_URL ?? 'https://store-production-1570.up.railway.app/api/v1';
const IDENTIFIER = process.env.STORE_ADMIN_EMAIL;
const PASSWORD = process.env.STORE_ADMIN_PASSWORD;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

interface SeedEvent {
  title: string;
  startsAt: string;
  endsAt?: string;
  location: string;
  image: string;
  summary: string;
  tags: string[];
  facts: string[];
}

const EVENTS: SeedEvent[] = [
  {
    title: "Empowering Future Innovators: International Women's Day 2025 & TeensInAI Hackathon",
    startsAt: '2025-03-08',
    endsAt: '2025-03-09',
    location: 'Buni Hub, COSTECH Building, Dar es Salaam',
    image: 'assets/img/IWD_hackathon.jpeg',
    summary:
      "A two-day celebration of International Women's Day, run with TeensInAI, bringing young minds together around AI, coding and entrepreneurship.",
    tags: ['Hackathon', 'AI', 'Girls in Tech', 'TeensInAI'],
    facts: [
      '8th & 9th March 2025',
      'Buni Hub, COSTECH Building, Dar es Salaam',
      'Run in collaboration with TeensInAI',
      'Two full days of hackathon activity',
      'Focus on AI, coding and entrepreneurship',
      'Open especially to girls in STEM',
    ],
  },
  {
    title: 'Arduino Day 2025: Celebrating Innovation & Creativity',
    startsAt: '2025-03-24',
    location: 'Mtwara Technical High School, Mtwara',
    // The full-resolution arduino_day.png is 39 MB, well past the upload
    // limit; this is the web-sized export the gallery already uses.
    image: 'assets/img/arduino_day-web.jpg',
    summary:
      "TechStar's stop on the global Arduino Day calendar — a hands-on gathering for makers, students and engineers to explore what the open-source Arduino platform can build.",
    tags: ['Arduino Day', 'Electronics', 'Community'],
    facts: [
      '24 March 2025',
      'Mtwara Technical High School, Mtwara',
      'Part of the global Arduino Day calendar',
      'Open to students, developers and engineers',
      'Hands-on sessions with the Arduino platform',
    ],
  },
];

const PHOTOS: { image: string; caption: string }[] = [
  { image: 'assets/img/IWD_hackathon.jpeg', caption: "International Women's Day & TeensInAI Hackathon" },
  { image: 'assets/img/arduino_day-web.jpg', caption: 'Arduino Day 2025' },
  { image: 'assets/img/Projects/bootcamp.JPG', caption: 'STEM and IoT Robotics Bootcamp' },
  { image: 'assets/img/Projects/bootcamp1-web.jpg', caption: 'Robotics Bootcamp' },
  { image: 'assets/img/Projects/girls-stem.jpeg', caption: 'Girls In STEM and IoT Robotics Bootcamp' },
  { image: 'assets/img/Projects/kida-stem.jpeg', caption: 'Kids STEM and IoT Robotics Bootcamp' },
  { image: 'assets/img/Projects/train-trainer.jpeg', caption: 'Train The Trainer Bootcamp' },
  { image: 'assets/img/Projects/youtha-stem.jpeg', caption: 'Youth STEM and IoT Robotics Bootcamp' },
  { image: 'assets/img/new_slider/child-making-robot.jpg', caption: 'A student building a robot' },
  { image: 'assets/img/new_slider/father-son-making-robot.jpg', caption: 'A parent and child building a robot together' },
  { image: 'assets/img/new_slider/robot-style-car-with-joystick.jpg', caption: 'A remote-controlled robot car' },
  { image: 'assets/img/new_slider/school-kids.jpg', caption: 'Students at a school workshop' },
];

type Auth = Record<string, string>;

async function uploadImage(rel: string, auth: Auth, altText: string): Promise<number | null> {
  try {
    const buffer = await fs.readFile(path.join(SITE_ROOT, rel));
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: MIME[path.extname(rel).toLowerCase()] ?? 'image/jpeg' }),
      path.basename(rel),
    );
    form.append('altText', altText);

    const res = await fetch(`${API}/admin/media`, { method: 'POST', headers: auth, body: form });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const [media] = (await res.json() as { data: { id: number }[] }).data;
    return media.id;
  } catch (err) {
    console.warn(`  ! could not upload ${rel} — ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  if (!IDENTIFIER || !PASSWORD) {
    throw new Error('Set STORE_ADMIN_EMAIL and STORE_ADMIN_PASSWORD to the store admin login.');
  }

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`Login failed (${login.status}): ${await login.text()}`);
  const { data } = await login.json() as { data: { accessToken: string } };
  const auth: Auth = { authorization: `Bearer ${data.accessToken}` };

  // ── events ──
  console.log('Events…');
  const existingEvents = (await (await fetch(`${API}/admin/events`, { headers: auth })).json() as { data: any[] }).data;

  for (const [i, e] of EVENTS.entries()) {
    if (existingEvents.some((row) => row.title === e.title)) {
      console.log(`  = "${e.title.slice(0, 44)}…" already present`);
      continue;
    }
    const imageId = await uploadImage(e.image, auth, e.title);
    const res = await fetch(`${API}/admin/events`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: e.title,
        excerpt: e.summary,
        contentHtml: `<p>${e.summary}</p>`,
        imageId,
        location: e.location,
        startsAt: `${e.startsAt}T00:00:00.000Z`,
        endsAt: e.endsAt ? `${e.endsAt}T00:00:00.000Z` : null,
        tags: e.tags,
        facts: e.facts,
        position: i,
        isActive: true,
      }),
    });
    if (!res.ok) { console.warn(`  ! ${e.title.slice(0, 40)} — ${res.status}: ${await res.text()}`); continue; }
    console.log(`  + ${e.title.slice(0, 52)}`);
  }

  // ── gallery ──
  console.log('\nGallery…');
  const existingPhotos = (await (await fetch(`${API}/admin/gallery-photos`, { headers: auth })).json() as { data: any[] }).data;

  for (const [i, p] of PHOTOS.entries()) {
    if (existingPhotos.some((row) => row.caption === p.caption)) {
      console.log(`  = "${p.caption}" already present`);
      continue;
    }
    const imageId = await uploadImage(p.image, auth, p.caption);
    if (!imageId) continue;

    const res = await fetch(`${API}/admin/gallery-photos`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ imageId, caption: p.caption, position: i, isActive: true }),
    });
    if (!res.ok) { console.warn(`  ! ${p.caption} — ${res.status}: ${await res.text()}`); continue; }
    console.log(`  + ${p.caption}`);
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
