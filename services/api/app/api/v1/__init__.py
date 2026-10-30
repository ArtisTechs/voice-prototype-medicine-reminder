from fastapi import APIRouter

from app.api.v1 import activity, alerts, auth, me, medicines, meta, patients, photos

router = APIRouter(prefix="/api/v1")
for module in (meta, auth, me, patients, medicines, photos, activity, alerts):
    router.include_router(module.router)
