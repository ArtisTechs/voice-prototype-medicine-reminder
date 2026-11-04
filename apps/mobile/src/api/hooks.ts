import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { photoForm } from '../lib/photoForm';

import { api } from './client';
import { qk } from './keys';
import type {
  Alert,
  Caregiver,
  Dashboard,
  Device,
  History,
  Invite,
  Me,
  Medicine,
  MedicineInput,
  NearbyDevice,
  NotifyPrefs,
  Page,
  Patient,
  Photo,
  Scan,
  Schedule,
  Today,
} from './types';

const p = (id: number) => `/api/v1/patients/${id}`;

// ---- reads -------------------------------------------------------------------------------------
export const useMe = () => useQuery({ queryKey: qk.me(), queryFn: () => api<Me>('/api/v1/me') });
export const useDashboard = () => useQuery({ queryKey: qk.dashboard(), queryFn: () => api<Dashboard>('/api/v1/dashboard') });
export const usePatients = () => useQuery({ queryKey: qk.patients(), queryFn: () => api<Patient[]>('/api/v1/patients') });
export const usePatient = (id: number) =>
  useQuery({ queryKey: [...qk.patient(id), 'info'], queryFn: () => api<Patient>(p(id)) });
export const useToday = (id: number) => useQuery({ queryKey: qk.today(id), queryFn: () => api<Today>(`${p(id)}/today`) });
export const useMedicines = (id: number) =>
  useQuery({ queryKey: qk.medicines(id), queryFn: () => api<Medicine[]>(`${p(id)}/medicines`) });
export const useMedicine = (id: number, mid: number, enabled = true) =>
  useQuery({ queryKey: qk.medicine(id, mid), queryFn: () => api<Medicine>(`${p(id)}/medicines/${mid}`), enabled });
export const usePhotos = (id: number, mid: number, enabled = true) =>
  useQuery({
    queryKey: [...qk.medicine(id, mid), 'photos'],
    queryFn: () => api<Photo[]>(`${p(id)}/medicines/${mid}/photos`),
    enabled,
  });
export const useHistory = (id: number, from: string, to: string) =>
  useQuery({ queryKey: qk.history(id, from, to), queryFn: () => api<History>(`${p(id)}/history`, { query: { from, to } }) });
export const useDevice = (id: number) =>
  useQuery({ queryKey: qk.device(id), queryFn: () => api<Device>(`${p(id)}/device`), retry: false });
/** Polls while a pairing screen is open, so a VOICE that was just switched on shows up by itself. */
export const useNearbyDevices = (enabled = true) =>
  useQuery({
    queryKey: qk.nearbyDevices(),
    queryFn: () => api<NearbyDevice[]>('/api/v1/devices/nearby'),
    enabled,
    refetchInterval: 5000,
  });
export const useCaregivers = (id: number) =>
  useQuery({ queryKey: qk.caregivers(id), queryFn: () => api<Caregiver[]>(`${p(id)}/caregivers`) });
export const useAlerts = () =>
  useQuery({ queryKey: qk.alerts(), queryFn: () => api<Page<Alert>>('/api/v1/alerts', { query: { limit: 100 } }) });
export const useScans = (id: number) =>
  useQuery({ queryKey: qk.scans(id), queryFn: () => api<Page<Scan>>(`${p(id)}/scans`, { query: { limit: 50 } }) });

// ---- writes ------------------------------------------------------------------------------------
function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly unknown[][]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useCreatePatient() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { displayName: string; note?: string }) => api<Patient>('/api/v1/patients', { method: 'POST', body }),
    onSuccess: () => inv([...qk.patients()], [...qk.dashboard()]),
  });
}

export function useAcceptInvite() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (code: string) => api<Patient>('/api/v1/invites/accept', { method: 'POST', body: { code } }),
    onSuccess: () => inv([...qk.patients()], [...qk.dashboard()]),
  });
}

export function useCreateInvite(id: number) {
  return useMutation({ mutationFn: () => api<Invite>(`${p(id)}/invites`, { method: 'POST' }) });
}

export function useLeavePatient(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api<void>(`${p(id)}/leave`, { method: 'POST' }),
    onSuccess: () => inv([...qk.patients()], [...qk.dashboard()]),
  });
}

type PairBody = { deviceId: string; cameraId?: string | null };

/** `id` may be left out when the person is created in the same step; pass `patientId` then. */
export function usePairDevice(id?: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ patientId = id, ...body }: PairBody & { patientId?: number }) =>
      api<Device>(`${p(patientId!)}/device`, { method: 'PUT', body }),
    onSuccess: (_d, { patientId = id }) =>
      inv([...qk.device(patientId!)], [...qk.nearbyDevices()], [...qk.dashboard()]),
  });
}

export function useUnpairDevice(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api<void>(`${p(id)}/device`, { method: 'DELETE' }),
    onSuccess: () => inv([...qk.device(id)], [...qk.nearbyDevices()], [...qk.dashboard()]),
  });
}

export function useSaveMedicine(id: number, mid?: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: Partial<MedicineInput>) =>
      mid
        ? api<Medicine>(`${p(id)}/medicines/${mid}`, { method: 'PATCH', body })
        : api<Medicine>(`${p(id)}/medicines`, { method: 'POST', body }),
    onSuccess: () => inv([...qk.medicines(id)], [...qk.today(id)], [...qk.dashboard()], [...qk.device(id)]),
  });
}

export function useDeleteMedicine(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (mid: number) => api<void>(`${p(id)}/medicines/${mid}`, { method: 'DELETE' }),
    onSuccess: () => inv([...qk.medicines(id)], [...qk.today(id)], [...qk.dashboard()]),
  });
}

export function useScheduleMutations(id: number, mid: number) {
  const inv = useInvalidate();
  const done = () => inv([...qk.medicine(id, mid)], [...qk.medicines(id)], [...qk.today(id)], [...qk.dashboard()]);
  const base = `${p(id)}/medicines/${mid}/schedules`;
  return {
    add: useMutation({
      mutationFn: (body: { time: string; daysOfWeek: number[] }) => api<Schedule>(base, { method: 'POST', body }),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ sid, ...body }: { sid: number; time?: string; daysOfWeek?: number[]; active?: boolean }) =>
        api<Schedule>(`${base}/${sid}`, { method: 'PATCH', body }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (sid: number) => api<void>(`${base}/${sid}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

export function usePhotoMutations(id: number, mid: number) {
  const inv = useInvalidate();
  const done = () => inv([...qk.medicine(id, mid)], [...qk.medicines(id)]);
  const base = `${p(id)}/medicines/${mid}/photos`;
  return {
    upload: useMutation({
      mutationFn: async ({ uri, angle }: { uri: string; angle: string }) => {
        const form = await photoForm(uri, `${angle}.jpg`, { angle });
        return api<Photo>(base, { method: 'POST', body: form, timeoutMs: 60000 });
      },
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (photoId: number) => api<void>(`${base}/${photoId}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

export function useUpdateMe() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { name?: string; timezone?: string; notifyPrefs?: NotifyPrefs }) =>
      api<Me>('/api/v1/me', { method: 'PATCH', body }),
    onSuccess: () => inv([...qk.me()]),
  });
}

export function useAlertMutations() {
  const inv = useInvalidate();
  const done = () => inv([...qk.alerts()], [...qk.dashboard()]);
  return {
    read: useMutation({ mutationFn: (aid: number) => api<void>(`/api/v1/alerts/${aid}/read`, { method: 'POST' }), onSuccess: done }),
    readAll: useMutation({ mutationFn: () => api<void>('/api/v1/alerts/read-all', { method: 'POST' }), onSuccess: done }),
  };
}

export function useCorrectScan(id: number) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ scanId, medicineId }: { scanId: number; medicineId: number | null }) =>
      api<Scan>(`${p(id)}/scans/${scanId}/correct`, { method: 'POST', body: { medicineId } }),
    onSuccess: () => inv([...qk.scans(id)], [...qk.medicines(id)]),
  });
}
