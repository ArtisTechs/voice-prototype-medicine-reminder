#!/usr/bin/env python3
"""Acts like the two ESP32 boards (main `pillbox` + `pillbox-cam`) against the backend.

Standard library only, so it runs anywhere:  python sim.py --base http://localhost:5000 day

Subcommands:
  poll                         GET /api/schedule once and print it
  watch                        poll every 60 s like the firmware (Ctrl+C to stop)
  event <type> [doseId]        POST one event (time = now, PH)
  scan <file.jpg>              POST a JPEG like the ESP32-CAM
  offline-buffer               send 8 buffered events, then resend them all (must be idempotent)
  day                          full-day walk-through with checks (exit code 1 on failure)
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

PH = timedelta(hours=8)  # firmware clock is fixed to UTC+8
HERE = Path(__file__).resolve().parent


def ph_now() -> datetime:
    return (datetime.now(UTC) + PH).replace(tzinfo=None, microsecond=0)


class Http:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body=None, headers=None, raw: bytes | None = None, timeout=15):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        h = {"Content-Type": "application/json"} if body is not None else {}
        if self.token and path.startswith("/api/v1"):
            h["Authorization"] = f"Bearer {self.token}"
        h.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode() or "null"
                return resp.status, json.loads(text), time.monotonic() - t0
        except urllib.error.HTTPError as e:
            text = e.read().decode() or "null"
            try:
                return e.code, json.loads(text), time.monotonic() - t0
            except json.JSONDecodeError:
                return e.code, text, time.monotonic() - t0


class Sim:
    def __init__(self, args):
        self.http = Http(args.base)
        self.device = args.device
        self.cam = args.cam
        self.args = args
        self.failures = 0

    # ---- firmware actions ------------------------------------------------------------------
    def poll(self):
        status, body, dt = self.http.call("GET", f"/api/schedule?device={self.device}")
        if status != 200:
            raise SystemExit(f"schedule failed: {status} {body}")
        return body["doses"], dt

    def event(self, type_, dose_id=0, slot=None, at: datetime | None = None):
        body = {"device": self.device, "type": type_, "doseId": dose_id,
                "time": (at or ph_now()).isoformat(timespec="seconds")}
        if slot is not None:
            body["slot"] = slot
        return self.http.call("POST", "/api/events", body)

    def scan(self, path: Path):
        return self.http.call(
            "POST", "/api/scan", raw=path.read_bytes(),
            headers={"Content-Type": "image/jpeg", "X-Device": self.cam}, timeout=15,
        )

    # ---- checks ----------------------------------------------------------------------------
    def check(self, ok: bool, label: str, detail=""):
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' - ' + str(detail)) if detail and not ok else ''}")
        if not ok:
            self.failures += 1
        return ok

    def login(self) -> bool:
        status, body, _ = self.http.call(
            "POST", "/api/v1/auth/login", {"email": self.args.email, "password": self.args.password}
        )
        if status == 200:
            self.http.token = body["accessToken"]
            return True
        print(f"  (app API login unavailable: {status}; alert checks skipped)")
        return False

    def today_status(self) -> dict[int, str]:
        status, pats, _ = self.http.call("GET", "/api/v1/patients")
        if status != 200 or not pats:
            return {}
        pid = pats[0]["id"]
        status, today, _ = self.http.call("GET", f"/api/v1/patients/{pid}/today")
        return {d["scheduleId"]: d["status"] for d in today.get("doses", [])} if status == 200 else {}

    def wait_alert(self, type_: str, since_ids: set[int], seconds=5.0):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            status, page, _ = self.http.call("GET", "/api/v1/alerts?limit=20")
            if status == 200:
                for a in page["items"]:
                    if a["type"] == type_ and a["id"] not in since_ids:
                        return a, seconds - (end - time.monotonic())
            time.sleep(0.3)
        return None, seconds

    def alert_ids(self) -> set[int]:
        status, page, _ = self.http.call("GET", "/api/v1/alerts?limit=50")
        return {a["id"] for a in page["items"]} if status == 200 else set()

    # ---- scenarios -------------------------------------------------------------------------
    def day(self):
        print(f"== Full day against {self.http.base} (device={self.device}) ==")
        doses, dt = self.poll()
        self.check(dt < 2, f"schedule answered in {dt:.2f}s with {len(doses)} doses")
        self.check(len(doses) > 0, "schedule has doses (run `make seed`)")
        if not doses:
            return
        today = ph_now().date()
        logged_in = self.login()
        status_by_id = self.today_status() if logged_in else {}
        pending = [d for d in doses if status_by_id.get(d["id"], "upcoming") in ("upcoming", "due")
                   and d["expiry"] and d["expiry"] >= today.isoformat()]
        if len(pending) < 2:
            print("  Not enough untaken, unexpired doses left today. Run `make reset-seed` and try again.")
            self.failures += 1
            return
        a, b = pending[0], pending[1]

        def at(dose, minutes=0):
            hh, mm = map(int, dose["time"].split(":"))
            return datetime(today.year, today.month, today.day, hh, mm) + timedelta(minutes=minutes, seconds=time.time() % 60)

        print(f"-> Dose {a['id']} ({a['name']}, slot {a['slot']}, {a['time']}) becomes due, lid opened after 3 min")
        s, body, _ = self.event("due", a["id"], a["slot"], at(a))
        self.check(s == 200, "due accepted", body)
        s, body, _ = self.event("taken", a["id"], a["slot"], at(a, 3))
        self.check(s == 200, "taken accepted", body)
        after, _ = self.poll()
        new_qty = next(d["qty"] for d in after if d["id"] == a["id"])
        amount = int(a["dose"].split()[0])
        self.check(new_qty == max(0, a["qty"] - amount), f"qty went down {a['qty']} -> {new_qty}")

        print(f"-> Dose {b['id']} ({b['name']}, {b['time']}) becomes due, nobody opens the lid for 30 min")
        before = self.alert_ids() if logged_in else set()
        s, _, _ = self.event("due", b["id"], b["slot"], at(b))
        self.check(s == 200, "due accepted")
        missed_at = at(b, 30)
        s, _, _ = self.event("missed", b["id"], b["slot"], missed_at)
        self.check(s == 200, "missed accepted")
        if logged_in:
            alert, secs = self.wait_alert("missed", before)
            self.check(alert is not None, f"caregiver got a missed alert in {secs:.1f}s", "no alert within 5 s")
        print("-> Network blip: the firmware resends the missed event")
        s, body, _ = self.event("missed", b["id"], b["slot"], missed_at)
        self.check(s == 200 and body.get("duplicate") is True, "resend is idempotent", body)

        sample = self.args.sample or (HERE / "samples" / "losartan.jpg")
        print(f"-> CAMERA button: scanning {Path(sample).name}")
        s, body, dt = self.scan(Path(sample))
        self.check(s == 200 and dt < 10, f"scan answered in {dt:.2f}s", (s, body))
        expected = self.args.expect or "Losartan"
        self.check(body.get("found") is True and expected.lower() in body.get("name", "").lower(),
                   f"scan identified {body.get('name')}", body)
        s, _, _ = self.event("scan_ok" if body.get("found") else "scan_unknown")
        self.check(s == 200, "scan result event accepted")

    def offline_buffer(self):
        base = ph_now().replace(second=0)
        batch = [("opened" if i % 2 == 0 else "closed", 0, (i % 5) + 1, base - timedelta(minutes=8 - i)) for i in range(8)]
        for t, d, slot, when in batch:
            s, body, _ = self.event(t, d, slot, when)
            self.check(s == 200 and "duplicate" not in body, f"buffered {t} slot {slot} stored")
        for t, d, slot, when in batch:
            s, body, _ = self.event(t, d, slot, when)
            self.check(s == 200 and body.get("duplicate") is True, f"resend {t} slot {slot} is a duplicate")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default="http://localhost:5000")
    p.add_argument("--device", default="pillbox")
    p.add_argument("--cam", default="pillbox-cam")
    p.add_argument("--email", default="demo@example.com")
    p.add_argument("--password", default="demo1234")
    p.add_argument("--sample", help="JPEG for the day scan (default samples/losartan.jpg)")
    p.add_argument("--expect", help="medicine name expected from the scan (default Losartan)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("poll")
    sub.add_parser("watch")
    e = sub.add_parser("event")
    e.add_argument("type")
    e.add_argument("dose_id", nargs="?", type=int, default=0)
    e.add_argument("--slot", type=int)
    sc = sub.add_parser("scan")
    sc.add_argument("file")
    sub.add_parser("offline-buffer")
    sub.add_parser("day")
    args = p.parse_args()
    sim = Sim(args)

    if args.cmd == "poll":
        doses, dt = sim.poll()
        print(json.dumps({"doses": doses}, indent=2))
        print(f"({dt * 1000:.0f} ms)")
    elif args.cmd == "watch":
        while True:
            doses, _ = sim.poll()
            print(f"{ph_now():%H:%M:%S} {len(doses)} doses: " + ", ".join(f"{d['time']} s{d['slot']}" for d in doses))
            time.sleep(60)
    elif args.cmd == "event":
        print(sim.event(args.type, args.dose_id, args.slot)[:2])
    elif args.cmd == "scan":
        s, body, dt = sim.scan(Path(args.file))
        print(s, json.dumps(body), f"({dt:.2f}s)")
    elif args.cmd == "offline-buffer":
        sim.offline_buffer()
    elif args.cmd == "day":
        sim.day()
    if sim.failures:
        print(f"\n{sim.failures} check(s) failed")
        sys.exit(1)
    if args.cmd in ("day", "offline-buffer"):
        print("\nAll checks passed")


if __name__ == "__main__":
    main()
