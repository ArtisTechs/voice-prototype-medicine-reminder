import { describe, expect, it } from 'vitest';
import { fit, toAscii } from '../../src/core/text';

describe('fit', () => {
  it.each<[string | null, number, string]>([
    ['Losartan 50mg', 23, 'Losartan 50mg'],
    ['A'.repeat(23), 23, 'A'.repeat(23)],
    ['A'.repeat(24), 23, 'A'.repeat(23)],
    ['Hydrochlorothiazide Extended Release 12.5mg', 23, 'Hydrochlorothiazide'],
    ['After breakfast, with water, do not crush', 39, 'After breakfast, with water, do not'],
    ['Supercalifragilisticexpialidocious pills', 23, 'Supercalifragilisticexp'],
    ['', 10, ''],
    [null, 10, ''],
    ['  many   spaces  ', 20, 'many spaces'],
    ['Señora’s – dose', 20, "Senora's - dose"],
    ['日本語 tablet', 15, 'tablet'],
    ['Take, then:', 6, 'Take'],
  ])('fit(%j, %i) = %j', (value, limit, expected) => {
    const out = fit(value, limit);
    expect(out).toBe(expected);
    expect(out.length).toBeLessThanOrEqual(limit);
    expect(/^[\x20-\x7e]*$/.test(out)).toBe(true);
  });

  it('toAscii strips control characters', () => {
    expect(toAscii('a\x00b\tc')).toBe('abc');
  });
});
