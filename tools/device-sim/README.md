# device-sim

Pretends to be the main ESP32 (`pillbox`) and the ESP32-CAM (`pillbox-cam`). It replaces the old mock. Node 22+ and nothing else to install (`sim.mjs` uses the built-in `fetch`).

```bash
make sim                                   # full-day walk-through inside Docker (against http://api:5055)
node sim.mjs --base http://localhost:5055 day
node sim.mjs poll                         # what the pillbox would show
node sim.mjs watch                        # poll every 60 s like the firmware
node sim.mjs event taken 12                # one event, time = now (PH)
node sim.mjs scan samples/losartan.jpg    # one camera scan
node sim.mjs offline-buffer               # 8 buffered events, resent (must be idempotent)
```

The `day` scenario does the following, and exits 1 if any check fails:

1. Polls the schedule.
2. Marks dose A due, then taken 3 minutes later, and checks that `qty` went down.
3. Marks dose B due, then missed 30 minutes later, and checks that the caregiver got a `missed` alert in under 5 s (it logs in as `demo@example.com`).
4. Resends the missed event and checks that it comes back as a duplicate.
5. Scans `samples/losartan.jpg` and checks that it is identified as Losartan in under 10 s. **This step needs `GEMINI_API_KEY` on the server**; without it the scan correctly answers `{"found": false}` and this one check fails.

It only picks doses that are not taken yet today. Once all of today's doses are used, run `make reset-seed`.

`samples/` holds synthetic package photos. For a meaningful scan check, replace them with real photos of your medicine boxes (`--sample <file> --expect <name>` tries any photo).
