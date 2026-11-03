import { describe, expect, it } from 'vitest';
import { parseRead } from '../../src/vision/gemini';
import { fuzzyMatch, similarity, type Candidate } from '../../src/vision/match';

const C: Candidate[] = [
  { id: 1, name: 'Losartan', strength: '50mg', barcode: null },
  { id: 2, name: 'Metformin', strength: '500mg', barcode: null },
  { id: 3, name: 'Amlodipine', strength: '5mg', barcode: null },
];

describe('fuzzyMatch', () => {
  it('matches the printed name and strength', () => {
    expect(fuzzyMatch('LOSARTAN', '50 mg', C, 0.8)?.id).toBe(1);
    expect(fuzzyMatch('Metformn', '500mg', C, 0.8)?.id).toBe(2); // a misread letter
    expect(fuzzyMatch('Metformin 500mg', '', C, 0.8)?.id).toBe(2); // strength inside the name
  });

  it('does not match an unknown medicine', () => {
    expect(fuzzyMatch('CETIRIZINE', '10mg', C, 0.8)).toBeNull();
    expect(fuzzyMatch('', '', C, 0.8)).toBeNull();
  });

  it('never matches when the strength is different', () => {
    expect(fuzzyMatch('Losartan', '100mg', C, 0.8)).toBeNull();
  });

  it('refuses to guess between two similar names', () => {
    const twins: Candidate[] = [
      { id: 1, name: 'Losartan', strength: null, barcode: null },
      { id: 2, name: 'Losartam', strength: null, barcode: null },
    ];
    expect(fuzzyMatch('Losartan', '', twins, 0.8)?.id).toBe(1);
    expect(fuzzyMatch('Losarta', '', twins, 0.8)).toBeNull();
  });

  it('similarity ignores case and punctuation', () => {
    expect(similarity('Co-Amoxiclav', 'co amoxiclav')).toBe(1);
  });
});

describe('parseRead', () => {
  it('accepts the schema', () => {
    expect(parseRead('{"medicineId":3,"readName":"X","readStrength":"5mg","readExpiry":"2027-06-30","confidence":0.8}')).toEqual({
      medicineId: 3, readName: 'X', readStrength: '5mg', readExpiry: '2027-06-30', confidence: 0.8,
    });
  });

  it('cleans up odd values instead of trusting them', () => {
    expect(parseRead('{"medicineId":"3","readName":5,"readExpiry":"June 2027","confidence":7}')).toEqual({
      medicineId: null, readName: '', readStrength: '', readExpiry: null, confidence: 1,
    });
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseRead('Sure! It is Losartan')).toThrow();
  });
});
