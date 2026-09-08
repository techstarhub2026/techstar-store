/**
 * Seeds the "What We Offer" block from the copy currently hard-coded into
 * techstarhub.or.tz's home page, so it becomes an editable record.
 *
 *     npm run db:seed:offer --workspace apps/api
 *
 * Idempotent: the block is a single row at id 1, so a re-run leaves an
 * operator's edits alone rather than overwriting them.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { storeImage } from '../src/lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'techstarhub');
const IMAGE = 'assets/img/about.jpeg';

async function main() {
  const existing = await prisma.homeOffer.findFirst();
  if (existing) {
    console.log('"What We Offer" block already present — leaving it untouched.');
    return;
  }

  let imageId: number | null = null;
  try {
    const buffer = await fs.readFile(path.join(SITE_ROOT, IMAGE));
    // Deduplicated by checksum, so an image pulled in by an earlier seed is
    // reused rather than stored twice.
    const media = await storeImage(buffer, { originalFilename: path.basename(IMAGE) });
    imageId = media.id;
  } catch {
    console.warn(`  ! could not import ${IMAGE} — leaving the image empty`);
  }

  const row = await prisma.homeOffer.create({
    data: {
      title: 'What We Offer',
      lead: 'We offer a variety of programs that help to nurture young minds, including '
        + 'interactive workshops, after-school programs and competitions built around real technology.',
      bullets: [
        'Interactive coding, AI and IOT Workshops and Bootcamps',
        'Regular after-school programs to help reinforce learning, with techstar innovation hubship and guidance from tech experts',
        'Hackathons and Competitions, that encourage innovation through challenges, showcasing talents and solutions',
      ],
      imageId,
      linkText: 'Read More',
      linkUrl: 'courses.html',
    },
  });

  console.log(`+ seeded "${row.title}" (image ${imageId ?? 'none'})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
