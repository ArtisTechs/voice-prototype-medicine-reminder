import { afterEach, describe, expect, it } from 'vitest';
import { settings } from '../../src/core/config';
import { GeminiClient, VisionError, type VisionRead } from '../../src/vision/gemini';

const read: VisionRead = { medicineId: null, readName: 'Losartan', readStrength: '50mg', readExpiry: null, confidence: 0.9, source: 'printed' };
const overloaded = Object.assign(new Error('{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}'), { status: 503 });

function client(behaviour: (model: string) => Promise<VisionRead>) {
  const c = new GeminiClient() as unknown as { callModel: (m: string) => Promise<VisionRead>; identify: GeminiClient['identify'] };
  const tried: string[] = [];
  c.callModel = async (m) => {
    tried.push(m);
    return behaviour(m);
  };
  return { c: c as unknown as GeminiClient, tried };
}

const run = (c: GeminiClient) => c.identify(Buffer.from('x'), [], { signal: new AbortController().signal });

describe('Gemini model fallback', () => {
  const saved = { key: settings().GEMINI_API_KEY, model: settings().GEMINI_MODEL, fb: settings().GEMINI_FALLBACK_MODELS };
  afterEach(() => Object.assign(settings(), { GEMINI_API_KEY: saved.key, GEMINI_MODEL: saved.model, GEMINI_FALLBACK_MODELS: saved.fb }));
  const configure = () => Object.assign(settings(), { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'main', GEMINI_FALLBACK_MODELS: 'backup1, backup2' });

  it('uses the next model when the first is overloaded (503)', async () => {
    configure();
    const { c, tried } = client(async (m) => {
      if (m === 'main') throw overloaded;
      return read;
    });
    expect(await run(c)).toEqual(read);
    expect(tried).toEqual(['main', 'backup1']);
  });

  it('moves on from a rate limited model and from a retired one (404)', async () => {
    configure();
    const { c, tried } = client(async (m) => {
      if (m === 'main') throw new VisionError('rate_limited');
      if (m === 'backup1') throw Object.assign(new Error('{"error":{"code":404,"status":"NOT_FOUND"}}'), { status: 404 });
      return read;
    });
    expect(await run(c)).toEqual(read);
    expect(tried).toEqual(['main', 'backup1', 'backup2']);
  });

  it('gives up with the last reason when every model fails', async () => {
    configure();
    const { c, tried } = client(async () => {
      throw overloaded;
    });
    await expect(run(c)).rejects.toMatchObject({ reason: 'error' });
    expect(tried).toEqual(['main', 'backup1', 'backup2']);
  });

  it('does not keep trying after the time budget is spent', async () => {
    configure();
    const controller = new AbortController();
    const { c, tried } = client(async () => {
      controller.abort();
      throw overloaded;
    });
    await expect(c.identify(Buffer.from('x'), [], { signal: controller.signal })).rejects.toMatchObject({ reason: 'timeout' });
    expect(tried).toEqual(['main']);
  });

  it('has no fallback to try without a key', async () => {
    Object.assign(settings(), { GEMINI_API_KEY: '' });
    await expect(new GeminiClient().identify(Buffer.from('x'), [], { signal: new AbortController().signal })).rejects.toMatchObject({ reason: 'no_key' });
  });
});

describe('Gemini model fallback: a slow model', () => {
  it('hands over to the next model when one takes longer than its slot', async () => {
    const saved = { ...settings() };
    Object.assign(settings(), { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'slow', GEMINI_FALLBACK_MODELS: 'quick', GEMINI_ATTEMPT_MS: 40 });
    try {
      const c = new GeminiClient() as unknown as { callModel: (m: string, p: unknown, s: AbortSignal) => Promise<VisionRead> };
      const tried: string[] = [];
      c.callModel = (m, _p, signal) => {
        tried.push(m);
        if (m === 'quick') return Promise.resolve(read);
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      };
      expect(await (c as unknown as GeminiClient).identify(Buffer.from('x'), [], { signal: new AbortController().signal })).toEqual(read);
      expect(tried).toEqual(['slow', 'quick']);
    } finally {
      Object.assign(settings(), saved);
    }
  });
});

describe('Gemini daily limit', () => {
  it('tells a per-day quota apart from a per-minute one, and still tries the next model', async () => {
    const day = Object.assign(new Error('Quota exceeded ... Generate content requests per day limit exceeded on Free Tier'), { status: 429 });
    const minute = Object.assign(new Error('Quota exceeded ... requests per minute'), { status: 429 });
    const saved = { ...settings() };
    Object.assign(settings(), { GEMINI_API_KEY: 'k', GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODELS: 'b' });
    try {
      for (const [err, reason] of [[day, 'daily_limit'], [minute, 'rate_limited']] as const) {
        const c = new GeminiClient() as unknown as { callModel: () => Promise<VisionRead> };
        let calls = 0;
        c.callModel = async () => {
          calls++;
          throw err;
        };
        await expect((c as unknown as GeminiClient).identify(Buffer.from('x'), [], { signal: new AbortController().signal })).rejects.toMatchObject({ reason });
        expect(calls).toBe(2);
      }
    } finally {
      Object.assign(settings(), saved);
    }
  });
});
