import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { getLogger } from './logger';

const log = getLogger('errors');

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
  }
}

export const badRequest = (code = 'bad_request', message?: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (code = 'unauthorized', message?: string) => new AppError(401, code, message);
export const forbidden = (code = 'forbidden', message?: string) => new AppError(403, code, message);
export const notFound = (code = 'not_found', message?: string) => new AppError(404, code, message);
export const conflict = (code = 'conflict', message?: string) => new AppError(409, code, message);
export const tooLarge = (message?: string) => new AppError(413, 'too_large', message);
export const unsupportedMedia = (message?: string) => new AppError(415, 'unsupported_media_type', message);
export const rateLimited = (message?: string) => new AppError(429, 'rate_limited', message);

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details: details ?? null } };
}

/** One entry per problem; `field` is the dotted path inside the body or query (e.g. `doseAmount`). */
export function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
}

export class ValidationError extends AppError {
  constructor(err: ZodError) {
    super(422, 'validation_error', 'Some fields are not valid.', zodDetails(err));
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody('not_found', 'Not found.'));
};

// Express error handlers need all four arguments.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json(errorBody(err.code, err.message, err.details));
    return;
  }
  const e = err as { type?: string; status?: number; statusCode?: number };
  if (e.type === 'entity.too.large') {
    res.status(413).json(errorBody('too_large', 'The request is too large.'));
    return;
  }
  if (e.type === 'entity.parse.failed') {
    res.status(422).json(errorBody('validation_error', 'Some fields are not valid.', [{ field: '', message: 'Body is not valid JSON' }]));
    return;
  }
  if (err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json(errorBody('too_large', 'The photo is larger than 8 MB.'));
    return;
  }
  log.exception('unhandled_error', err, { path: req.path });
  res.status(500).json(errorBody('internal_error', 'Something went wrong.'));
};
