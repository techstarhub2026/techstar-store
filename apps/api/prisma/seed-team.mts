/**
 * Seeds the nine people hard-coded into techstarhub.or.tz's staff.html and
 * board.html pages, so they become admin-editable records instead of markup
 * an operator would otherwise have to hand-edit HTML to change.
 *
 *     npm run db:seed:team --workspace apps/api
 *
 * Idempotent: each row is keyed on its name, so re-running updates nothing an
 * operator has since changed and creates no duplicates. Placeholder social
 * links ("#") from the original markup are left out entirely rather than
 * seeded as dead links.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { storeImage } from '../src/lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'techstarhub');

interface SeedMember {
  name: string;
  role: string;
  group: 'staff' | 'board';
  image: string;
  facebookUrl?: string;
  xUrl?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
}

const MEMBERS: SeedMember[] = [
  // ── staff.html — "Our Staff" ──
  {
    name: 'Eng. Michael Thomas',
    role: 'Founder & CEO, TechStar Innovation Hub',
    group: 'staff',
    image: 'assets/img/trainers/trainer-1-1.jpeg',
  },
  {
    name: 'Ms. Jessica Mshama',
    role: 'Co-Founder & Finance Manager, TechStar Innovation Hub',
    group: 'staff',
    image: 'assets/img/trainers/trainer-6.jpeg',
    instagramUrl: 'https://www.instagram.com/jessicamshama/',
    linkedinUrl: 'https://www.linkedin.com/in/jessica-mshama-51a997187/',
  },
  {
    name: 'Eng. Fatuma Mwamba',
    role: 'Co-Founder & Technology Officer, TechStar Innovation Hub',
    group: 'staff',
    image: 'assets/img/trainers/trainer-2-1.jpeg',
  },
  {
    name: 'Mr. Stanley Mosha',
    role: 'Business and Strategic Partnership Manager',
    group: 'staff',
    image: 'assets/img/trainers/trainer-3.jpeg',
  },
  {
    name: 'Ms. Agness Kalanje',
    role: 'Project & Program Manager, TechStar Innovation Hub',
    group: 'staff',
    image: 'assets/img/trainers/trainer-2-21.png',
  },
  // ── board.html — "Our Board" ──
  {
    name: 'Dr. Erasto S Mlyuka',
    role: 'Advisory and Consulting Board member, TechStar Innovation Hub',
    group: 'board',
    image: 'assets/img/trainers/trainer-51.png',
  },
  {
    name: 'Eng. Ibrahim Jengo',
    role: 'Advisory and Consulting Board member',
    group: 'board',
    image: 'assets/img/trainers/trainer-4.jpeg',
  },
  {
    name: 'Professor Niklas Lavesson',
    role: 'Advisory and Consulting Board member',
    group: 'board',
    image: 'assets/img/trainers/member-1.jpeg',
  },
  {
    name: 'Dr. Jabhera Matogoro',
    role: 'Advisory and Consulting Board member',
    group: 'board',
    image: 'assets/img/trainers/member-2.jpeg',
  },
];

async function importImage(relPath: string): Promise<number | null> {
  try {
    const buffer = await fs.readFile(path.join(SITE_ROOT, relPath));
    // storeImage deduplicates by checksum, so images already pulled in by an
    // earlier seed are reused rather than stored twice.
    const media = await storeImage(buffer, { originalFilename: path.basename(relPath) });
    return media.id;
  } catch {
    console.warn(`  ! could not import ${relPath} — leaving the photo empty`);
    return null;
  }
}

async function main() {
  console.log('Seeding website team members…\n');

  const positions: Record<'staff' | 'board', number> = { staff: 0, board: 0 };

  for (const m of MEMBERS) {
    const existing = await prisma.teamMember.findFirst({
      where: { name: m.name, deletedAt: null },
    });
    const position = positions[m.group]++;
    if (existing) {
      console.log(`  = "${m.name}" already present`);
      continue;
    }

    const row = await prisma.teamMember.create({
      data: {
        name: m.name,
        role: m.role,
        group: m.group,
        imageId: await importImage(m.image),
        facebookUrl: m.facebookUrl ?? null,
        xUrl: m.xUrl ?? null,
        instagramUrl: m.instagramUrl ?? null,
        linkedinUrl: m.linkedinUrl ?? null,
        position,
        isActive: true,
      },
    });
    console.log(`  + [${row.group}] ${row.name}`);
  }

  console.log('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
