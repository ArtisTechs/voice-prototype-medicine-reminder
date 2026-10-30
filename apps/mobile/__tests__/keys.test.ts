import { qk } from '../src/api/keys';

describe('query keys', () => {
  it('nests every patient key under the patient prefix', () => {
    const prefix = qk.patient(3);
    for (const key of [qk.today(3), qk.medicines(3), qk.medicine(3, 9), qk.device(3), qk.scans(3), qk.history(3, 'a', 'b')]) {
      expect(key.slice(0, 2)).toEqual([...prefix]);
    }
  });
});
