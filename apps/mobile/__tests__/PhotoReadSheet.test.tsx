import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoReadSheet } from '../src/features/medicines/PhotoReadSheet';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));

describe('read a box photo from the phone', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  const open = (over: Partial<{ onRead: jest.Mock; onRetake: jest.Mock }> = {}) =>
    render(
      <ThemeProvider>
        <PhotoReadSheet uri="file:///box.jpg" patientId={5} onClose={jest.fn()} onRetake={over.onRetake ?? jest.fn()} onRead={over.onRead ?? jest.fn()} />
      </ThemeProvider>,
    );

  it('hands back the name read on the box, and says when it is only a guess', async () => {
    fetchMock.mockImplementation(() => reply({ read: true, name: 'Biogesic', strength: '500mg', expiry: '2027-05-31', guessed: true, reason: null }));
    const onRead = jest.fn();
    await open({ onRead });
    await act(async () => {});
    expect(onRead).toHaveBeenCalledWith({ name: 'Biogesic', strength: '500mg', expiry: '2027-05-31', guessed: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/patients/5/medicines/read-package');
  });

  it('explains when nothing could be read and offers another photo', async () => {
    fetchMock.mockImplementation(() => reply({ read: false, name: null, strength: null, expiry: null, guessed: false, reason: 'no_match' }));
    const onRetake = jest.fn();
    await open({ onRetake });
    await act(async () => {});
    expect(screen.getByText("Couldn't read it")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Take another photo'));
    expect(onRetake).toHaveBeenCalled();
  });

  it('tells the person when the reader is busy', async () => {
    fetchMock.mockImplementation(() => reply({ read: false, name: null, strength: null, expiry: null, guessed: false, reason: 'rate_limited' }));
    await open();
    await act(async () => {});
    expect(screen.getByText('The reader is busy right now. Wait a minute and try again.')).toBeTruthy();
  });
});

describe('read a box photo: flaky connection', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => jest.useRealTimers());

  it('tries once more by itself when the first attempt cannot reach the server', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError('Network request failed')))
      .mockImplementationOnce(() => reply({ read: true, name: 'Biogesic', strength: null, expiry: null, guessed: false, reason: null }));
    const onRead = jest.fn();
    await render(
      <ThemeProvider>
        <PhotoReadSheet uri="file:///box.jpg" patientId={5} onClose={jest.fn()} onRetake={jest.fn()} onRead={onRead} />
      </ThemeProvider>,
    );
    await act(async () => { await jest.advanceTimersByTimeAsync(4500); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRead).toHaveBeenCalledWith({ name: 'Biogesic', strength: null, expiry: null, guessed: false });
  });
});
