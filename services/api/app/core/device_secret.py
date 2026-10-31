"""Optional secret prefix for the ESP32 paths when the server is on the internet.

The firmware only sends a fixed device id, so anyone who finds the server could post fake
dose events. With DEVICE_PATH_SECRET set, the device's BACKEND_URL becomes
http://<host>:5000/d/<secret>; the bare /api/schedule, /api/scan and /api/events answer 404.
The secret is stripped here, before anything logs the path.
"""

import secrets

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings

DEVICE_PATHS = ("/api/schedule", "/api/scan", "/api/events")


class DeviceSecretMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        secret = get_settings().device_path_secret
        if scope["type"] != "http" or not secret:
            return await self.app(scope, receive, send)

        path: str = scope["path"]
        if path.startswith("/d/"):
            given, _, rest = path[3:].partition("/")
            if secrets.compare_digest(given, secret) and ("/" + rest) in DEVICE_PATHS:
                scope = dict(scope, path="/" + rest, raw_path=("/" + rest).encode())
                return await self.app(scope, receive, send)
            return await _not_found(send)
        if path in DEVICE_PATHS:
            return await _not_found(send)
        return await self.app(scope, receive, send)


async def _not_found(send: Send) -> None:
    body = b'{"error":{"code":"not_found","message":"Not found."}}'
    await send({"type": "http.response.start", "status": 404, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": body})
