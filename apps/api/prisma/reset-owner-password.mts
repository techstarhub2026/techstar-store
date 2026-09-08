import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const pw = process.env.SEED_OWNER_PASSWORD ?? 'TechStar#2026';
const email = process.env.SEED_OWNER_EMAIL ?? 'admin@techstar.co.tz';

async function main() {
  await prisma.user.update({
    where: { email },
    data: { passwordHash: await bcrypt.hash(pw, 11) },
  });
  console.log(`owner password for ${email} set to: ${pw}`);
}

main().finally(() => prisma.$disconnect());
