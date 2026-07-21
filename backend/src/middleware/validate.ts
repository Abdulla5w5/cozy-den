import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from './error';

type Part = 'body' | 'query' | 'params';

/**
 * Validate & sanitize a request part against a zod schema. The PARSED value
 * replaces the raw input, so downstream handlers only ever see typed, coerced,
 * whitelisted data — no trusting raw client input anywhere.
 */
export function validate(schema: ZodSchema, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(new ApiError(400, 'Validation failed', details));
    }
    // Overwrite with the sanitized/coerced output.
    (req as unknown as Record<Part, unknown>)[part] = result.data;
    next();
  };
}
