import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CameraPermissionNotice } from '../src/features/medicines/CameraPermission';
import { ThemeProvider } from '../src/theme/ThemeProvider';

const show = (canAskAgain: boolean, onAllow = jest.fn()) =>
  render(
    <ThemeProvider>
      <CameraPermissionNotice reason="The camera is needed." canAskAgain={canAskAgain} onAllow={onAllow} />
    </ThemeProvider>,
  );

describe('camera permission notice', () => {
  it('asks for the camera while the phone still allows asking', async () => {
    const onAllow = jest.fn();
    await show(true, onAllow);
    await fireEvent.press(screen.getByLabelText('Allow camera'));
    expect(onAllow).toHaveBeenCalled();
    expect(screen.queryByLabelText('Open phone settings')).toBeNull();
  });

  it('sends the person to Settings once the camera was refused for good', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await show(false);
    expect(screen.queryByLabelText('Allow camera')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Open phone settings'));
    expect(open).toHaveBeenCalled();
  });
});
