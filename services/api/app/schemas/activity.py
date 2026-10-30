from datetime import date, datetime

from app.schemas.common import ApiModel


class TodayDose(ApiModel):
    schedule_id: int
    medicine_id: int
    medicine_name: str
    slot: int | None
    time: str
    dose: str
    instructions: str | None
    status: str  # upcoming | due | taken | late | missed | expired
    taken_at: datetime | None
    delay_minutes: int | None


class DaySummary(ApiModel):
    total: int = 0
    taken: int = 0
    late: int = 0
    missed: int = 0
    expired: int = 0
    due: int = 0
    upcoming: int = 0


class TodayOut(ApiModel):
    date: date
    doses: list[TodayDose]
    summary: DaySummary


class HistoryRecord(ApiModel):
    schedule_id: int | None
    date: date
    time: str
    medicine_id: int
    medicine_name: str
    status: str  # taken | late | missed | expired
    delay_minutes: int | None
    taken_at: datetime | None


class Totals(ApiModel):
    taken: int = 0
    late: int = 0
    missed: int = 0
    expired: int = 0
    adherence: float | None = None


class DayHistory(Totals):
    date: date


class MedicineHistory(Totals):
    medicine_id: int
    medicine_name: str


class HistoryOut(ApiModel):
    from_date: date
    to_date: date
    overall: Totals
    days: list[DayHistory]
    medicines: list[MedicineHistory]
    records: list[HistoryRecord]


class NextDose(ApiModel):
    time: str
    medicine_name: str
    slot: int | None


class MedicineBrief(ApiModel):
    id: int
    name: str
    qty: int | None = None
    expiry_date: date | None = None
    days_to_expiry: int | None = None


class DeviceBrief(ApiModel):
    status: str
    last_seen: datetime | None


class PatientCard(ApiModel):
    id: int
    display_name: str
    role: str
    today: DaySummary
    next_dose: NextDose | None
    unread_alerts: int
    low_stock: list[MedicineBrief]
    expiring_soon: list[MedicineBrief]
    device: DeviceBrief | None


class DashboardOut(ApiModel):
    patients: list[PatientCard]
    unread_alerts: int
