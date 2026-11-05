/**
 * Backup readers for when Gemini is out of free quota: Groq and Cloudflare Workers AI. Both speak the OpenAI chat
 * format, so one client serves both. They use the same prompt and the same checks in code as Gemini (pipeline.ts).
 */
import { settings } from '../core/config';
import { getLogger } from '../core/logger';
import type { Candidate } from './match';
import { parseRead, SYSTEM, VisionError, worthTryingNextModel, type ReferencePhoto, type VisionClient, type VisionRead } from './gemini';

const log = getLogger('vision');

const JSON_RULES = `\nAnswer with ONE JSON object and nothing else, with exactly these keys: medicineId (integer or null), readName (string), readStrength (string), readExpiry (string or null), confidence (number 0 to 1), source ("printed" or "appearance").`;

interface Endpoint {
  name: string;
  url: string;
  key: string;
  model: string;
}

/** Models sometimes wrap the JSON in ```json fences or add a sentence around it. */
function jsonOnly(text: string): string {
  const t = text.trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

export class OpenAICompatClient implements VisionClient {
  constructor(private ep: Endpoint) {}

  get name(): string {
    return this.ep.name;
  }

  async identify(image: Buffer, candidates: Candidate[], opts: { signal: AbortSignal }): Promise<VisionRead> {
    const list = JSON.stringify(candidates.map((c) => ({ id: c.id, name: c.name, strength: c.strength, barcode: c.barcode })));
    let res: Response;
    try {
      res = await fetch(this.ep.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.ep.key}`, 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          model: this.ep.model,
          temperature: 0,
          max_tokens: 400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM + JSON_RULES },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Photo to identify:' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
                { type: 'text', text: `Registered medicines: ${list}` },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      if (opts.signal.aborted || (err as Error).name === 'AbortError') throw new VisionError('timeout');
      throw new VisionError('error', `${this.ep.name} ${(err as Error).message}`.slice(0, 200));
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      if (res.status === 429) throw new VisionError(/per day|\bRPD\b|\bTPD\b|neurons/i.test(body) ? 'daily_limit' : 'rate_limited');
      throw new VisionError('error', `${this.ep.name} ${res.status} ${body}`);
    }
    const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[]; result?: { response?: unknown } } | null;
    const content = data?.choices?.[0]?.message?.content ?? data?.result?.response;
    if (typeof content !== 'string') throw new VisionError('bad_response', `${this.ep.name} no text`);
    return parseRead(jsonOnly(content));
  }
}

/** The backup readers whose keys are set, in the order they are tried. */
export function backupClients(): OpenAICompatClient[] {
  const s = settings();
  const out: OpenAICompatClient[] = [];
  if (s.GROQ_API_KEY) {
    out.push(new OpenAICompatClient({ name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: s.GROQ_API_KEY, model: s.GROQ_MODEL }));
  }
  if (s.CLOUDFLARE_ACCOUNT_ID && s.CLOUDFLARE_API_TOKEN) {
    out.push(
      new OpenAICompatClient({
        name: 'cloudflare',
        url: `https://api.cloudflare.com/client/v4/accounts/${s.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
        key: s.CLOUDFLARE_API_TOKEN,
        model: s.CLOUDFLARE_MODEL,
      }),
    );
  }
  return out;
}

/** Gemini first; if it cannot answer, the backups in turn while the time budget lasts. */
export class ChainClient implements VisionClient {
  constructor(
    private primary: VisionClient,
    private backups: () => OpenAICompatClient[] = backupClients,
  ) {}

  async identify(image: Buffer, candidates: Candidate[], opts: { signal: AbortSignal; references?: ReferencePhoto[] }): Promise<VisionRead> {
    const backups = this.backups();
    if (backups.length === 0) return this.primary.identify(image, candidates, opts);
    // Gemini must leave time for the backups.
    const slot = AbortSignal.any([opts.signal, AbortSignal.timeout(settings().VISION_PRIMARY_MS)]);
    let last: VisionError;
    try {
      return await this.primary.identify(image, candidates, { ...opts, signal: slot });
    } catch (err) {
      last = err instanceof VisionError ? err : new VisionError('error');
      if (opts.signal.aborted || !(last.reason === 'no_key' || worthTryingNextModel(last))) throw last;
    }
    for (const b of backups) {
      try {
        const read = await b.identify(image, candidates, opts);
        log.info('backup_reader_used', { provider: b.name });
        return read;
      } catch (err) {
        last = err instanceof VisionError ? err : new VisionError('error');
        log.warn('backup_reader_failed', { provider: b.name, reason: last.reason, detail: last.reason === 'error' ? last.message : undefined });
        if (opts.signal.aborted) break;
      }
    }
    throw last;
  }
}
