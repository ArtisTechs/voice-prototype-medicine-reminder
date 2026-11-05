import { z } from 'zod';

export const EXAMPLE_SECRET = 'change-me-to-a-long-random-string-at-least-32-bytes';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .default(def ? 'true' : 'false')
    .transform((v) => (v === '' ? def : ['true', '1', 'yes'].includes(v)));

const schema = z.object({
  ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
  PORT: z.coerce.number().int().default(5055),
  LOG_LEVEL: z.string().default('info'),
  ENABLE_DOCS: bool(false),

  DATABASE_URL: z.string().default('mysql://medrem:medrem@db:3306/medrem'),
  REDIS_URL: z.string().default('redis://redis:6379/0'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default(EXAMPLE_SECRET),
  JWT_ACCESS_MINUTES: z.coerce.number().default(15),
  JWT_REFRESH_DAYS: z.coerce.number().default(30),

  CORS_ORIGINS: z.string().default('http://localhost:8081,http://localhost:19006'),

  DEVICE_TZ: z.string().default('Asia/Manila'),
  LATE_AFTER_MINUTES: z.coerce.number().default(15),
  ONLINE_WINDOW_SECONDS: z.coerce.number().default(180),
  OFFLINE_ALERT_MINUTES: z.coerce.number().default(10),
  MISSED_FALLBACK_MINUTES: z.coerce.number().default(35),

  RATE_LIMIT_ENABLED: bool(true),
  // Internet-facing server: the device calls /d/<secret>/api/... and the bare device paths 404.
  DEVICE_PATH_SECRET: z.string().default(''),

  SCAN_DIR: z.string().default('/data/scans'),
  SCAN_RETENTION_DAYS: z.coerce.number().default(30),
  // Largest JPEG the camera may send (the ESP32-CAM sends ~100 KB).
  SCAN_MAX_BYTES: z.coerce.number().default(2 * 1024 * 1024),
  // The camera gives up after 15 s; the contract promises an answer within 10 s.
  SCAN_BUDGET_SECONDS: z.coerce.number().default(9),
  SCAN_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  SCAN_FUZZY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  SCAN_USE_REFERENCES: bool(false),
  // Let the AI suggest a product from how the package looks when it cannot read the name. Off = printed text only.
  SCAN_GUESS_FROM_LOOKS: bool(true),
  // A match made from looks alone (no readable name) needs at least this much confidence.
  SCAN_MIN_CONFIDENCE_LOOKS: z.coerce.number().min(0).max(1).default(0.9),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  // Tried in this order when the main model is overloaded (503), rate limited (429) or retired (404). Comma separated.
  GEMINI_FALLBACK_MODELS: z.string().default('gemini-3-flash-preview,gemini-3.6-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().default(8000),
  // How long one model may take before the next one is tried (the last model gets what is left of GEMINI_TIMEOUT_MS).
  GEMINI_ATTEMPT_MS: z.coerce.number().default(4500),
  // Free tier is rate limited per minute; stay under it instead of collecting 429s.
  GEMINI_MAX_PER_MINUTE: z.coerce.number().default(10),

  // Other AI providers tried after Gemini when it is out of quota or down (each is used only when its key is set).
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('qwen/qwen3.8-27b'),
  CLOUDFLARE_ACCOUNT_ID: z.string().default(''),
  CLOUDFLARE_API_TOKEN: z.string().default(''),
  CLOUDFLARE_MODEL: z.string().default('@cf/meta/llama-4-scout-17b-16e-instruct'),
  // When another provider is configured, all of Gemini's models together get this long before it is tried (ms).
  VISION_PRIMARY_MS: z.coerce.number().default(5500),

  EXPO_PUSH_ENABLED: bool(true),
  EXPO_ACCESS_TOKEN: z.string().default(''),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),

  SEED_DEMO: bool(false),
  // Run the cron jobs and the push consumer inside the API process (one Render service instead of two).
  EMBED_WORKER: bool(false),

  RETENTION_EVENTS_DAYS: z.coerce.number().default(180),
  RETENTION_ALERTS_DAYS: z.coerce.number().default(90),
});

export type Settings = z.infer<typeof schema> & {
  corsOrigins: string[];
};

function load(): Settings {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const s = parsed.data;
  return { ...s, corsOrigins: s.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) };
}

let cached: Settings | null = null;

/** Settings are read once. Tests may mutate the returned object (it is shared). */
export function settings(): Settings {
  if (!cached) cached = load();
  return cached;
}

export function checkProd(): void {
  const s = settings();
  if (s.ENV === 'prod' && s.JWT_SECRET === EXAMPLE_SECRET) {
    throw new Error('Refusing to start in prod with the example JWT_SECRET');
  }
  if (s.ENV === 'prod' && (!s.REDIS_URL.trim() || s.REDIS_URL === 'redis://redis:6379/0') && !process.env.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is not set: paste the Redis (Key Value) internal URL into the environment');
  }
}
