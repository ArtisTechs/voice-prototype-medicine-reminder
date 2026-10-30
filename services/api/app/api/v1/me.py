from fastapi import APIRouter
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import CurrentUser, DbSession
from app.models import PushToken
from app.models.user import DEFAULT_NOTIFY_PREFS
from app.schemas.auth import MeOut, MeUpdate, NotifyPrefs, PushTokenIn
from app.services import patient_service

router = APIRouter(prefix="/me", tags=["me"])


def _out(user) -> MeOut:
    prefs = NotifyPrefs(**{k: user.pref(k) for k in DEFAULT_NOTIFY_PREFS})
    return MeOut(
        id=user.id, email=user.email, name=user.name, timezone=user.timezone, notify_prefs=prefs,
        created_at=user.created_at,
    )


@router.get("", response_model=MeOut)
async def me(user: CurrentUser) -> MeOut:
    return _out(user)


@router.patch("", response_model=MeOut)
async def update_me(body: MeUpdate, user: CurrentUser, db: DbSession) -> MeOut:
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name"):
        user.name = changes["name"].strip()
    if changes.get("timezone"):
        user.timezone = changes["timezone"]
    if body.notify_prefs is not None:
        user.notify_prefs = body.notify_prefs.model_dump()
    await db.commit()
    return _out(user)


@router.delete("", status_code=204)
async def delete_me(user: CurrentUser, db: DbSession) -> None:
    """Delete on request: account, tokens, alerts and every patient nobody else looks after."""
    await patient_service.delete_account(db, user)


@router.post("/push-tokens", status_code=204)
async def add_push_token(body: PushTokenIn, user: CurrentUser, db: DbSession) -> None:
    stmt = insert(PushToken).values(user_id=user.id, token=body.token, platform=body.platform)
    await db.execute(
        stmt.on_conflict_do_update(index_elements=["token"], set_={"user_id": user.id, "platform": body.platform})
    )
    await db.commit()
