import { createApp } from './app.js';
import { config } from './config/index.js';
import { prisma } from './lib/prisma.js';
import { ensureMediaRoot } from './lib/storage.js';
import { startScheduler } from './jobs/scheduler.js';

async function main() {
  await ensureMediaRoot();
  await prisma.$connect();

  const app = createApp();

  const server = app.listen(config.API_PORT, () => {
    console.log(
      `\n  ${config.APP_NAME} API\n` +
        `  ─────────────────────────────────────────────\n` +
        `  mode      ${config.NODE_ENV}\n` +
        `  api       http://localhost:${config.API_PORT}/api/v1\n` +
        `  health    http://localhost:${config.API_PORT}/api/v1/health\n` +
        `  media     ${config.MEDIA_PUBLIC_URL}\n`,
    );
  });

  // A port clash is an operator problem, not a crash. Say what to do about it
  // instead of printing a stack trace nobody can act on.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n  Port ${config.API_PORT} is already in use.\n\n` +
          `  Another API is probably still running. Either stop it, or set\n` +
          `  API_PORT in .env to a free port (and update MEDIA_PUBLIC_URL and\n` +
          `  the proxy in apps/web/vite.config.ts to match).\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  const stopScheduler = startScheduler();

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down`);
    stopScheduler();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start the API:', err);
  process.exit(1);
});
