from sqlalchemy import select

from app.models import RefreshToken, User
from tests.conftest import auth_headers
from tests.factories import make_user


async def signup(client, email="new@example.com", password="secret123", name="Ana"):
    return await client.post("/api/v1/auth/signup", json={"email": email, "password": password, "name": name})


async def test_signup_returns_tokens_and_hashes_password(client, db):
    r = await signup(client, "Ana@Example.com")
    assert r.status_code == 201
    body = r.json()
    assert body["accessToken"] and body["refreshToken"]
    user = await db.scalar(select(User).where(User.email == "ana@example.com"))
    assert user.password_hash.startswith("$argon2id$")


async def test_signup_duplicate_email_409(client):
    await signup(client)
    r = await signup(client, "NEW@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


async def test_signup_validation(client):
    r = await signup(client, "not-an-email", "short")
    assert r.status_code == 422
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"email", "password"} <= fields


async def test_login_success_and_generic_failure(client, db):
    await make_user(db, email="x@example.com")
    await db.commit()
    ok = await client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "password123"})
    assert ok.status_code == 200
    bad_pw = await client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "nope"})
    no_user = await client.post("/api/v1/auth/login", json={"email": "ghost@example.com", "password": "nope"})
    assert bad_pw.status_code == no_user.status_code == 401
    assert bad_pw.json() == no_user.json()
    assert bad_pw.json()["error"]["code"] == "invalid_credentials"


async def test_refresh_rotates_and_reuse_revokes_all(client, db):
    tokens = (await signup(client)).json()
    r1 = await client.post("/api/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]})
    assert r1.status_code == 200
    new = r1.json()
    assert new["refreshToken"] != tokens["refreshToken"]
    # Reusing the old (rotated) token is treated as theft.
    reuse = await client.post("/api/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]})
    assert reuse.status_code == 401
    after = await client.post("/api/v1/auth/refresh", json={"refreshToken": new["refreshToken"]})
    assert after.status_code == 401
    live = await db.scalar(select(RefreshToken).where(RefreshToken.revoked_at.is_(None)))
    assert live is None


async def test_access_token_cannot_refresh(client):
    tokens = (await signup(client)).json()
    r = await client.post("/api/v1/auth/refresh", json={"refreshToken": tokens["accessToken"]})
    assert r.status_code == 401


async def test_protected_route_needs_token(client):
    assert (await client.get("/api/v1/me")).status_code == 401
    assert (await client.get("/api/v1/me", headers={"Authorization": "Bearer junk"})).status_code == 401


async def test_logout_revokes_refresh(client):
    tokens = (await signup(client)).json()
    h = {"Authorization": f"Bearer {tokens['accessToken']}"}
    r = await client.post("/api/v1/auth/logout", json={"refreshToken": tokens["refreshToken"]}, headers=h)
    assert r.status_code == 204
    again = await client.post("/api/v1/auth/refresh", json={"refreshToken": tokens["refreshToken"]})
    assert again.status_code == 401


async def test_login_rate_limited(client):
    codes = [
        (await client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "x"})).status_code
        for _ in range(11)
    ]
    assert codes[-1] == 429


async def test_me_get_patch(client, db):
    user = await make_user(db)
    await db.commit()
    h = auth_headers(user)
    me = (await client.get("/api/v1/me", headers=h)).json()
    assert me["timezone"] == "Asia/Manila"
    assert me["notifyPrefs"]["taken"] is False and me["notifyPrefs"]["missed"] is True
    prefs = {**me["notifyPrefs"], "taken": True}
    r = await client.patch("/api/v1/me", json={"name": "Bea", "notifyPrefs": prefs}, headers=h)
    assert r.status_code == 200
    assert r.json()["name"] == "Bea" and r.json()["notifyPrefs"]["taken"] is True
    bad = await client.patch("/api/v1/me", json={"timezone": "Mars/Base"}, headers=h)
    assert bad.status_code == 422


async def test_push_token_register_is_idempotent(client, db):
    user = await make_user(db)
    await db.commit()
    body = {"token": "ExponentPushToken[abc123xyz]", "platform": "android"}
    for _ in range(2):
        assert (await client.post("/api/v1/me/push-tokens", json=body, headers=auth_headers(user))).status_code == 204
    bad = await client.post("/api/v1/me/push-tokens", json={"token": "nope-nope-nope"}, headers=auth_headers(user))
    assert bad.status_code == 422
