/** Shorten text for the ESP32 firmware buffers. Output is ASCII, so bytes == chars. */

const MAP: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', µ: 'u' };
const TRAILING = ' ,.;:-/(&+';

export function toAscii(value: string): string {
  let v = [...value].map((ch) => MAP[ch] ?? ch).join('');
  v = v.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  return v.replace(/\s+/g, ' ').trim();
}

function rstrip(s: string): string {
  let end = s.length;
  while (end > 0 && TRAILING.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

/** ASCII, at most `limit` chars, cut at a word boundary when that keeps >= 60% of the limit. */
export function fit(value: string | null | undefined, limit: number): string {
  const text = toAscii(value ?? '');
  if (text.length <= limit) return text;
  let cut = text.slice(0, limit + 1);
  const space = cut.lastIndexOf(' ');
  cut = space >= Math.floor(limit * 0.6) ? cut.slice(0, space) : text.slice(0, limit);
  return rstrip(cut).slice(0, limit);
}
