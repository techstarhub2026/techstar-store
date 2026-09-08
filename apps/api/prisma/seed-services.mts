/**
 * Seeds the six service cards that were hard-coded into techstarhub.or.tz's
 * home page, so they become admin-editable records instead of markup.
 *
 *     npm run db:seed:services --workspace apps/api
 *
 * Idempotent: each row is keyed on its heading, so re-running updates nothing
 * an operator has since changed and creates no duplicates. Images are pulled
 * from the website's own asset folder into the media library, which is what
 * makes them swappable from the admin afterwards.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { storeImage } from '../src/lib/storage.js';
import { slugify, stripHtml } from '../src/lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'techstarhub');

interface SeedService {
  title: string;
  excerpt: string;
  icon: string;
  link: string;
  image: string;
}

const SERVICES: SeedService[] = [
  {
    title: 'Digital Skills, Coding, AI, and IoT Training',
    excerpt: "We are the Future of STEM and Math Education in Tanzania's Rural and Underserved Communities.",
    icon: 'bi-laptop',
    link: 'courses.html',
    image: 'assets/img/Projects/kida-stem.jpeg',
  },
  {
    title: 'ICT and Digital Solution Consulting',
    excerpt: 'Providing strategic guidance for digital transformation, optimizing operations with cloud solutions, cybersecurity enhancements, and process improvements.',
    icon: 'bi-gear',
    link: 'courses.html',
    image: 'assets/img/about-4.JPG',
  },
  {
    title: 'Prototyping and Testing',
    excerpt: 'Turning concepts into working prototypes, then testing them against real conditions before they go into production.',
    icon: 'bi-box-seam',
    link: 'courses.html',
    image: 'assets/img/new_slider/robot-style-car-with-joystick.jpg',
  },
  {
    title: 'PCB Design and Development',
    excerpt: 'Designing and developing printed circuit boards for teaching kits, prototypes and small production runs.',
    icon: 'bi-cpu',
    link: 'courses.html',
    image: 'assets/img/new_slider/child-making-robot.jpg',
  },
  {
    title: '3D Printing and Scanning',
    excerpt: 'Rapid 3D printing and scanning for enclosures, parts and teaching models.',
    icon: 'bi-printer',
    link: 'courses.html',
    image: 'assets/img/new_slider/father-son-making-robot.jpg',
  },
  {
    title: 'TechStar STEM and IoT - Robotics Kits',
    excerpt: 'Our own STEM, IoT and robotics kits, built for classrooms and makerspaces across Tanzania.',
    icon: 'bi-code-slash',
    link: 'courses.html',
    image: 'assets/img/Projects/bootcamp.JPG',
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
    console.warn(`  ! could not import ${relPath} — leaving the image empty`);
    return null;
  }
}

async function main() {
  console.log('Seeding website services…\n');

  for (const [i, svc] of SERVICES.entries()) {
    const existing = await prisma.service.findFirst({
      where: { heading: svc.title, deletedAt: null },
    });
    if (existing) {
      console.log(`  = "${svc.title}" already present`);
      continue;
    }

    const html = `<p>${svc.excerpt}</p>`;
    const row = await prisma.service.create({
      data: {
        heading: svc.title,
        slug: slugify(svc.title),
        excerpt: svc.excerpt,
        contentHtml: html,
        contentText: stripHtml(html),
        imageId: await importImage(svc.image),
        icon: svc.icon,
        linkUrl: svc.link,
        position: i,
        isActive: true,
        publishedAt: new Date(),
      },
    });
    console.log(`  + ${row.heading}`);
  }

  // Anything that pre-dated this seed sorts after the website's own six, so
  // the home page keeps the intended order until someone reorders it.
  const bumped = await prisma.service.updateMany({
    where: { heading: { notIn: SERVICES.map((s) => s.title) }, position: { lt: SERVICES.length } },
    data: { position: 90 },
  });
  if (bumped.count) {
    console.log(`\n  ~ moved ${bumped.count} pre-existing service(s) to the end of the order`);
  }

  console.log('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
