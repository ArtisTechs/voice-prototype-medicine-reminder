/**
 * Route helper: validation, auth, patient access and the OpenAPI registry in one place, so a route
 * cannot forget them. Handlers get parsed input and return the JSON body (or nothing for 204).
 * Device (ESP32) routes use plain Express handlers and never go through here.
 */
import type { PatientCaregiver, User } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z, ZodTypeAny } from 'zod';
import { ValidationError, notFound, unauthorized } from './errors';
import { decodeToken } from './security';
import * as patientRepo from '../repositories/patients';
import * as userRepo from '../repositories/users';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Ctx<B, Q> {
  req: Request;
  res: Response;
  user: User;
  body: B;
  query: Q;
  /** Numeric path parameters, e.g. patientId, medicineId. */
  params: Record<string, number>;
  /** The caregiver's link to :patientId (only on patient-scoped routes). */
  link: PatientCaregiver;
}

export interface Spec<B extends ZodTypeAny | undefined, Q extends ZodTypeAny | undefined> {
  tag: string;
  summary: string;
  /** Default true. Only signup/login/refresh/meta are public. */
  auth?: boolean;
  /** Patient-scoped routes also need the caregiver to be the patient's owner. */
  owner?: boolean;
  body?: B;
  query?: Q;
  status?: number;
  /** Extra middleware (multipart upload) that runs after auth. Such routes parse their own input. */
  middleware?: RequestHandler[];
  /** Overrides the documented request body (multipart). */
  docBody?: unknown;
}

export interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth: boolean;
  patientScoped: boolean;
  owner: boolean;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  status: number;
  docBody?: unknown;
}

/** Every route registered through `route()`; the security tests and /docs read it. */
export const registry: RouteDoc[] = [];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h && h.toLowerCase().startsWith('bearer ') ? h.slice(7) : undefined;
}

export async function userFromToken(token: string | undefined): Promise<User | null> {
  const data = decodeToken(token ?? '', 'access');
  if (!data) return null;
  return userRepo.byId(Number(data.sub));
}

const authenticate: RequestHandler = async (req, _res, next) => {
  const user = await userFromToken(bearer(req));
  if (!user) throw unauthorized('unauthorized', 'Please sign in again.');
  req.user = user;
  next();
};

function parse<T extends ZodTypeAny>(schema: T | undefined, value: unknown): z.infer<T> {
  if (!schema) return undefined as z.infer<T>;
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(r.error);
  return r.data;
}

export function route<B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined>(
  router: Router,
  method: Method,
  path: string,
  spec: Spec<B, Q>,
  handler: (ctx: Ctx<B extends ZodTypeAny ? z.infer<B> : undefined, Q extends ZodTypeAny ? z.infer<Q> : undefined>) => Promise<unknown>,
): void {
  const auth = spec.auth ?? true;
  const patientScoped = path.includes(':patientId');
  const status = spec.status ?? 200;
  registry.push({
    method, path, tag: spec.tag, summary: spec.summary, auth, patientScoped, owner: !!spec.owner,
    body: spec.body, query: spec.query, status, docBody: spec.docBody,
  });

  const run = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(req.params)) {
        if (!/^\d+$/.test(String(v))) throw new ValidationError(new z.ZodError([{ code: 'custom', path: [k], message: 'Must be a number' }]));
        params[k] = Number(v);
      }
      let link = undefined as unknown as PatientCaregiver;
      if (patientScoped) {
        // 404 (not 403) when the caregiver is not linked, so patient ids do not leak.
        const l = await patientRepo.link(req.user!.id, params.patientId);
        if (!l || (spec.owner && l.role !== 'owner')) throw notFound('not_found', 'Patient not found.');
        link = l;
      }
      const out = await handler({
        req, res, user: req.user as User, link, params,
        body: parse(spec.middleware ? undefined : spec.body, req.body) as never,
        query: parse(spec.query, req.query) as never,
      });
      if (res.headersSent) return;
      if (status === 204 || out === undefined) res.status(status === 200 && out === undefined ? 204 : status).end();
      else res.status(status).json(out);
    } catch (e) {
      next(e);
    }
  };

  const chain: RequestHandler[] = [];
  if (auth) chain.push(authenticate);
  chain.push(...(spec.middleware ?? []));
  router[method](path, ...chain, run);
}
