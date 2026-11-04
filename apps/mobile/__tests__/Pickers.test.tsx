import { fireEvent, render, screen } from '@testing-library/react-native';

import { DateField, TimeField } from '../src/components/Fields';
import { ThemeProvider } from '../src/theme/ThemeProvider';

// The wheel library scrolls natively; in tests each wheel becomes a list of tappable items.
jest.mock('@quidone/react-native-wheel-picker', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ data, onValueChanged }: { data: { value: unknown; label: string }[]; onValueChanged: (e: { item: unknown }) => void }) => (
      <View>
        {data.map((item) => (
          <Pressable key={String(item.value)} accessibilityRole="button" accessibilityLabel={`wheel ${item.label}`} onPress={() => onValueChanged({ item })}>
            <Text>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('custom pickers', () => {
  it('picks a time with the app sheet and returns 24-hour HH:MM', async () => {
    const onChange = jest.fn();
    await wrap(<TimeField label="Time" value="08:00" onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText(/Time: 8:00 AM/));
    expect(screen.getByText('Choose a time')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('wheel 2'));
    await fireEvent.press(screen.getByLabelText('wheel 37')); // any minute, not just steps of 5
    await fireEvent.press(screen.getByLabelText('wheel PM'));
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith('14:37');
  });

  it('nudges the time by one minute, across the hour and midnight', async () => {
    const onChange = jest.fn();
    await wrap(<TimeField label="Time" value="23:59" onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText(/Time: 11:59 PM/));
    await fireEvent.press(screen.getByLabelText('+ 1 minute'));
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith('00:00');
  });

  it('picks a date from the calendar sheet and returns YYYY-MM-DD', async () => {
    const onChange = jest.fn();
    await wrap(<DateField label="Expiry date" value="2026-11-04" onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText(/Expiry date: November 4, 2026/));
    expect(screen.getByText('November 2026')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('November 20, 2026'));
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith('2026-11-20');
  });

  it('moves between months and blocks days before the minimum date', async () => {
    const onChange = jest.fn();
    await wrap(<DateField label="From" value="2026-11-04" onChange={onChange} minimumDate={new Date(2026, 10, 10)} />);
    await fireEvent.press(screen.getByLabelText(/From: November 4, 2026/));
    await fireEvent.press(screen.getByLabelText('November 7, 2026'));
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onChange).toHaveBeenCalledWith('2026-11-04'); // the blocked day did not change the selection
    await fireEvent.press(screen.getByLabelText(/From: November 4, 2026/));
    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(screen.getByText('December 2026')).toBeTruthy();
  });
});
