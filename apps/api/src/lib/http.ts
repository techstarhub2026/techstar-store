import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const ok = <T>(res: Response, data: T) => res.json({ data });

export const created = <T>(res: Response, data: T, location?: string) => {
  if (location) res.setHeader('Location', location);
  return res.status(201).json({ data });
};

export const noContent = (res: Response) => res.status(204).end();

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export const collection = <T>(res: Response, data: T[], meta: PageMeta) =>
  res.json({ data, meta });

/** Reads page/pageSize from the query string with sane bounds. */
export function pagination(req: Request, defaultSize = 24, maxSize = 100) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number(req.query.pageSize) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const pageMeta = (page: number, pageSize: number, total: number): PageMeta => ({
  page,
  pageSize,
  total,
  pageCount: Math.max(1, Math.ceil(total / pageSize)),
});
