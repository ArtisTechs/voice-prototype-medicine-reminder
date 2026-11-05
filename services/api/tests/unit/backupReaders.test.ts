import { afterEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../src/core/config';
import { VisionError, type VisionClient, type VisionRead } from '../../src/vision/gemini';
import { backupClients, ChainClient } from '../../src/vision/openaiCompat';

const read: VisionRead = { medicineId: null, readName: 'Biogesic', readStrength: '500mg', readExpiry: null, confidence: 0.9, source: 'printed' };
const reply = (status: number, body: unknown) => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
const answer = (text: string) => reply(200, { choices: [{ message: { content: text } }] });
const run = (c: ChainClient) => c.identify(Buffer.from('x'), [], { signal: new AbortController().signal });
const gemini = (fn: () => Promise<VisionRead>): VisionClient => ({ identify: fn });

describe('backup readers (Groq, Cloudflare)', () => {
  const keep = { ...settings() };
  afterEach(() => {
    Object.assign(settings(), keep);
    vi.unstubAllGlobals();
  });
  const keys = () => Object.assign(settings(), { GROQ_API_KEY: 'g', CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'cf' });

  it('only uses the providers whose keys are set', () => {
    Object.assign(settings(), { GROQ_API_KEY: '', CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' });
    expect(backupClients()).toHaveLength(0);
    Object.assign(settings(), { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'cf' });
    expect(backupClients().map((b) => b.name)).toEqual(['cloudflare']);
    keys();
    expect(backupClients().map((b) => b.name)).toEqual(['groq', 'cloudflare']);
  });

  it('goes straight to Gemini when there are no backups', async () => {
    const c = new ChainClient(gemini(async () => read), () => []);
    expect(await run(c)).toEqual(read);
  });

  it('asks Groq when Gemini is out of quota, and reads JSON wrapped in fences', async () => {
    keys();
    const fetchMock = vi.fn(() => answer('```json\n{"medicineId":null,"readName":"Biogesic","readStrength":"500mg","readExpiry":"06/2027","confidence":0.88,"source":"printed"}\n```'));
    vi.stubGlobal('fetch', fetchMock);
    const c = new ChainClient(gemini(async () => { throw new VisionError('daily_limit'); }));
    const r = await run(c);
    expect(r).toMatchObject({ readName: 'Biogesic', readExpiry: '2027-06-30', confidence: 0.88 });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('api.groq.com');
    const sent = JSON.parse(((fetchMock.mock.calls[0] as unknown[])[1] as { body: string }).body);
    expect(sent.model).toBe(settings().GROQ_MODEL);
    expect(sent.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('falls on to Cloudflare when Groq is rate limited too', async () => {
    keys();
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      urls.push(url);
      return url.includes('groq') ? reply(429, 'Rate limit reached on requests per day (RPD)') : answer('{"medicineId":null,"readName":"Biogesic","readStrength":"","readExpiry":null,"confidence":0.9,"source":"printed"}');
    }));
    const c = new ChainClient(gemini(async () => { throw new VisionError('rate_limited'); }));
    expect((await run(c)).readName).toBe('Biogesic');
    expect(urls[1]).toContain('api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions');
  });

  it('reports the last reason when everyone fails, and does not call backups for a missing-key-free hard error shape', async () => {
    keys();
    vi.stubGlobal('fetch', vi.fn(() => reply(500, 'boom')));
    const c = new ChainClient(gemini(async () => { throw new VisionError('rate_limited'); }));
    await expect(run(c)).rejects.toMatchObject({ reason: 'error' });
  });

  it('also tries a backup when Gemini has no key at all', async () => {
    keys();
    vi.stubGlobal('fetch', vi.fn(() => answer('{"medicineId":null,"readName":"X","readStrength":"","readExpiry":null,"confidence":0.9,"source":"printed"}')));
    const c = new ChainClient(gemini(async () => { throw new VisionError('no_key'); }));
    expect((await run(c)).readName).toBe('X');
  });
});
