import { fireEvent, render, screen } from '@testing-library/react-native';

import type { NearbyDevice } from '../src/api/types';
import { describe as describeVoice, VoicePicker } from '../src/features/patients/VoicePicker';

const voice = (over: Partial<NearbyDevice>): NearbyDevice => ({
  deviceId: 'pillbox',
  paired: false,
  status: 'online',
  lastSeen: null,
  people: 0,
  mine: false,
  ...over,
});

describe('VoicePicker', () => {
  it('says it is looking when nothing is found yet', async () => {
    await render(<VoicePicker devices={[]} actionLabel="Connect" onPick={jest.fn()} />);
    expect(screen.getByText('Looking for VOICE…')).toBeTruthy();
  });

  it('lists found VOICEs and connects the one tapped', async () => {
    const onPick = jest.fn();
    await render(
      <VoicePicker
        devices={[voice({}), voice({ deviceId: 'kitchen', paired: true, people: 2 })]}
        actionLabel="Connect"
        onPick={onPick}
      />,
    );
    expect(screen.getByText('New VOICE, ready to connect')).toBeTruthy();
    expect(screen.getByText('2 people on it')).toBeTruthy();
    fireEvent.press(screen.getAllByLabelText('Connect')[1]);
    expect(onPick).toHaveBeenCalledWith('kitchen');
  });

  it('leaves out the VOICE the person is already on and marks the selected one', async () => {
    await render(
      <VoicePicker
        devices={[voice({}), voice({ deviceId: 'kitchen' })]}
        currentId="pillbox"
        selectedId="kitchen"
        actionLabel="Use this VOICE"
        onPick={jest.fn()}
      />,
    );
    expect(screen.queryByText('pillbox')).toBeNull();
    expect(screen.getByText('Selected')).toBeTruthy();
  });

  it('describes a shared VOICE in plain words', () => {
    expect(describeVoice(voice({ paired: true, people: 1, mine: true }))).toBe(
      '1 person on it, including someone you look after',
    );
  });
});
