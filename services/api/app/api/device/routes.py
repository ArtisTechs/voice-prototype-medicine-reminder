"""Fixed ESP32 endpoints. FROZEN contract: load the device-contract skill before editing.
Unauthenticated by necessity; only paired device ids are accepted, and every path is rate limited."""

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse

from app.api.deps import DbSession
from app.core.config import get_settings
from app.core.errors import TooLarge
from app.core.ratelimit import check_rate
from app.schemas.device import EventIn, ScanFound, ScheduleOut
from app.services import device_service, scan_service

router = APIRouter(prefix="/api", tags=["device-firmware"])


@router.get("/schedule", response_model=ScheduleOut)
async def schedule(db: DbSession, device: str = Query(min_length=1, max_length=32)) -> ScheduleOut:
    await check_rate("schedule", device, 30)
    dev = await device_service.resolve(db, device)
    return await device_service.get_schedule(db, dev)


@router.post(
    "/scan",
    responses={200: {"model": ScanFound, "description": 'Match, or exactly {"found": false}'}},
    openapi_extra={"requestBody": {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def scan(
    request: Request,
    db: DbSession,
    x_device: str | None = Header(default=None, alias="X-Device"),
):
    await check_rate("scan", x_device or "-", 6)
    limit = get_settings().scan_max_bytes
    if int(request.headers.get("content-length") or 0) > limit:
        raise TooLarge(message="Image is larger than 4 MB.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise TooLarge(message="Image is larger than 4 MB.")
        chunks.append(chunk)
    answer = await scan_service.scan(db, x_device, b"".join(chunks), request.headers.get("content-type"))
    return JSONResponse(answer)


@router.post("/events")
async def events(body: EventIn, db: DbSession) -> dict:
    await check_rate("events", body.device, 120)
    fresh = await device_service.record_event(db, body)
    return {"ok": True} if fresh else {"ok": True, "duplicate": True}
