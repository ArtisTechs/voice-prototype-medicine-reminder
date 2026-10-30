# device-sim

Pretends to be the main ESP32 (`pillbox`) and the ESP32-CAM (`pillbox-cam`). It replaces the old mock. Python 3.10+ with the standard library only.

```bash
make sim                                   # full-day walk-through inside Docker (against http://api:5000)
python sim.py --base http://localhost:5000 day
python sim.py poll                         # what the pillbox would show
python sim.py watch                        # poll every 60 s like the firmware
python sim.py event taken 12 --slot 1      # one event, time = now (PH)
python sim.py scan samples/losartan.jpg    # one camera scan
python sim.py offline-buffer               # 8 buffered events, resent (must be idempotent)
```

The `day` scenario does the following, and exits 1 if any check fails:

1. Polls the schedule.
2. Marks dose A due, then taken 3 minutes later, and checks that `qty` went down.
3. Marks dose B due, then missed 30 minutes later, and checks that the caregiver got a `missed` alert in under 5 s (it logs in as `demo@example.com`).
4. Resends the missed event and checks that it comes back as a duplicate.
5. Scans `samples/losartan.jpg` and checks that it is identified as Losartan in under 10 s.

It only picks doses that are not taken yet today. Once all of today's doses are used, run `make reset-seed`.

`samples/` holds synthetic package photos made by `services/api/scripts/make_samples.py`.
