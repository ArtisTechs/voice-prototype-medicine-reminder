from fastapi import APIRouter

from app.api.v1 import auth, me, medicines, meta, patients

router = APIRouter(prefix="/api/v1")
for module in (meta, auth, me, patients, medicines):
    router.include_router(module.router)
