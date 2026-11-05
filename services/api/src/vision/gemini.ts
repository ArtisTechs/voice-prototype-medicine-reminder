/**
 * Gemini vision call (free tier). Sends the package photo + the list of THIS box's registered
 * medicines (id, name, strength, barcode: no patient data) and asks for JSON only.
 *
 * The model only reads and suggests. Whether the match is accepted, and every field sent back to the
 * ESP32, is decided in code from the database (see pipeline.ts, scanService.ts).
 */
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { settings } from '../core/config';
import { getLogger } from '../core/logger';
import type { Candidate } from './match';

export interface VisionRead {
  medicineId: number | null;
  readName: string;
  readStrength: string;
  readExpiry: string | null;
  confidence: number;
  /** printed = the name was read on the package; appearance = a guess from how the package looks (logo, colours, layout). */
  source?: 'printed' | 'appearance';
}

export interface ReferencePhoto {
  medicineId: number;
  image: Buffer;
}

export interface VisionClient {
  identify(image: Buffer, candidates: Candidate[], opts: { signal: AbortSignal; references?: ReferencePhoto[] }): Promise<VisionRead>;
}

const log = getLogger('gemini');

export type FailureReason = 'no_key' | 'timeout' | 'rate_limited' | 'daily_limit' | 'bad_response' | 'error';

export class VisionError extends Error {
  constructor(public reason: FailureReason, message?: string) {
    super(message ?? reason);
  }
}

export const SYSTEM = `You read the outside of a medicine package photographed by a pillbox camera.
You are given the only medicines that can be on this pillbox (JSON list with id, name, strength, barcode).
Rules:
- Answer medicineId only if the printed name (and strength, if printed) clearly matches ONE listed medicine.
- ALWAYS try to read the printed text first. If the name is readable, source is "printed".
- If the name is NOT readable (blurry, covered, back of the box) you may still recognise a specific, well-known product by its packaging (logo, brand colours, layout, shape). Then set source to "appearance" and put your best name in readName. Be honest: a generic or unfamiliar box gets readName "" and confidence 0.
- If you are not sure, or the package is not in the list, answer medicineId null. A similar-looking box is not a match. Never invent a name.
- readName / readStrength: copy what is printed on the package, even if it is not in the list. Use "" if you can neither read nor recognise it.
- readExpiry: the expiry date as YYYY-MM-DD, or null. If only month and year are printed, use the last day of that month.
- confidence: 0 to 1, how sure you are about medicineId, or about readName when medicineId is null (0 when you have nothing). Printed text you can clearly read: high. A guess from appearance: never above 0.9.
- source: "printed" or "appearance".`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    medicineId: { type: Type.INTEGER, nullable: true },
    readName: { type: Type.STRING },
    readStrength: { type: Type.STRING },
    readExpiry: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
    source: { type: Type.STRING, enum: ['printed', 'appearance'] },
  },
  required: ['medicineId', 'readName', 'readStrength', 'readExpiry', 'confidence', 'source'],
};

/** Packages print expiry as 06/2027, 2027-06, 30/06/2027 ...: turn what we can into YYYY-MM-DD (month only = last day of the month). */
export function normaliseExpiry(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const ymd = (y: number, m: number, d: number | null) => {
    if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = d ?? last;
    if (day < 1 || day > last) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
  if (m) return ymd(+m[1], +m[2], null);
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return ymd(+m[2], +m[1], null);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t); // day first (Philippines)
  if (m) return ymd(+m[3], +m[2], +m[1]);
  return null;
}

export function parseRead(text: string): VisionRead {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new VisionError('bad_response', 'not JSON');
  }
  const id = raw.medicineId;
  const conf = Number(raw.confidence);
  const expiry = normaliseExpiry(raw.readExpiry);
  return {
    medicineId: typeof id === 'number' && Number.isInteger(id) ? id : null,
    readName: typeof raw.readName === 'string' ? raw.readName.slice(0, 120) : '',
    readStrength: typeof raw.readStrength === 'string' ? raw.readStrength.slice(0, 40) : '',
    readExpiry: expiry,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    source: raw.source === 'appearance' ? 'appearance' : 'printed',
  };
}

function classify(err: unknown, signal: AbortSignal): VisionError {
  if (err instanceof VisionError) return err;
  if (signal.aborted) return new VisionError('timeout');
  const e = err as { status?: number; name?: string; message?: string };
  if (e.status === 429 || /RESOURCE_EXHAUSTED|quota|rate/i.test(e.message ?? '')) {
    // The free tier also has a per-day cap (20 requests per model): say so, because waiting a minute will not help.
    return new VisionError(/per day|perday/i.test(e.message ?? '') ? 'daily_limit' : 'rate_limited');
  }
  if (e.name === 'AbortError') return new VisionError('timeout');
  return new VisionError('error', `${e.name ?? 'Error'} ${e.status ?? ''} ${String(e.message ?? '').replace(/AIza[\w-]+/g, '<key>').slice(0, 300)}`.trim());
}

export class GeminiClient implements VisionClient {
  private ai: GoogleGenAI | null = null;

  async identify(image: Buffer, candidates: Candidate[], opts: { signal: AbortSignal; references?: ReferencePhoto[] }): Promise<VisionRead> {
    const s = settings();
    if (!s.GEMINI_API_KEY) throw new VisionError('no_key');
    this.ai ??= new GoogleGenAI({ apiKey: s.GEMINI_API_KEY });

    const list = JSON.stringify(candidates.map((c) => ({ id: c.id, name: c.name, strength: c.strength, barcode: c.barcode })));
    const parts: Record<string, unknown>[] = [];
    for (const ref of opts.references ?? []) {
      parts.push({ text: `Reference photo of the package of medicine id ${ref.medicineId}:` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: ref.image.toString('base64') } });
    }
    parts.push({ text: 'Photo to identify:' });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } });
    parts.push({ text: `Registered medicines: ${list}` });

    // The main model first; if Google says it is overloaded (503), limited (429), gone (404) or answers badly,
    // the next model gets a go while the time budget (the abort signal) lasts. Each model has its own free quota.
    const models = [s.GEMINI_MODEL, ...s.GEMINI_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean)];
    let last: VisionError = new VisionError('error');
    for (const [i, model] of models.entries()) {
      // A slow model must not eat the whole budget: every model but the last gets a shorter slot of its own.
      const slot = i < models.length - 1 ? AbortSignal.any([opts.signal, AbortSignal.timeout(s.GEMINI_ATTEMPT_MS)]) : opts.signal;
      try {
        return await this.callModel(model, parts, slot);
      } catch (err) {
        last = classify(err, slot);
        log.warn('gemini_model_failed', { model, reason: last.reason, detail: last.reason === 'error' ? last.message : undefined });
        if (opts.signal.aborted || !worthTryingNextModel(last)) break;
      }
    }
    throw last;
  }

  private async callModel(model: string, parts: Record<string, unknown>[], signal: AbortSignal): Promise<VisionRead> {
    const res = await this.ai!.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        // Room for the JSON even if the model starts to think (a 300 token cap came back empty on Gemini 3).
        maxOutputTokens: 800,
        // Reading a label does not need thinking and it costs seconds: 2.5 takes a budget, 3.x a level.
        ...(/2\.5/i.test(model)
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : /gemini-3/i.test(model)
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
            : {}),
        abortSignal: signal,
      },
    });
    return parseRead(res.text ?? '');
  }
}

/** Temporary or model-specific trouble: try another model. A timeout, a missing key or an unknown answer shape is not. */
export function worthTryingNextModel(err: VisionError): boolean {
  if (err.reason === 'rate_limited' || err.reason === 'daily_limit' || err.reason === 'bad_response' || err.reason === 'timeout') return true;
  if (err.reason !== 'error') return false;
  return /\b(500|502|503|504|404|400)\b|UNAVAILABLE|INTERNAL|NOT_FOUND/i.test(err.message);
}
