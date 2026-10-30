from datetime import date

from fastapi import APIRouter, Query, WebSocket

from app.api.deps import CurrentUser, DbSession, require_patient, user_from_token
from app.core.db import session_scope
from app.core.logging import get_logger
from app.realtime import ws as hub
from app.repositories import patients as patient_repo
from app.schemas.activity import DashboardOut, HistoryOut, TodayOut
from app.services import intake_service

router = APIRouter()
log = get_logger(__name__)


@router.get("/dashboard", response_model=DashboardOut, tags=["dashboard"])
async def dashboard(user: CurrentUser, db: DbSession) -> DashboardOut:
    return await intake_service.dashboard(db, user)


@router.get("/patients/{patient_id}/today", response_model=TodayOut, tags=["today"])
async def today(patient_id: int, user: CurrentUser, db: DbSession) -> TodayOut:
    await require_patient(db, user, patient_id)
    return await intake_service.today(db, patient_id)


@router.get("/patients/{patient_id}/history", response_model=HistoryOut, tags=["history"])
async def history(
    patient_id: int,
    user: CurrentUser,
    db: DbSession,
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
) -> HistoryOut:
    await require_patient(db, user, patient_id)
    return await intake_service.history(db, patient_id, from_, to)


@router.websocket("/ws")
async def websocket(websocket: WebSocket, token: str = "") -> None:
    """Auth with ?token=<access JWT> (React Native cannot set WS headers). Bad token -> close 4401."""
    async with session_scope() as db:
        user = await user_from_token(db, token)
        user_id = user.id if user else None
    await websocket.accept()
    if user_id is None:
        await websocket.close(code=4401)
        return

    async def patient_ids() -> list[int]:
        async with session_scope() as db:
            return await patient_repo.patient_ids_for_user(db, user_id)

    log.info("ws_open", user_id=user_id)
    await hub.serve(websocket, user_id, patient_ids)
