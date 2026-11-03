/** OpenAPI document for /api/v1 + the ESP32 paths, built from the route registry. Served at /docs when ENABLE_DOCS. */
import { Router } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { registry } from './http';

const bodyJson = (schema: unknown) => zodToJsonSchema(schema as never, { target: 'openApi3', $refStrategy: 'none' });

function build() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry) {
    const path = `/api/v1${r.path}`.replace(/:(\w+)/g, '{$1}');
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'integer' } }));
    if (r.query) {
      const q = bodyJson(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {})) {
        params.push({ name, in: 'query', required: (q.required ?? []).includes(name), schema } as never);
      }
    }
    (paths[path] ??= {})[r.method] = {
      tags: [r.tag],
      summary: r.summary,
      security: r.auth ? [{ bearer: [] }] : [],
      parameters: params,
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: bodyJson(r.body) } } } } : {}),
      ...(r.docBody ? { requestBody: { required: true, content: r.docBody } } : {}),
      responses: { [String(r.status)]: { description: 'OK' }, '401': { description: 'Not signed in' }, '422': { description: 'Validation error' } },
    };
  }
  const device = (summary: string, method: string, path: string, extra: object) => ({ [path]: { [method]: { tags: ['device-firmware'], summary, security: [], ...extra } } });
  Object.assign(
    paths,
    device('Doses of today for the pillbox (also its heartbeat)', 'get', '/api/schedule', {
      parameters: [{ name: 'device', in: 'query', required: true, schema: { type: 'string', maxLength: 32 } }],
      responses: { '200': { description: '{ doses: [...] }' }, '403': { description: 'device_not_registered' } },
    }),
    device('Identify a medicine package from a JPEG (X-Device: <id>-cam)', 'post', '/api/scan', {
      requestBody: { content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } },
      responses: { '200': { description: 'Match, or exactly { "found": false }' } },
    }),
    device('Record a pillbox event (idempotent)', 'post', '/api/events', {
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['device', 'type', 'time'], properties: { device: { type: 'string' }, type: { type: 'string' }, slot: { type: 'integer' }, doseId: { type: 'integer' }, time: { type: 'string', example: '2026-10-30T08:04:10' } } } } } },
      responses: { '200': { description: '{ ok: true } or { ok: true, duplicate: true }' } },
    }),
  );
  return {
    openapi: '3.0.3',
    info: { title: 'VOICE API', version: '1.0.0', description: 'App endpoints under /api/v1. The ESP32 paths are frozen by the firmware.' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths,
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>VOICE API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/openapi.json', dom_id: '#ui' });</script></body></html>`;

export function docsRouter(): Router {
  const router = Router();
  let doc: ReturnType<typeof build> | undefined;
  router.get('/openapi.json', (_req, res) => res.json((doc ??= build())));
  router.get('/docs', (_req, res) => {
    // Swagger UI comes from a CDN, so this page (dev only) needs its own CSP.
    res.set('Content-Security-Policy', "default-src 'self' https://unpkg.com; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:");
    res.type('html').send(PAGE);
  });
  return router;
}
