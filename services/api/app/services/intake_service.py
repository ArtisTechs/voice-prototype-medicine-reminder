"""Today timeline, history/adherence and the dashboard. Read-side of intake records."""

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import BadRequest
from app.core.timeutil import device_now, dose_instant
from app.models import Alert, IntakeRecord, Medicine, Schedule, User
from app.repositories import devices as device_repo
from app.repositories import events as event_repo
from app.repositories import medicines as med_repo
from app.repositories import patients as patient_repo
from app.schemas.activity import (
    DashboardOut,
    DaySummary,
    DayHistory,
    DeviceBrief,
    HistoryOut,
    HistoryRecord,
    MedicineBrief,
    MedicineHistory,
    NextDose,
    PatientCard,
    TodayDose,
    TodayOut,
    Totals,
)
from app.services import alert_service
from app.services.device_service import dose_text
from app.services.patient_service import is_online

MAX_HISTORY_DAYS = 92


def record_status(rec: IntakeRecord) -> str:
    if rec.status == "taken":
        late = (rec.delay_minutes or 0) > get_settings().late_after_minutes
        return "late" if late else "taken"
    return rec.status


def live_status(rec: IntakeRecord | None, med: Medicine, sched: Schedule, day: date, now: datetime) -> str:
    """Status of one dose today. Without a record, the clock decides (the device may not have reported yet)."""
    expired = bool(med.expiry_date and med.expiry_date < day)
    if rec is not None and rec.status != "due":
        return record_status(rec)
    at = dose_instant(day, sched.time)
    if now < at:
        return "expired" if expired else "upcoming"
    if now - at > timedelta(minutes=get_settings().missed_fallback_minutes):
        return "missed"
    return "expired" if expired else "due"


async def today(db: AsyncSession, patient_id: int) -> TodayOut:
    now = device_now()
    day = now.date()
    rows = await med_repo.device_doses(db, patient_id, day.weekday())
    recs = {r.schedule_id: r for r in await event_repo.intakes_for_day(db, patient_id, day)}
    summary = DaySummary()
    doses = []
    for sched, med in rows:
        rec = recs.get(sched.id)
        status = live_status(rec, med, sched, day, now)
        setattr(summary, status, getattr(summary, status) + 1)
        summary.total += 1
        doses.append(
            TodayDose(
                schedule_id=sched.id,
                medicine_id=med.id,
                medicine_name=med.label,
                slot=med.slot,
                time=sched.time.strftime("%H:%M"),
                dose=dose_text(med),
                instructions=med.instructions,
                status=status,
                taken_at=rec.taken_at if rec else None,
                delay_minutes=rec.delay_minutes if rec and rec.status == "taken" else None,
            )
        )
    return TodayOut(date=day, doses=doses, summary=summary)


def _adherence(t: Totals) -> Totals:
    done = t.taken + t.late
    denom = done + t.missed + t.expired
    t.adherence = round(100 * done / denom, 1) if denom else None
    return t


async def history(db: AsyncSession, patient_id: int, start: date | None, end: date | None) -> HistoryOut:
    today_ = device_now().date()
    end = end or today_
    start = start or end - timedelta(days=6)
    if start > end:
        raise BadRequest("bad_range", "The start date must be before the end date.")
    if (end - start).days + 1 > MAX_HISTORY_DAYS:
        raise BadRequest("range_too_long", f"Choose at most {MAX_HISTORY_DAYS} days.")
    recs = [r for r in await event_repo.intakes_between(db, patient_id, start, end) if r.status != "due"]
    names = {
        m.id: m.label
        for m in await db.scalars(select(Medicine).where(Medicine.patient_id == patient_id))
    }
    overall = Totals()
    by_day: dict[date, DayHistory] = {}
    by_med: dict[int, MedicineHistory] = {}
    records = []
    for r in recs:
        status = record_status(r)
        for bucket in (
            overall,
            by_day.setdefault(r.dose_date, DayHistory(date=r.dose_date)),
            by_med.setdefault(
                r.medicine_id, MedicineHistory(medicine_id=r.medicine_id, medicine_name=names.get(r.medicine_id, "?"))
            ),
        ):
            setattr(bucket, status, getattr(bucket, status) + 1)
        records.append(
            HistoryRecord(
                schedule_id=r.schedule_id,
                date=r.dose_date,
                time=r.scheduled_time.strftime("%H:%M"),
                medicine_id=r.medicine_id,
                medicine_name=names.get(r.medicine_id, "?"),
                status=status,
                delay_minutes=r.delay_minutes,
                taken_at=r.taken_at,
            )
        )
    days = []
    d = start
    while d <= end:
        days.append(_adherence(by_day.get(d, DayHistory(date=d))))
        d += timedelta(days=1)
    return HistoryOut(
        from_date=start,
        to_date=end,
        overall=_adherence(overall),
        days=days,
        medicines=[_adherence(m) for m in sorted(by_med.values(), key=lambda m: m.medicine_name)],
        records=list(reversed(records)),
    )


async def dashboard(db: AsyncSession, user: User) -> DashboardOut:
    cards = []
    unread_rows = await db.execute(
        select(Alert.patient_id, func.count())
        .where(Alert.user_id == user.id, Alert.read_at.is_(None))
        .group_by(Alert.patient_id)
    )
    unread = {pid: n for pid, n in unread_rows.all()}
    day = device_now().date()
    for patient, role in await patient_repo.for_user(db, user.id):
        t = await today(db, patient.id)
        upcoming = [d for d in t.doses if d.status in ("upcoming", "due")]
        nxt = upcoming[0] if upcoming else None
        low, expiring = [], []
        for m in await med_repo.list_for_patient(db, patient.id):
            left = alert_service.days_left(m.qty, m.dose_amount, [s.days_of_week for s in m.schedules if s.active])
            if m.qty <= m.low_stock_threshold or left <= m.refill_lead_days:
                low.append(MedicineBrief(id=m.id, name=m.label, qty=m.qty))
            if m.expiry_date and (m.expiry_date - day).days <= 30:
                expiring.append(
                    MedicineBrief(
                        id=m.id, name=m.label, expiry_date=m.expiry_date, days_to_expiry=(m.expiry_date - day).days
                    )
                )
        dev = await device_repo.for_patient(db, patient.id)
        cards.append(
            PatientCard(
                id=patient.id,
                display_name=patient.display_name,
                role=role,
                today=t.summary,
                next_dose=NextDose(time=nxt.time, medicine_name=nxt.medicine_name, slot=nxt.slot) if nxt else None,
                unread_alerts=unread.get(patient.id, 0),
                low_stock=low,
                expiring_soon=sorted(expiring, key=lambda b: b.days_to_expiry or 0),
                device=DeviceBrief(status="online" if is_online(dev) else "offline", last_seen=dev.last_seen)
                if dev
                else None,
            )
        )
    return DashboardOut(patients=cards, unread_alerts=sum(unread.values()))
