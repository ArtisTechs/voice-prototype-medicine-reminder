/** JSON line logging. Log ids, counts and timings only: never names, emails, tokens or package text. */
import pino from 'pino';
import { settings } from './config';

const REDACT = ['password', 'token', 'access', 'refresh', 'email', 'name', 'text', 'authorization', 'body', 'readName'];

const base = pino({
  level: settings().ENV === 'test' ? 'silent' : settings().LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'event',
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT, censor: '[redacted]' },
});

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Logs the error class and stack, never its message (messages can carry personal text). */
  exception(event: string, err: unknown, fields?: Record<string, unknown>): void;
}

export function getLogger(name: string): Logger {
  const log = base.child({ logger: name });
  return {
    debug: (e, f) => log.debug(f ?? {}, e),
    info: (e, f) => log.info(f ?? {}, e),
    warn: (e, f) => log.warn(f ?? {}, e),
    error: (e, f) => log.error(f ?? {}, e),
    exception: (e, err, f) =>
      log.error({ ...(f ?? {}), error: err instanceof Error ? err.name : typeof err, stack: err instanceof Error ? err.stack : undefined }, e),
  };
}
