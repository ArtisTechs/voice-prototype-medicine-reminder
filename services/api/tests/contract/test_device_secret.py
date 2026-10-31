"""DEVICE_PATH_SECRET: device paths only work behind /d/<secret>/ when it is set."""

import pytest

from app.core.config import get_settings


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(get_settings(), "device_path_secret", "s3cret-path")
    return "s3cret-path"


async def test_unset_keeps_plain_paths(client, setup):
    assert (await client.get("/api/schedule", params={"device": "pillbox"})).status_code == 200
    assert (await client.get("/d/anything/api/schedule", params={"device": "pillbox"})).status_code == 404


async def test_secret_prefix_works(client, setup, secret):
    r = await client.get(f"/d/{secret}/api/schedule", params={"device": "pillbox"})
    assert r.status_code == 200
    assert "doses" in r.json()
    r = await client.post(f"/d/{secret}/api/events", json={})
    assert r.status_code != 404


async def test_bare_and_wrong_secret_are_hidden(client, setup, secret):
    assert (await client.get("/api/schedule", params={"device": "pillbox"})).status_code == 404
    assert (await client.post("/api/events", json={})).status_code == 404
    assert (await client.get("/d/wrong/api/schedule", params={"device": "pillbox"})).status_code == 404
    assert (await client.get(f"/d/{secret}/api/v1/me")).status_code == 404


async def test_app_api_unaffected(client, secret):
    assert (await client.get("/api/v1/me")).status_code == 401
