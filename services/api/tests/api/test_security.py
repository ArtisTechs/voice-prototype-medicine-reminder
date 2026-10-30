"""Security review checklist, as tests (see security-privacy skill)."""

from fastapi.routing import APIRoute, APIWebSocketRoute

from app.main import app

PUBLIC = {
    "/healthz",
    "/api/v1/meta",
    "/api/v1/auth/signup",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/schedule",
    "/api/scan",
    "/api/events",
}


def _deps(route) -> set[str]:
    names = set()
    stack = list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        if d.call is not None:
            names.add(getattr(d.call, "__name__", ""))
        stack.extend(d.dependencies)
    return names


def test_every_app_route_requires_a_caregiver_except_the_public_list():
    unguarded = []
    for route in app.routes:
        if isinstance(route, APIWebSocketRoute) or not isinstance(route, APIRoute):
            continue
        if route.path in PUBLIC or route.path.startswith(("/docs", "/openapi")):
            continue
        if "current_user" not in _deps(route):
            unguarded.append(route.path)
    assert unguarded == []


def test_patient_routes_check_the_patient_link():
    """Every /patients/{patient_id}/... handler calls require_patient (404 for strangers)."""
    import inspect

    missing = []
    for route in app.routes:
        if isinstance(route, APIRoute) and "{patient_id}" in route.path:
            if "require_patient" not in inspect.getsource(route.endpoint):
                missing.append(f"{sorted(route.methods)} {route.path}")
    assert missing == []


async def test_errors_never_echo_internals(client):
    r = await client.get("/api/v1/does-not-exist")
    assert r.status_code == 404 and set(r.json()) == {"error"}


async def test_docs_follow_setting():
    from app.core.config import get_settings

    assert get_settings().enable_docs is False or app.docs_url == "/docs"
