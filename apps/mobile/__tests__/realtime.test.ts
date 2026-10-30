import { QueryClient } from '@tanstack/react-query';

import { qk } from '../src/api/keys';
import { applyMessage } from '../src/realtime/RealtimeProvider';

describe('realtime -> query invalidation', () => {
  it('invalidates the patient and dashboard on intake updates', () => {
    const qc = new QueryClient();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    applyMessage(qc, { type: 'intake.updated', patientId: 7 });
    const keys = spy.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toContainEqual(qk.patient(7));
    expect(keys).toContainEqual(qk.dashboard());
  });

  it('invalidates alerts on alert.created and scans on scan.created', () => {
    const qc = new QueryClient();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    applyMessage(qc, { type: 'alert.created', patientId: 7 });
    applyMessage(qc, { type: 'scan.created', patientId: 7 });
    applyMessage(qc, { type: 'ping' });
    const keys = spy.mock.calls.map(([f]) => f?.queryKey);
    expect(keys).toEqual([qk.alerts(), qk.dashboard(), qk.scans(7)]);
  });
});
