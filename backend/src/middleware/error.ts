import { NextFunction, Request, Response } from 'express';

/** Errors the app throws on purpose, with a safe client-facing message + status. */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

// Central error handler — never leak stack traces / internals to clients.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}
