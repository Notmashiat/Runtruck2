import type { NextFunction, Request, Response } from 'express';

// Every /api/v1 response is private tenant data (payroll, HR, /me …) or an error about it,
// so no browser or intermediary may keep a copy: without these headers Chromium stores the
// JSON in its disk cache, where it outlives sign-out (docs/19-security.md §2 "Caching").
// A handler may still set an equal or stricter value (the document download, when built,
// sends `private, no-store`, docs/13-document-system.md).
export function noStoreMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}
