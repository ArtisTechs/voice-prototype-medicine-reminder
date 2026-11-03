/** Name matching in code, never in the model: the fallback when Gemini reads a name but picks no id. */
import { distance } from 'fastest-levenshtein';

export interface Candidate {
  id: number;
  name: string;
  strength: string | null;
  barcode: string | null;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** "50 mg" / "50MG" / "50 Mg." -> "50mg" */
const normStrength = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9.%/]+/g, '');

export function similarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

export interface FuzzyMatch {
  id: number;
  score: number;
}

/** Margin the best candidate must lead the runner-up by, so two similar names never guess. */
export const FUZZY_MARGIN = 0.1;

/**
 * Fuzzy-match what the model read (name + strength) against the registered medicines.
 * A candidate whose strength is known and differs from the strength read is never a match.
 */
export function fuzzyMatch(readName: string, readStrength: string, candidates: Candidate[], threshold: number): FuzzyMatch | null {
  const strengthRead = normStrength(readStrength);
  const scored = candidates
    .map((c) => {
      const label = c.strength ? `${c.name} ${c.strength}` : c.name;
      const score = Math.max(similarity(readName, c.name), similarity(readName, label));
      const cs = normStrength(c.strength);
      const conflict = !!strengthRead && !!cs && strengthRead !== cs;
      return { id: c.id, score: conflict ? 0 : score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < threshold) return null;
  const runnerUp = scored.find((s) => s.id !== best.id);
  if (runnerUp && best.score - runnerUp.score < FUZZY_MARGIN) return null;
  return { id: best.id, score: Math.round(best.score * 1000) / 1000 };
}
