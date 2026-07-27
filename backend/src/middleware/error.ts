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

  // Rejections that are the CLIENT's fault must not be logged and reported as
  // server errors. They were already refused correctly, but a 500 both misleads
  // the caller and buries genuine faults in the noise — a 500 rate is only a
  // useful alarm if malformed input cannot set it off.
  const e = err as { type?: string; status?: number; message?: string };

  if (e.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (e.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (e.message?.startsWith('Origin ') && e.message.includes('not allowed by CORS')) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}
