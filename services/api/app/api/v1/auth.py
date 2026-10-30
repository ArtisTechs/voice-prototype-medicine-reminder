from fastapi import APIRouter, Request

from app.api.deps import CurrentUser, DbSession
from app.core.ratelimit import check_rate
from app.schemas.auth import LoginIn, RefreshIn, SignupIn, TokensOut
from app.schemas.common import ApiModel
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else "-"


@router.post("/signup", response_model=TokensOut, status_code=201)
async def signup(body: SignupIn, request: Request, db: DbSession) -> TokensOut:
    await check_rate("signup", _ip(request), 10)
    return await auth_service.signup(db, body)


@router.post("/login", response_model=TokensOut)
async def login(body: LoginIn, request: Request, db: DbSession) -> TokensOut:
    await check_rate("login", _ip(request), 10)
    return await auth_service.login(db, body)


@router.post("/refresh", response_model=TokensOut)
async def refresh(body: RefreshIn, request: Request, db: DbSession) -> TokensOut:
    await check_rate("refresh", _ip(request), 30)
    return await auth_service.refresh(db, body.refresh_token)


class LogoutIn(ApiModel):
    refresh_token: str | None = None
    push_token: str | None = None


@router.post("/logout", status_code=204)
async def logout(body: LogoutIn, user: CurrentUser, db: DbSession) -> None:
    await auth_service.logout(db, user, body.refresh_token, body.push_token)
