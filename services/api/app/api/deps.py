from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import NotFound, Unauthorized
from app.core.security import decode_token
from app.models import PatientCaregiver, User
from app.repositories import patients as patient_repo

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def user_from_token(db: AsyncSession, token: str | None) -> User | None:
    data = decode_token(token or "", "access")
    if not data:
        return None
    return await db.get(User, int(data["sub"]))


async def current_user(db: DbSession, authorization: str | None = Header(default=None)) -> User:
    token = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None
    user = await user_from_token(db, token)
    if user is None:
        raise Unauthorized("unauthorized", "Please sign in again.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def require_patient(db: AsyncSession, user: User, patient_id: int, owner: bool = False) -> PatientCaregiver:
    """404 (not 403) when the caregiver is not linked, so ids do not leak."""
    link = await patient_repo.link(db, user.id, patient_id)
    if link is None or (owner and link.role != "owner"):
        raise NotFound("not_found", "Patient not found.")
    return link
