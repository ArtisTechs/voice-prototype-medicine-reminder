from datetime import datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from app.api.deps import CurrentUser, DbSession
from app.core.errors import NotFound
from app.core.timeutil import utcnow
from app.models import Alert
from app.realtime.publisher import publish_user
from app.schemas.common import ApiModel, Page

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertOut(ApiModel):
    id: int
    patient_id: int | None
    type: str
    severity: str
    title: str
    body: str
    data: dict
    read_at: datetime | None
    created_at: datetime


@router.get("", response_model=Page[AlertOut])
async def list_alerts(
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    unread: bool = False,
    patient_id: int | None = Query(default=None, alias="patientId"),
) -> Page[AlertOut]:
    q = select(Alert).where(Alert.user_id == user.id)
    if unread:
        q = q.where(Alert.read_at.is_(None))
    if patient_id:
        q = q.where(Alert.patient_id == patient_id)
    total = await db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = (await db.scalars(q.order_by(Alert.created_at.desc(), Alert.id.desc()).limit(limit).offset(offset))).all()
    return Page[AlertOut](items=[AlertOut.model_validate(a) for a in rows], total=total, limit=limit, offset=offset)


@router.post("/{alert_id}/read", status_code=204)
async def mark_read(alert_id: int, user: CurrentUser, db: DbSession) -> None:
    res = await db.execute(
        update(Alert)
        .where(Alert.id == alert_id, Alert.user_id == user.id, Alert.read_at.is_(None))
        .values(read_at=utcnow())
    )
    if res.rowcount == 0 and not await db.scalar(
        select(Alert.id).where(Alert.id == alert_id, Alert.user_id == user.id)
    ):
        raise NotFound("not_found", "Alert not found.")
    await db.commit()
    await publish_user(user.id, "alert.read")


@router.post("/read-all", status_code=204)
async def mark_all_read(user: CurrentUser, db: DbSession) -> None:
    await db.execute(
        update(Alert).where(Alert.user_id == user.id, Alert.read_at.is_(None)).values(read_at=utcnow())
    )
    await db.commit()
    await publish_user(user.id, "alert.read")
