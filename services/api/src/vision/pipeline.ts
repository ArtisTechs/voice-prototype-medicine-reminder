/**
 * Scan pipeline: one Gemini call, then the checks in code (see medicine-vision skill).
 * Always resolves within the budget and never throws: any failure is "not found" plus a logged reason.
 */
import { settings } from '../core/config';
import { getLogger } from '../core/logger';
import { redis } from '../core/redis';
import { GeminiClient, VisionError, type FailureReason, type ReferencePhoto, type VisionClient } from './gemini';
import { fuzzyMatch, type Candidate } from './match';

const log = getLogger('vision');

let client: VisionClient = new GeminiClient();

/** Tests swap in a fake; production uses Gemini. */
export function setVisionClient(c: VisionClient | null): void {
  client = c ?? new GeminiClient();
}

export interface Match {
  medicineId: number | null;
  /** "llm" = Gemini picked the id, "ocr" = fuzzy match on the name it read, "none". Names are kept for the app. */
  method: 'llm' | 'ocr' | 'none';
  score: number | null;
  readExpiry: string | null;
  reason?: FailureReason | 'busy' | 'local_rate_limit' | 'no_candidates' | 'low_confidence' | 'no_match';
  timings: Record<string, number>;
}

/** Stay under the free tier's per-minute limit instead of collecting 429s. Fails open if Redis is down. */
async function withinQuota(): Promise<boolean> {
  const max = settings().GEMINI_MAX_PER_MINUTE;
  if (max <= 0) return true;
  try {
    const key = `gemini:rpm:${Math.floor(Date.now() / 60_000)}`;
    const n = await redis().incr(key);
    if (n === 1) await redis().expire(key, 70);
    return n <= max;
  } catch {
    return true;
  }
}

export interface IdentifyOptions {
  budgetSeconds?: number;
  references?: () => Promise<ReferencePhoto[]>;
}

export async function identify(image: Buffer, candidates: Candidate[], opts: IdentifyOptions = {}): Promise<Match> {
  const s = settings();
  const started = Date.now();
  const result: Match = { medicineId: null, method: 'none', score: null, readExpiry: null, timings: {} };
  const budgetMs = (opts.budgetSeconds ?? s.SCAN_BUDGET_SECONDS) * 1000;
  const done = () => {
    result.timings.total = Date.now() - started;
    return result;
  };

  if (!candidates.length) return { ...done(), reason: 'no_candidates' };
  if (!(await withinQuota())) {
    log.warn('scan_local_rate_limit');
    return { ...done(), reason: 'local_rate_limit' };
  }

  // Abort the Gemini call at GEMINI_TIMEOUT_MS, and never later than the overall budget.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Math.min(s.GEMINI_TIMEOUT_MS, budgetMs - 300)));
  let hard: NodeJS.Timeout | undefined;
  try {
    const call = (async () => {
      const t0 = Date.now();
      try {
        const references = opts.references ? await opts.references() : undefined;
        return await client.identify(image, candidates, { signal: controller.signal, references });
      } finally {
        result.timings.gemini = Date.now() - t0;
      }
    })();
    call.catch(() => undefined); // a late failure after the backstop won must not be unhandled
    // Backstop in case a client ignores the abort signal.
    const backstop = new Promise<never>((_, reject) => {
      hard = setTimeout(() => reject(new VisionError('timeout')), budgetMs);
    });
    const read = await Promise.race([call, backstop]);

    result.readExpiry = read.readExpiry;
    const ids = new Set(candidates.map((c) => c.id));
    if (read.medicineId !== null) {
      // The id must be one of this box's medicines; the model does not get to name anything else.
      if (ids.has(read.medicineId) && read.confidence >= s.SCAN_MIN_CONFIDENCE) {
        return { ...done(), medicineId: read.medicineId, method: 'llm', score: read.confidence };
      }
      return { ...done(), score: read.confidence, reason: 'low_confidence' };
    }
    const fuzzy = fuzzyMatch(read.readName, read.readStrength, candidates, s.SCAN_FUZZY_THRESHOLD);
    if (fuzzy) return { ...done(), medicineId: fuzzy.id, method: 'ocr', score: fuzzy.score };
    return { ...done(), reason: 'no_match' };
  } catch (err) {
    const reason: FailureReason = err instanceof VisionError ? err.reason : 'error';
    if (reason === 'rate_limited') log.warn('gemini_429');
    else log.warn('scan_failed', { reason });
    return { ...done(), reason };
  } finally {
    clearTimeout(timer);
    if (hard) clearTimeout(hard);
  }
}
