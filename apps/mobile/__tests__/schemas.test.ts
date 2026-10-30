import { signInSchema, signUpSchema } from '../src/features/auth/schema';
import { emptyMedicine, medicineSchema, toInput } from '../src/features/medicines/schema';

describe('auth schemas', () => {
  it('requires a valid email and password', () => {
    const r = signInSchema.safeParse({ email: 'nope', password: '' });
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message);
    expect(msgs).toContain('That email address does not look right.');
    expect(msgs).toContain('Enter your password.');
  });

  it('checks the password confirmation', () => {
    const r = signUpSchema.safeParse({ name: 'Ana', email: 'ana@example.com', password: 'secret123', confirm: 'secret124' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(['confirm']);
  });
});

describe('medicine schema', () => {
  const valid = { ...emptyMedicine, name: 'Losartan', strength: '50mg', slot: 1, expiryDate: '2027-06-30' };

  it('accepts a complete medicine', () => {
    expect(medicineSchema.safeParse(valid).success).toBe(true);
  });

  it('gives plain messages for bad numbers', () => {
    const r = medicineSchema.safeParse({ ...valid, doseAmount: 0, qty: undefined });
    expect(r.success).toBe(false);
    const byField = Object.fromEntries(r.error!.issues.map((i) => [i.path[0], i.message]));
    expect(byField.doseAmount).toBe('The dose must be at least 1.');
    expect(byField.qty).toBe('Enter the number of pills as a number.');
  });

  it('rejects odd barcodes', () => {
    expect(medicineSchema.safeParse({ ...valid, barcode: '<script>' }).success).toBe(false);
  });

  it('maps empty text to null and the form to a unit', () => {
    const body = toInput({ ...valid, instructions: '  ', barcode: '', form: 'capsule' });
    expect(body.instructions).toBeNull();
    expect(body.barcode).toBeNull();
    expect(body.doseUnit).toBe('capsule');
  });
});
