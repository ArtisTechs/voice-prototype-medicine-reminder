/**
 * Gemini vision call (free tier). Sends the package photo + the list of THIS box's registered
 * medicines (id, name, strength, barcode: no patient data) and asks for JSON only.
 *
 * The model only reads and suggests. Whether the match is accepted, and every field sent back to the
 * ESP32, is decided in code from the database (see pipeline.ts, scanService.ts).
 */
import { GoogleGenAI, Type } from '@google/genai';
import { settings } from '../core/config';
import type { Candidate } from './match';

export interface VisionRead {
  medicineId: number | null;
  readName: string;
  readStrength: string;
  readExpiry: string | null;
  confidence: number;
}

export interface ReferencePhoto {
  medicineId: number;
  image: Buffer;
}

export interface VisionClient {
  identify(image: Buffer, candidates: Candidate[], opts: { signal: AbortSignal; references?: ReferencePhoto[] }): Promise<VisionRead>;
}

export type FailureReason = 'no_key' | 'timeout' | 'rate_limited' | 'bad_response' | 'error';

export class VisionError extends Error {
  constructor(public reason: FailureReason, message?: string) {
    super(message ?? reason);
  }
}

const SYSTEM = `You read the outside of a medicine package photographed by a pillbox camera.
You are given the only medicines that can be on this pillbox (JSON list with id, name, strength, barcode).
Rules:
- Answer medicineId only if the printed name (and strength, if printed) clearly matches ONE listed medicine.
- If you are not sure, or the package is not in the list, answer medicineId null. Never guess. A similar-looking box is not a match.
- readName / readStrength: copy what is printed on the package, even if it is not in the list. Use "" if unreadable.
- readExpiry: the expiry date as YYYY-MM-DD, or null. If only month and year are printed, use the last day of that month.
- confidence: 0 to 1, how sure you are about medicineId (0 when medicineId is null).`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    medicineId: { type: Type.INTEGER, nullable: true },
    readName: { type: Type.STRING },
    readStrength: { type: Type.STRING },
    readExpiry: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER },
  },
  required: ['medicineId', 'readName', 'readStrength', 'readExpiry', 'confidence'],
};

export function parseRead(text: string): VisionRead {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new VisionError('bad_response', 'not JSON');
  }
  const id = raw.medicineId;
  const conf = Number(raw.confidence);
  const expiry = typeof raw.readExpiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.readExpiry) ? raw.readExpiry : null;
  return {
    medicineId: typeof id === 'number' && Number.isInteger(id) ? id : null,
    readName: typeof raw.readName === 'string' ? raw.readName.slice(0, 120) : '',
    readStrength: typeof raw.readStrength === 'string' ? raw.readStrength.slice(0, 40) : '',
    readExpiry: expiry,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
  };
}

function classify(err: unknown, signal: AbortSignal): VisionError {
  if (err instanceof VisionError) return err;
  if (signal.aborted) return new VisionError('timeout');
  const e = err as { status?: number; name?: string; message?: string };
  if (e.status === 429 || /RESOURCE_EXHAUSTED|quota|rate/i.test(e.message ?? '')) return new VisionError('rate_limited');
  if (e.name === 'AbortError') return new VisionError('timeout');
  return new VisionError('error', e.name);
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

    try {
      const res = await this.ai.models.generateContent({
        model: s.GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          maxOutputTokens: 300,
          // 2.5 Flash "thinks" by default; reading a label does not need it and it costs seconds.
          ...(/2\.5.*flash/i.test(s.GEMINI_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          abortSignal: opts.signal,
        },
      });
      return parseRead(res.text ?? '');
    } catch (err) {
      throw classify(err, opts.signal);
    }
  }
}
