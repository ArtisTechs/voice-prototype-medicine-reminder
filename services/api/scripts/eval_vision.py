"""Scan pipeline accuracy + timing over tests/vision_samples (make eval-vision).

Layout: tests/vision_samples/<Medicine name>/*.jpg (expected = that medicine), none/*.jpg (expected = not found).
A throwaway patient with the demo medicines and their reference photos is created inside a transaction
that is rolled back at the end. Exit code 1 if accuracy < 0.8, any wrong medicine, or max ms > budget.

    python -m scripts.eval_vision [--samples tests/vision_samples] [--min-accuracy 0.8]
"""

import argparse
import asyncio
import statistics
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core import db as core_db
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.models import Medicine, Patient
from app.repositories import medicines as med_repo
from app.seed import DEMO_MEDICINES
from app.services import reference_service
from app.vision import models, pipeline


async def run(samples: Path, min_accuracy: float) -> int:
    setup_logging("WARNING")
    s = get_settings()
    print("Loading models...", flush=True)
    await models.load_models()
    engine = core_db.get_engine()
    async with engine.connect() as conn:
        trans = await conn.begin()
        core_db.set_sessionmaker(async_sessionmaker(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"))
        async with core_db.sessionmaker()() as db:
            patient = Patient(display_name="eval")
            db.add(patient)
            await db.flush()
            meds: dict[str, Medicine] = {}
            for name, strength, slot, instr, code, expiry, qty, threshold, _times in DEMO_MEDICINES:
                m = Medicine(patient_id=patient.id, name=name, strength=strength, form="tablet", slot=slot,
                             instructions=instr, barcode=code, expiry_date=expiry, qty=qty, low_stock_threshold=threshold)
                db.add(m)
                await db.flush()
                meds[name] = m
                for img in sorted((reference_service.SEED_ASSETS / name).glob("*.jpg")):
                    await reference_service.add_photo(db, m, img.read_bytes(), img.stem, commit=False)
            await db.commit()
            candidates = [pipeline.Candidate(id=m.id, label=m.label, barcode=m.barcode, name=m.name, strength=m.strength)
                          for m in meds.values()]
            ids = [m.id for m in meds.values()]
            by_id = {m.id: n for n, m in meds.items()}

            async def lookup(vec):
                return await med_repo.nearest_references(db, ids, vec)

            rows = []
            for folder in sorted(p for p in samples.iterdir() if p.is_dir()):
                expected = None if folder.name == "none" else folder.name
                for img in sorted(folder.glob("*.jp*g")):
                    match = await pipeline.identify(img.read_bytes(), candidates, lookup)
                    got = by_id.get(match.medicine_id) if match.medicine_id else None
                    rows.append((f"{folder.name}/{img.name}", expected, got, match.method, match.score,
                                 match.timings.get("total", 0)))
        await trans.rollback()

    print(f"\n{'sample':40} {'expected':12} {'got':12} {'method':8} {'score':>6} {'ms':>6}")
    for name, exp, got, method, score, ms in rows:
        mark = "ok " if exp == got else ("WRONG" if got else "miss")
        print(f"{name:40} {exp or '-':12} {got or '-':12} {method:8} {score if score is not None else '':>6} {ms:>6}  {mark}")
    n = len(rows)
    correct = sum(1 for r in rows if r[1] == r[2])
    wrong = sum(1 for r in rows if r[2] is not None and r[1] != r[2])
    times = sorted(r[5] for r in rows)
    p95 = times[min(n - 1, int(round(0.95 * (n - 1))))] if n else 0
    accuracy = correct / n if n else 0.0
    methods = {m: sum(1 for r in rows if r[3] == m) for m in sorted({r[3] for r in rows})}
    print(f"\nsamples={n} accuracy={accuracy:.2%} wrong_medicine={wrong} not_found={n - correct - wrong}")
    print(f"ms p50={statistics.median(times) if times else 0:.0f} p95={p95} max={max(times) if times else 0} budget={s.scan_budget_seconds * 1000:.0f}")
    print(f"by method: {methods}")
    failed = accuracy < min_accuracy or wrong > 0 or (times and max(times) > s.scan_budget_seconds * 1000)
    print("RESULT:", "FAIL" if failed else "PASS")
    return 1 if failed else 0


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--samples", default=str(Path(__file__).resolve().parent.parent / "tests" / "vision_samples"))
    p.add_argument("--min-accuracy", type=float, default=0.8)
    a = p.parse_args()
    sys.exit(asyncio.run(run(Path(a.samples), a.min_accuracy)))


if __name__ == "__main__":
    main()
