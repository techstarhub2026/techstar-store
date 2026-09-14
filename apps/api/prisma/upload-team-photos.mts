/**
 * Uploads the team photos to a running store API and attaches them to the
 * matching team members.
 *
 *     npm run team:photos --workspace apps/api
 *
 * The photos live in the separate techstarhub website repo, which is never
 * deployed alongside the API, so `db:seed:team` running inside the container
 * has no files to read and leaves every photo empty. This script runs from a
 * machine that does have that folder and pushes the images over HTTP instead.
 *
 * Idempotent: a member who already has a photo is skipped, so re-running will
 * not replace a picture someone has since changed from the admin.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'techstarhub');

const API = process.env.STORE_API_URL ?? 'https://store-production-1570.up.railway.app/api/v1';
const IDENTIFIER = process.env.STORE_ADMIN_EMAIL;
const PASSWORD = process.env.STORE_ADMIN_PASSWORD;

/** Photo for each person, keyed by the exact name the seed created. */
const PHOTOS: Record<string, string> = {
  'Eng. Michael Thomas': 'assets/img/trainers/trainer-1-1.jpeg',
  'Ms. Jessica Mshama': 'assets/img/trainers/trainer-6.jpeg',
  'Eng. Fatuma Mwamba': 'assets/img/trainers/trainer-2-1.jpeg',
  'Mr. Stanley Mosha': 'assets/img/trainers/trainer-3.jpeg',
  'Ms. Agness Kalanje': 'assets/img/trainers/trainer-2-21.png',
  'Dr. Erasto S Mlyuka': 'assets/img/trainers/trainer-51.png',
  'Eng. Ibrahim Jengo': 'assets/img/trainers/trainer-4.jpeg',
  'Professor Niklas Lavesson': 'assets/img/trainers/member-1.jpeg',
  'Dr. Jabhera Matogoro': 'assets/img/trainers/member-2.jpeg',
};

const MIME: Record<string, string> = { '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };

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
  const auth = { authorization: `Bearer ${data.accessToken}` };

  const listed = await fetch(`${API}/admin/team-members`, { headers: auth });
  if (!listed.ok) throw new Error(`Could not list team members (${listed.status})`);
  const members = (await listed.json() as { data: any[] }).data;

  for (const member of members) {
    const rel = PHOTOS[member.name];
    if (!rel) {
      console.log(`  ? no photo mapped for "${member.name}" — skipping`);
      continue;
    }
    if (member.image) {
      console.log(`  = ${member.name} already has a photo`);
      continue;
    }

    const buffer = await fs.readFile(path.join(SITE_ROOT, rel));
    const filename = path.basename(rel);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: MIME[path.extname(rel).toLowerCase()] ?? 'image/jpeg' }),
      filename,
    );
    form.append('altText', member.name);

    const uploaded = await fetch(`${API}/admin/media`, { method: 'POST', headers: auth, body: form });
    if (!uploaded.ok) throw new Error(`Upload failed for ${member.name} (${uploaded.status}): ${await uploaded.text()}`);
    const [media] = (await uploaded.json() as { data: any[] }).data;

    const patched = await fetch(`${API}/admin/team-members/${member.id}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ imageId: media.id }),
    });
    if (!patched.ok) throw new Error(`Could not attach photo for ${member.name} (${patched.status})`);

    console.log(`  + ${member.name} → ${filename}`);
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
