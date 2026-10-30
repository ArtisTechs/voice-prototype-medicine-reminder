/** The only place query keys are built (see mobile-expo skill). */
export const qk = {
  meta: () => ['meta'] as const,
  me: () => ['me'] as const,
  dashboard: () => ['dashboard'] as const,
  alerts: () => ['alerts'] as const,
  patients: () => ['patients'] as const,
  patient: (id: number) => ['patient', id] as const,
  today: (id: number) => ['patient', id, 'today'] as const,
  medicines: (id: number) => ['patient', id, 'medicines'] as const,
  medicine: (id: number, mid: number) => ['patient', id, 'medicines', mid] as const,
  history: (id: number, from: string, to: string) => ['patient', id, 'history', from, to] as const,
  device: (id: number) => ['patient', id, 'device'] as const,
  scans: (id: number) => ['patient', id, 'scans'] as const,
  caregivers: (id: number) => ['patient', id, 'caregivers'] as const,
};
