---
name: backend-api
description: Use when writing FastAPI code in services/api: routers, services, repositories, Pydantic v2 schemas, dependency injection, the error format, pagination, OpenAPI tags, API versioning (/api/v1 vs fixed device paths), and settings from environment variables.
---

# Backend API conventions (FastAPI, Python 3.12)

## Layers (see **architecture**)
`router → service → repository → model`. The router validates and shapes the response, the service decides and commits, and the repository runs the queries.

```python
# app/api/v1/medicines.py
router = APIRouter(prefix="/patients/{patient_id}/medicines", tags=["medicines"])

@router.post("", response_model=MedicineOut, status_code=201)
async def create(patient_id: int, body: MedicineCreate,
                 db: DbSession, user: CurrentUser) -> MedicineOut:
    await require_patient(db, user, patient_id)            # 404 if not linked
    med = await medicine_service.create_medicine(db, patient_id, body)
    return MedicineOut.model_validate(med)
```
```python
# app/services/medicine_service.py
async def create_medicine(db: AsyncSession, patient_id: int, data: MedicineCreate) -> Medicine:
    if data.slot and await medicine_repo.slot_in_use(db, patient_id, data.slot):
        raise Conflict("slot_taken", f"Slot {data.slot} already has a medicine.")
    med = await medicine_repo.add(db, Medicine(patient_id=patient_id, **data.model_dump()))
    await db.commit()
    await publish(patient_id, "medicine.updated")
    return med
```

## Dependencies (`app/api/deps.py`)
`DbSession = Annotated[AsyncSession, Depends(get_db)]`, `CurrentUser = Annotated[User, Depends(current_user)]`, `Settings = Annotated[Settings, Depends(get_settings)]`, `require_patient(db, user, pid, owner=False)`. Inject them; never import a global session.

## Schemas (Pydantic v2)
- Base class `ApiModel(BaseModel)` with `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)`. Responses are serialized `by_alias`.
- `XCreate` has required fields with constraints (`Field(min_length=1, max_length=80)`). `XUpdate` has all fields optional, applied with `model_dump(exclude_unset=True)`. `XOut` uses `from_attributes`.
- Device schemas (`schemas/device.py`) **do not** use the camel alias base. They match the contract field-for-field.

## Errors
All errors use one shape:
```json
{"error": {"code": "slot_taken", "message": "Slot 2 already has a medicine.", "details": null}}
```
- Raise `AppError` subclasses from `app/core/errors.py`: `NotFound(404)`, `Conflict(409)`, `BadRequest(400)`, `Unauthorized(401)`, `Forbidden(403)`, `RateLimited(429)`.
- Handlers convert `RequestValidationError` → 422 `validation_error` with `details=[{field, message}]`, and `HTTPException` → the same shape. Unhandled errors → 500 `internal_error` (logged with request id, no body).
- Resources the user cannot access → **404**, not 403.

## Pagination
List endpoints that can grow (`alerts`, `scans`, `history` events) take `?limit=50&offset=0` (limit ≤ 200) and return `Page[T] = {items, total, limit, offset}`. Small fixed lists (medicines, schedules) return plain arrays.

## Versioning and paths
- `/api/v1/...` is the app API. Breaking changes go in `/api/v2`, never edit v1 in place.
- `/api/schedule`, `/api/scan`, `/api/events` are the device API, frozen (see **device-contract**).
- `/api/v1/ws` is the WebSocket. `/healthz` is liveness + DB + Redis check. `/docs` (OpenAPI) is on in dev only (`ENABLE_DOCS`).
- **OpenAPI tags:** `auth, me, patients, invites, devices, medicines, schedules, today, history, alerts, scans, dashboard, device-firmware`.

## Settings (`app/core/config.py`)
`class Settings(BaseSettings)` with `model_config = SettingsConfigDict(env_file=None)`. Every value comes from the env (compose passes `.env`). `get_settings()` is `lru_cache`d. Group by prefix: `DATABASE_URL`, `REDIS_URL`, `JWT_*`, `DEVICE_TZ`, `SCAN_*`, `VISION_*`, `EXPO_*`, `CORS_ORIGINS`. Add every new setting to `.env.example` with a comment.

## Async rules
- Everything is `async def`. CPU-heavy vision runs in `run_in_threadpool` / a bounded executor.
- Never call `requests`. Use `httpx.AsyncClient`. Time comes from `app.core.timeutil.utcnow()`/`device_now()` so tests can freeze it.

## Logging
`structlog`-style JSON lines through `app.core.logging.get_logger(__name__)`. Log ids and timings, never names, emails, medicine names, or tokens (see **security-privacy**).

## Endpoint checklist
- [ ] Tag + `response_model` + status code; 404 on foreign resources
- [ ] Service owns the commit; realtime publish after the commit
- [ ] API test: happy path, validation error, access by another caregiver → 404
- [ ] `docs/api.md` updated
