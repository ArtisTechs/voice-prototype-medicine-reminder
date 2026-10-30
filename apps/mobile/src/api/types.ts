// Mirrors the /api/v1 schemas (camelCase JSON). See docs/api.md.

export type Tokens = { accessToken: string; refreshToken: string };

export type NotifyPrefs = {
  missed: boolean;
  taken: boolean;
  lowStock: boolean;
  expiry: boolean;
  expiredDose: boolean;
  offline: boolean;
  scanUnknown: boolean;
  hideMedicineNames: boolean;
};

export type Me = { id: number; email: string; name: string; timezone: string; notifyPrefs: NotifyPrefs; createdAt: string };

export type Patient = { id: number; displayName: string; note: string | null; role: 'owner' | 'member' };
export type Caregiver = { id: number; name: string; role: 'owner' | 'member' };
export type Invite = { code: string; expiresAt: string };

export type Slot = {
  slot: number;
  medicineId: number | null;
  medicineName: string | null;
  lidOpen: boolean | null;
  lastEventAt: string | null;
};
export type Device = {
  deviceId: string;
  cameraId: string;
  status: 'online' | 'offline';
  lastSeen: string | null;
  cameraLastSeen: string | null;
  slots: Slot[];
};

export type Schedule = { id: number; medicineId: number; time: string; daysOfWeek: number[]; active: boolean };

export type Medicine = {
  id: number;
  patientId: number;
  name: string;
  strength: string | null;
  form: string | null;
  doseAmount: number;
  doseUnit: string | null;
  instructions: string | null;
  slot: number | null;
  barcode: string | null;
  expiryDate: string | null;
  qty: number;
  lowStockThreshold: number;
  refillLeadDays: number;
  active: boolean;
  label: string;
  lowStock: boolean;
  expired: boolean;
  daysLeft: number | null;
  schedules: Schedule[];
  photoCount: number;
};

export type MedicineInput = {
  name: string;
  strength?: string | null;
  form?: string | null;
  doseAmount: number;
  doseUnit?: string | null;
  instructions?: string | null;
  slot?: number | null;
  barcode?: string | null;
  expiryDate?: string | null;
  qty: number;
  lowStockThreshold: number;
  refillLeadDays: number;
};

export type Photo = { id: number; angle: 'front' | 'back' | 'side' | 'correction' | 'other'; url: string; createdAt: string };

export type DoseStatus = 'upcoming' | 'due' | 'taken' | 'late' | 'missed' | 'expired';

export type TodayDose = {
  scheduleId: number;
  medicineId: number;
  medicineName: string;
  slot: number | null;
  time: string;
  dose: string;
  instructions: string | null;
  status: DoseStatus;
  takenAt: string | null;
  delayMinutes: number | null;
};

export type DaySummary = {
  total: number;
  taken: number;
  late: number;
  missed: number;
  expired: number;
  due: number;
  upcoming: number;
};

export type Today = { date: string; doses: TodayDose[]; summary: DaySummary };

export type Totals = { taken: number; late: number; missed: number; expired: number; adherence: number | null };
export type History = {
  fromDate: string;
  toDate: string;
  overall: Totals;
  days: (Totals & { date: string })[];
  medicines: (Totals & { medicineId: number; medicineName: string })[];
  records: {
    scheduleId: number | null;
    date: string;
    time: string;
    medicineId: number;
    medicineName: string;
    status: 'taken' | 'late' | 'missed' | 'expired';
    delayMinutes: number | null;
    takenAt: string | null;
  }[];
};

export type MedicineBrief = { id: number; name: string; qty: number | null; expiryDate: string | null; daysToExpiry: number | null };

export type PatientCard = {
  id: number;
  displayName: string;
  role: 'owner' | 'member';
  today: DaySummary;
  nextDose: { time: string; medicineName: string; slot: number | null } | null;
  unreadAlerts: number;
  lowStock: MedicineBrief[];
  expiringSoon: MedicineBrief[];
  device: { status: 'online' | 'offline'; lastSeen: string | null } | null;
};

export type Dashboard = { patients: PatientCard[]; unreadAlerts: number };

export type Alert = {
  id: number;
  patientId: number | null;
  type: 'missed' | 'taken' | 'low_stock' | 'expiry' | 'expired_dose' | 'offline' | 'scan_unknown';
  severity: 'high' | 'normal' | 'info';
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

export type Scan = {
  id: number;
  found: boolean;
  method: 'barcode' | 'ocr' | 'embed' | 'llm' | 'none';
  score: number | null;
  medicineId: number | null;
  medicineName: string | null;
  correctedMedicineId: number | null;
  correctedNone: boolean;
  correctedAt: string | null;
  ocrExpiry: string | null;
  durationMs: number;
  imageUrl: string;
  createdAt: string;
};
