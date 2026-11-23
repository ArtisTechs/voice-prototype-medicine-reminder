import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { permissionState, registerForPush, type PushState } from './push';

/** Explain first, then ask (ui-ux): shown until notifications are allowed. */
export function PushPrompt() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const check = () =>
      permissionState()
        .then(setState)
        .catch(() => setState('unsupported'));
    check();
    // Coming back from the phone's Settings with notifications switched on: re-register and hide this card.
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      registerForPush(false)
        .then(setState)
        .catch(check);
    });
    return () => sub.remove();
  }, []);
  if (state === 'loading' || state === 'granted' || state === 'unsupported') return null;
  return (
    <Card>
      <AppText variant="title">Get alerts on this phone</AppText>
      <AppText>
        Turn on notifications so you hear right away when a dose is missed, medicine runs low, or MIRA goes
        offline.
      </AppText>
      {state === 'denied' ? (
        <Button title="Open phone settings" variant="secondary" icon="settings" onPress={() => Linking.openSettings()} />
      ) : (
        <Button
          title="Turn on notifications"
          icon="notifications"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            setState(await registerForPush(true).catch(() => 'unsupported' as const));
            setBusy(false);
          }}
        />
      )}
    </Card>
  );
}
