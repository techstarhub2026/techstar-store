/**
 * Imports the page titles, standfirsts and photographs that were hard-coded
 * into techstarhub.or.tz's inner pages, so they become records staff edit
 * rather than markup.
 *
 *     STORE_ADMIN_EMAIL=… STORE_ADMIN_PASSWORD=… \
 *       npm run seed:page-headers --workspace apps/api
 *
 * Runs over HTTP for the same reason the team and gallery imports do: the
 * photographs live in the website repo, which never ships with the API, so a
 * seed running inside the container has no files to read.
 *
 * Idempotent: a page already carrying a record is left alone, so a re-run
 * never overwrites something an operator has since changed.
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

interface SeedHeader {
  pageKey: string;
  title: string;
  standfirst: string;
  image: string | null;
}

const HEADERS: SeedHeader[] = [
  { pageKey: 'about', title: 'About Us', image: 'assets/img/about-4.JPG',
    standfirst: 'Welcome to TechStar Innovation Hub, a forward-thinking and dynamic platform dedicated to empowering the next generation of innovators through STEM education in coding, Artificial Intelligence (AI), and the Internet of Things (IoT).' },
  { pageKey: 'board', title: 'Our Board', image: 'assets/img/Projects/bootcamp1.JPG',
    standfirst: "The advisory and consulting board guiding TechStar Innovation Hub's strategy and direction." },
  { pageKey: 'staff', title: 'Our Staff', image: 'assets/img/Projects/bootcamp1.JPG',
    standfirst: 'The team members who run TechStar Innovation Hub day to day — programs, partnerships, finance and technology.' },
  { pageKey: 'courses', title: 'Courses', image: 'assets/img/Projects/bootcamp.JPG',
    standfirst: 'Unlock new skills and knowledge with our wide range of courses designed for all ages and skill levels.' },
  { pageKey: 'events', title: 'Events', image: 'assets/img/arduino_day-web.jpg',
    standfirst: "Hackathons, workshops and school visits happening across Tanzania — see what's next below." },
  { pageKey: 'gallery', title: 'Gallery', image: 'assets/img/Projects/bootcamp1.JPG',
    standfirst: 'Moments from our bootcamps, workshops and events across Tanzania.' },
  { pageKey: 'news', title: 'News', image: 'assets/img/Projects/bootcamp1.JPG',
    standfirst: 'Announcements, milestones and stories from TechStar Innovation Hub.' },
  { pageKey: 'projects', title: 'Our Projects', image: 'assets/img/Projects/bootcamp1.JPG',
    standfirst: 'What TechStar Innovation Hub is building right now, and what we have already delivered.' },
  { pageKey: 'pricing', title: 'Pricing', image: 'assets/img/slide/slide-2.jpg',
    standfirst: 'Plans and programme fees for TechStar Innovation Hub.' },
  { pageKey: 'privacy', title: 'Privacy Policy', image: 'assets/img/about-3.jpg',
    standfirst: 'How TechStar Innovation Hub handles your information.' },
  { pageKey: 'terms', title: 'Terms of Service', image: 'assets/img/about-3.jpg',
    standfirst: 'The terms that apply when you use TechStar Innovation Hub.' },
  { pageKey: 'program-stem', title: 'STEM and IoT - Robotics Bootcamps', image: 'assets/img/new_slider/school-kids.jpg',
    standfirst: 'Hands-on bootcamps in STEM, IoT and robotics for learners across Tanzania.' },
  { pageKey: 'program-kids', title: 'Kids STEM and IoT - Robotics Bootcamps', image: 'assets/img/new_slider/child-making-robot.jpg',
    standfirst: 'Introducing younger learners to building, coding and robotics.' },
  { pageKey: 'program-trainer', title: 'Train The Trainer STEM and IoT - Robotics Bootcamps', image: 'assets/img/new_slider/father-son-making-robot.jpg',
    standfirst: 'Equipping teachers to run STEM, IoT and robotics sessions of their own.' },
  { pageKey: 'program-youth', title: 'Youth STEM and IoT - Robotics Bootcamps', image: 'assets/img/new_slider/robot-style-car-with-joystick.jpg',
    standfirst: 'Practical robotics and IoT training for young people entering the field.' },
  { pageKey: 'program-girls', title: 'Girls In STEM and IoT - Robotics Bootcamps', image: 'assets/img/IWD_hackathon.jpeg',
    standfirst: 'Programmes created to bring more girls into STEM, IoT and robotics.' },
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
    if (!res.ok) throw new Error(`${res.status}`);
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

  const existing = (await (await fetch(`${API}/admin/page-headers`, { headers: auth })).json() as { data: any[] }).data;

  for (const h of HEADERS) {
    if (existing.some((row) => row.pageKey === h.pageKey)) {
      console.log(`  = ${h.pageKey} already present`);
      continue;
    }

    const imageId = h.image ? await uploadImage(h.image, auth, h.title) : null;

    const res = await fetch(`${API}/admin/page-headers`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        pageKey: h.pageKey,
        title: h.title,
        standfirst: h.standfirst,
        imageId,
        isActive: true,
      }),
    });
    if (!res.ok) { console.warn(`  ! ${h.pageKey} — ${res.status}: ${await res.text()}`); continue; }
    console.log(`  + ${h.pageKey} — ${h.title}`);
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
