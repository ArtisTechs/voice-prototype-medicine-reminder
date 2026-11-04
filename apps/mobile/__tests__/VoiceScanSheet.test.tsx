import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { VoiceScanSheet } from '../src/features/medicines/VoiceScanSheet';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const scan = (id: number, over: Record<string, unknown> = {}) => ({
  id, found: false, readName: null, readStrength: null, ocrExpiry: null, ...over,
});

describe('Scan with VOICE', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => jest.useRealTimers());

  const open = (onRead = jest.fn()) =>
    render(
      <ThemeProvider>
        <VoiceScanSheet visible patientId={5} onClose={jest.fn()} onRead={onRead} />
      </ThemeProvider>,
    );

  it('waits for a new scan, then hands back what was read on the box', async () => {
    let polls = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/scans/learn')) return json(204, null);
      polls++;
      // 1st call = what already exists (baseline); 2nd = still nothing new; 3rd = the new scan.
      if (polls < 3) return json(200, { items: [scan(10)], total: 1, limit: 1, offset: 0 });
      return json(200, { items: [scan(11, { readName: 'Biogesic', readStrength: '500mg', ocrExpiry: '2027-05-31' })], total: 2, limit: 1, offset: 0 });
    });
    const onRead = jest.fn();
    await open(onRead);
    expect(screen.getByText('Waiting for your VOICE…')).toBeTruthy();
    for (let i = 0; i < 3; i++) await act(async () => { await jest.advanceTimersByTimeAsync(2100); });
    expect(onRead).toHaveBeenCalledWith({ name: 'Biogesic', strength: '500mg', expiry: '2027-05-31' });
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/scans/5/learn') || (String(u).includes('/patients/5/scans/learn') && i?.method === 'POST'))).toBe(true);
  });

  it('says so when the VOICE could not read the box and lets you try again', async () => {
    let n = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/scans/learn')) return json(204, null);
      n++;
      return json(200, { items: [n === 1 ? scan(10) : scan(11)], total: 1, limit: 1, offset: 0 });
    });
    await open();
    for (let i = 0; i < 2; i++) await act(async () => { await jest.advanceTimersByTimeAsync(2100); });
    expect(screen.getByText("VOICE couldn't read that box")).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Try again'));
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });
    expect(screen.getByText('Waiting for your VOICE…')).toBeTruthy();
  });
});
