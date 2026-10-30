import uuid
from datetime import timedelta
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings
from app.core.timeutil import utcnow

_hasher = PasswordHasher()
ALGORITHM = "HS256"
TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(hashed: str, password: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    return _hasher.check_needs_rehash(hashed)


def create_token(user_id: int, kind: TokenType) -> tuple[str, str, Any]:
    """Returns (token, jti, expires_at)."""
    s = get_settings()
    now = utcnow()
    exp = now + (timedelta(minutes=s.jwt_access_minutes) if kind == "access" else timedelta(days=s.jwt_refresh_days))
    jti = uuid.uuid4().hex
    payload = {"sub": str(user_id), "type": kind, "iat": now, "exp": exp, "jti": jti}
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM), jti, exp


def decode_token(token: str, kind: TokenType) -> dict[str, Any] | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if data.get("type") != kind:
        return None
    return data
