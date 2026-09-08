/**
 * Seeds the techstarhub.or.tz homepage blocks from the content that is
 * currently hard-coded in the mirrored site's index.html.
 *
 * Run once after `db:push` adds the tables:
 *     npm run db:seed:site --workspace apps/api
 *
 * Idempotent: every record is keyed on a natural field, so re-running adds
 * nothing and overwrites nothing an operator has since edited. Images are
 * imported into the media library from the website's own asset folder, so
 * each block arrives fully editable rather than pointing at a fixed path.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { storeImage } from '../src/lib/storage.js';
import { slugify, stripHtml } from '../src/lib/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/prisma -> repo root -> techstarhub
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'techstarhub');

/** Imports a file from the website's assets into the media library, once. */
async function importImage(relPath: string): Promise<number | null> {
  const abs = path.join(SITE_ROOT, relPath);
  try {
    const buffer = await fs.readFile(abs);
    // storeImage deduplicates by checksum, so a repeat run reuses the row.
    const media = await storeImage(buffer, { originalFilename: path.basename(relPath) });
    return media.id;
  } catch {
    console.warn(`  ! could not import image ${relPath} — leaving it empty`);
    return null;
  }
}

async function seedHeroSlides() {
  const slides = [
    {
      title: 'TechStar Innovation Hub',
      subtitle: "We are the Future of STEM and Math Education in Tanzania's Rural and Underserved Communities.",
      tabLabel: 'STEM Bootcamps',
      image: 'assets/img/new_slider/school-kids.jpg',
      buttonText: 'Explore Programs',
      buttonUrl: 'courses.html',
    },
    {
      title: 'Crafting Concepts into Living Innovations',
      subtitle: 'Our Company is dedicated to nurturing a new generation of innovators and leaders by engaging them in hands-on learning and practical application, aimed at making a positive impact in their communities.',
      tabLabel: 'IoT & Robotics',
      image: 'assets/img/new_slider/Screenshot.png',
      buttonText: 'Explore Programs',
      buttonUrl: 'courses.html',
    },
    {
      title: 'Now Open: TechStar Store',
      subtitle: 'Arduino boards, sensors, Raspberry Pi, robotics kits and every part your next build needs — sourced by the same team that trains you, delivered across Tanzania.',
      tabLabel: 'TechStar Store',
      image: null,
      buttonText: 'Shop the Store',
      buttonUrl: 'http://localhost:5173/',
    },
  ];

  for (const [i, s] of slides.entries()) {
    const existing = await prisma.heroSlide.findFirst({ where: { tabLabel: s.tabLabel } });
    if (existing) { console.log(`  = hero slide "${s.tabLabel}" already present`); continue; }
    await prisma.heroSlide.create({
      data: {
        title: s.title,
        subtitle: s.subtitle,
        tabLabel: s.tabLabel,
        imageId: s.image ? await importImage(s.image) : null,
        buttonText: s.buttonText,
        buttonUrl: s.buttonUrl,
        position: i,
      },
    });
    console.log(`  + hero slide "${s.tabLabel}"`);
  }
}

async function seedHighlights() {
  const cards = [
    { pill: 'Who We Are', title: 'Leading Provider of STEM, IoT and Robotics Education', variant: 'navy', image: 'assets/img/about.jpeg', linkUrl: 'about.html' },
    { pill: 'Recognition', title: 'Girls in STEM and IoT – Robotics Bootcamps', variant: 'orange', image: 'assets/img/Projects/girls-stem.jpeg', linkUrl: 'project5-details.html' },
    { pill: 'Programs', title: 'Train the Trainer STEM and IoT Bootcamps', variant: 'navy', image: 'assets/img/Projects/train-trainer.jpeg', linkUrl: 'project3-details.html' },
  ];

  for (const [i, c] of cards.entries()) {
    const existing = await prisma.highlightCard.findFirst({ where: { title: c.title } });
    if (existing) { console.log(`  = highlight "${c.pill}" already present`); continue; }
    await prisma.highlightCard.create({
      data: {
        pill: c.pill,
        title: c.title,
        variant: c.variant,
        linkUrl: c.linkUrl,
        imageId: await importImage(c.image),
        position: i,
      },
    });
    console.log(`  + highlight "${c.pill}"`);
  }
}

async function seedStats() {
  const stats = [
    { label: 'Students', value: 12500 },
    { label: 'Schools', value: 200 },
    { label: 'Young Innovators Supported', value: 300 },
    { label: 'TechStar IoT Kits', value: 250 },
  ];

  for (const [i, s] of stats.entries()) {
    const existing = await prisma.siteStat.findFirst({ where: { label: s.label } });
    if (existing) { console.log(`  = stat "${s.label}" already present`); continue; }
    await prisma.siteStat.create({ data: { ...s, position: i } });
    console.log(`  + stat "${s.label}"`);
  }
}

async function seedProjects() {
  const programs = [
    { title: 'STEM and IoT - Robotics Bootcamps', image: 'assets/img/Projects/bootcamp.JPG', excerpt: 'Immersive programs crafted to ignite curiosity and foster critical thinking, problem-solving and creativity in participants of all ages.' },
    { title: 'Kids STEM and IoT - Robotics Bootcamps', image: 'assets/img/Projects/kida-stem.jpeg', excerpt: 'Hands-on introductions to electronics, coding and robotics designed for primary and lower-secondary learners.' },
    { title: 'Train The Trainer STEM and IoT - Robotics Bootcamps', image: 'assets/img/Projects/train-trainer.jpeg', excerpt: 'Equipping teachers to deliver STEM, IoT and robotics lessons confidently in their own classrooms.' },
    { title: 'Youth STEM and IoT - Robotics Bootcamps', image: 'assets/img/Projects/youtha-stem.jpeg', excerpt: 'Project-based bootcamps helping young people turn ideas into working prototypes and real solutions.' },
    { title: 'Girls In STEM and IoT - Robotics Bootcamps', image: 'assets/img/Projects/girls-stem.jpeg', excerpt: 'Dedicated bootcamps widening participation for girls in science, technology, engineering and mathematics.' },
  ];

  for (const [i, p] of programs.entries()) {
    const existing = await prisma.project.findFirst({ where: { title: p.title } });
    if (existing) { console.log(`  = program "${p.title}" already present`); continue; }
    const html = `<p>${p.excerpt}</p>`;
    await prisma.project.create({
      data: {
        title: p.title,
        slug: slugify(p.title),
        excerpt: p.excerpt,
        contentHtml: html,
        contentText: stripHtml(html),
        imageId: await importImage(p.image),
        position: i,
      },
    });
    console.log(`  + program "${p.title}"`);
  }
}

async function main() {
  console.log('Seeding techstarhub website content…\n');
  console.log('Hero slides:');      await seedHeroSlides();
  console.log('\nHighlight cards:'); await seedHighlights();
  console.log('\nImpact numbers:');  await seedStats();
  console.log('\nPrograms:');        await seedProjects();
  console.log('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
