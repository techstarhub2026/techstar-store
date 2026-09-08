import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { config } from './config/index.js';
import {
  authenticate,
  errorHandler,
  notFound,
  requestId,
  requestLog,
} from './middleware/index.js';
import { authRouter } from './modules/auth.js';
import { meRouter } from './modules/me.js';
import { catalogueRouter } from './modules/catalogue.js';
import { cartRouter } from './modules/cart.js';
import { orderRouter } from './modules/orders.js';
import { contentRouter } from './modules/content.js';
import { mediaRouter } from './modules/media.js';
import { adminCatalogueRouter } from './modules/admin/catalogue.js';
import { adminSalesRouter } from './modules/admin/sales.js';
import { adminContentRouter } from './modules/admin/content.js';
import { adminSiteRouter } from './modules/admin/siteContent.js';
import { adminSystemRouter } from './modules/admin/system.js';
import { adminInventoryRouter } from './modules/admin/inventory.js';
import { adminReportsRouter } from './modules/admin/reports.js';
import { requireStaff } from './middleware/index.js';
import { prisma } from './lib/prisma.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── pipeline, in the order specified in §4.3 ──────────────────────
  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: false, // the SPA is served separately in development
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: config.isProd ? [config.APP_URL, config.SITE_URL] : true,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));
  app.use(cookieParser());
  app.use(requestLog);

  // Uploaded media, served with a long immutable cache and no execution.
  app.use(
    '/media',
    express.static(config.mediaRoot, {
      maxAge: '365d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
      },
    }),
  );

  const api = express.Router();
  api.use(authenticate);

  const writeLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isProd ? 300 : 10_000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isProd ? 20 : 1000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  api.get('/health', async (_req, res) => {
    res.json({ status: 'ok', name: config.APP_NAME, time: new Date().toISOString() });
  });
  api.get('/health/deep', async (_req, res) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      res.json({ status: 'ok', database: 'ok' });
    } catch (e) {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  api.use('/auth', authLimiter, authRouter);
  api.use('/me', meRouter);
  api.use('/', catalogueRouter);
  api.use('/', cartRouter);
  api.use('/', writeLimiter, orderRouter);
  api.use('/', contentRouter);

  // ── admin ────────────────────────────────────────────────────────
  const admin = express.Router();
  admin.use(requireStaff);
  admin.use('/media', mediaRouter);
  admin.use('/', adminCatalogueRouter);
  admin.use('/', adminSalesRouter);
  admin.use('/', adminContentRouter);
  admin.use('/', adminSiteRouter);
  admin.use('/', adminSystemRouter);
  admin.use('/', adminInventoryRouter);
  admin.use('/', adminReportsRouter);
  api.use('/admin', admin);

  app.use('/api/v1', api);

  // ── SPA ──────────────────────────────────────────────────────────
  // In production the built frontend is served from this same origin, so the
  // browser's relative `/api/v1/...` calls need no CORS and the refresh cookie
  // behaves exactly as it does in development behind the Vite proxy.
  //
  // This sits after the API router so a genuinely missing endpoint still gets
  // the JSON 404 below rather than the HTML shell, which would otherwise turn
  // every API typo into a confusing "unexpected token <" parse error.
  if (config.SPA_ROOT) {
    const spaRoot = config.SPA_ROOT;

    app.use(
      express.static(spaRoot, {
        // Hashed asset filenames may be cached indefinitely; index.html must
        // not be, or a deploy leaves browsers pinned to the previous bundle.
        index: false,
        setHeaders(res, filePath) {
          if (path.basename(filePath) === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );

    app.get(/^(?!\/api\/|\/media\/).*/, (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      // Every deep client-side route (/admin, /admin/site/hero, ...) falls
      // through express.static above — nothing on disk matches that path —
      // and lands here. This `res.sendFile` is a separate call from the one
      // express.static makes internally, so it does NOT go through that
      // middleware's `setHeaders` callback above; without an explicit
      // header here it fell back to sendFile's own default of a bare
      // `max-age=0`, weaker than the `no-cache` set for a direct
      // `/index.html` request. The two are meant to behave identically —
      // both are the same file — but only one of them actually was,
      // so reloading while deep in the admin (which is every reload, since
      // the SPA never sits at the bare /index.html URL) could serve a
      // stale cached shell depending on how strictly the browser or an
      // intermediate proxy treated that weaker header.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(spaRoot, 'index.html'), (err) => {
        if (err) next();
      });
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
