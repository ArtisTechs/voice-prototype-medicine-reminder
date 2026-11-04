import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { DialogProvider, useDialog } from '../src/components/Dialog';
import { ThemeProvider } from '../src/theme/ThemeProvider';

function Harness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const dialog = useDialog();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => dialog.confirm({ title: 'Delete Losartan?', message: 'History is kept.', confirmLabel: 'Delete', cancelLabel: 'Keep it', tone: 'danger', onConfirm })}
      >
        <Text>open</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => dialog.notify({ title: 'Heads up', message: 'Not connected.' })}>
        <Text>notify</Text>
      </Pressable>
    </>
  );
}

async function setup(onConfirm: () => Promise<void>) {
  await render(
    <ThemeProvider>
      <DialogProvider>
        <Harness onConfirm={onConfirm} />
      </DialogProvider>
    </ThemeProvider>,
  );
}

describe('custom dialog', () => {
  it('asks, runs the action on confirm and closes', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    await setup(onConfirm);
    await fireEvent.press(screen.getByText('open'));
    expect(screen.getByText('Delete Losartan?')).toBeTruthy();
    expect(screen.getByText('History is kept.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Delete'));
    await act(async () => {});
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Delete Losartan?')).toBeNull();
  });

  it('closes without running the action when cancelled', async () => {
    const onConfirm = jest.fn();
    await setup(onConfirm);
    await fireEvent.press(screen.getByText('open'));
    await fireEvent.press(screen.getByLabelText('Keep it'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete Losartan?')).toBeNull();
  });

  it('stays open and shows the problem when the action fails, then can retry', async () => {
    const onConfirm = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    await setup(onConfirm);
    await fireEvent.press(screen.getByText('open'));
    await fireEvent.press(screen.getByLabelText('Delete'));
    await act(async () => {});
    expect(screen.getByText('Delete Losartan?')).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Try again'));
    await act(async () => {});
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Delete Losartan?')).toBeNull();
  });

  it('shows a notice with one OK button', async () => {
    await setup(jest.fn());
    await fireEvent.press(screen.getByText('notify'));
    expect(screen.getByText('Heads up')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('OK'));
    expect(screen.queryByText('Heads up')).toBeNull();
  });
});
