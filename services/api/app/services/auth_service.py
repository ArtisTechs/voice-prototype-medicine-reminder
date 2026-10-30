"""Caregiver auth: argon2 passwords, JWT access + rotating refresh tokens with reuse detection."""

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, Unauthorized
from app.core.logging import get_logger
from app.core.security import create_token, decode_token, hash_password, needs_rehash, verify_password
from app.core.timeutil import utcnow
from app.models import PushToken, RefreshToken, User
from app.schemas.auth import LoginIn, SignupIn, TokensOut

log = get_logger(__name__)
_DUMMY_HASH = hash_password("timing-equaliser-not-a-password")


async def _issue(db: AsyncSession, user_id: int) -> TokensOut:
    access, _, _ = create_token(user_id, "access")
    refresh, jti, exp = create_token(user_id, "refresh")
    db.add(RefreshToken(jti=jti, user_id=user_id, expires_at=exp))
    await db.commit()
    return TokensOut(access_token=access, refresh_token=refresh)


async def signup(db: AsyncSession, data: SignupIn) -> TokensOut:
    email = data.email.lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("email_taken", "An account with this email already exists. Try signing in.")
    user = User(email=email, password_hash=hash_password(data.password), name=data.name.strip())
    db.add(user)
    await db.flush()
    log.info("signup", user_id=user.id)
    return await _issue(db, user.id)


async def login(db: AsyncSession, data: LoginIn) -> TokensOut:
    user = await db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None:
        verify_password(_DUMMY_HASH, data.password)  # same work either way
        raise Unauthorized("invalid_credentials", "Email or password is not right.")
    if not verify_password(user.password_hash, data.password):
        raise Unauthorized("invalid_credentials", "Email or password is not right.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)
    log.info("login", user_id=user.id)
    return await _issue(db, user.id)


async def refresh(db: AsyncSession, token: str) -> TokensOut:
    data = decode_token(token, "refresh")
    if not data:
        raise Unauthorized("invalid_token", "Please sign in again.")
    row = await db.get(RefreshToken, data["jti"], with_for_update=True)
    if row is None:
        raise Unauthorized("invalid_token", "Please sign in again.")
    if row.revoked_at is not None:
        # A revoked token was presented again: assume theft, end every session of this user.
        await revoke_all(db, row.user_id)
        await db.commit()
        log.warning("refresh_reuse_detected", user_id=row.user_id)
        raise Unauthorized("invalid_token", "Please sign in again.")
    row.revoked_at = utcnow()
    return await _issue(db, row.user_id)


async def revoke_all(db: AsyncSession, user_id: int) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


async def logout(db: AsyncSession, user: User, refresh_token: str | None, push_token: str | None) -> None:
    data = decode_token(refresh_token or "", "refresh")
    if data and int(data["sub"]) == user.id:
        await db.execute(update(RefreshToken).where(RefreshToken.jti == data["jti"]).values(revoked_at=utcnow()))
    if push_token:
        await db.execute(delete(PushToken).where(PushToken.user_id == user.id, PushToken.token == push_token))
    await db.commit()
