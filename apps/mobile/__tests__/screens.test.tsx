import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { TodayDose } from '../src/api/types';
import SignIn from '../src/app/sign-in';
import { AuthProvider } from '../src/auth/AuthProvider';
import { DoseRow, statusLabel } from '../src/features/today/DoseRow';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  router: { push: jest.fn(), replace: jest.fn() },
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

const dose = (over: Partial<TodayDose>): TodayDose => ({
  scheduleId: 1,
  medicineId: 1,
  medicineName: 'Losartan 50mg',
  slot: 1,
  time: '08:00',
  dose: '1 tablet',
  instructions: 'After breakfast',
  status: 'upcoming',
  takenAt: null,
  delayMinutes: null,
  ...over,
});

describe('Today timeline row', () => {
  it.each([
    ['upcoming', 'Upcoming'],
    ['due', 'Due now'],
    ['missed', 'Missed'],
    ['expired', 'Expired medicine'],
  ] as const)('shows %s as a word', async (status, word) => {
    await render(<DoseRow dose={dose({ status })} />);
    expect(screen.getByText(word)).toBeTruthy();
    expect(screen.getByText('8:00 AM')).toBeTruthy();
  });

  it('says how late a late dose was', () => {
    expect(statusLabel(dose({ status: 'late', delayMinutes: 25 }))).toBe('Taken late (25 min)');
    expect(statusLabel(dose({ status: 'taken', takenAt: '2026-10-30T00:04:00Z' }), 'Asia/Manila')).toBe('Taken 8:04 AM');
  });

  it('reads as one sentence for screen readers', async () => {
    await render(<DoseRow dose={dose({ status: 'missed' })} />);
    expect(screen.getByLabelText('8:00 AM. Losartan 50mg, 1 tablet, slot 1. Missed.')).toBeTruthy();
  });
});

describe('Sign in form', () => {
  it('shows plain validation messages and does not call the API', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await render(wrap(<SignIn />));
    await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
