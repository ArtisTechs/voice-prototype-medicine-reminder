import { render, screen } from '@testing-library/react-native';

import { StatusBadge } from '../src/components/StatusBadge';
import type { Status } from '../src/theme/tokens';

const cases: [Status, string][] = [
  ['taken', 'Taken'],
  ['late', 'Taken late'],
  ['due', 'Due now'],
  ['upcoming', 'Upcoming'],
  ['missed', 'Missed'],
  ['expired', 'Expired'],
  ['lowStock', 'Low stock'],
  ['online', 'Online'],
  ['offline', 'Offline'],
];

describe('StatusBadge', () => {
  it.each(cases)('%s shows an icon and the word "%s"', async (status, word) => {
    await render(<StatusBadge status={status} />);
    expect(screen.getByText(word)).toBeTruthy();
    expect(screen.getByTestId(`status-icon-${status}`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText(word)).toBeTruthy();
  });

  it('accepts a custom label', async () => {
    await render(<StatusBadge status="taken" label="Taken 8:04 AM" />);
    expect(screen.getByText('Taken 8:04 AM')).toBeTruthy();
  });
});
