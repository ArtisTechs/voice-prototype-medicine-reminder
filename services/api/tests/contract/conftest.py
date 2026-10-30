from datetime import date, time

import pytest

from tests.factories import make_medicine, make_patient, make_schedule, make_user, pair_device


@pytest.fixture
async def setup(db):
    """A caregiver, a patient, the paired `pillbox`, and three medicines (one expired, one low)."""
    user = await make_user(db)
    patient = await make_patient(db, user)
    device = await pair_device(db, patient)
    losartan = await make_medicine(db, patient, barcode="4800123456786")
    metformin = await make_medicine(
        db, patient, name="Metformin", strength="500mg", slot=2, qty=4, low_stock_threshold=6,
        instructions="With meals", barcode="4800987654328",
    )
    amlo = await make_medicine(
        db, patient, name="Amlodipine", strength="5mg", slot=3, qty=18, expiry_date=date(2026, 9, 30),
        instructions="After lunch",
    )
    s_los = await make_schedule(db, losartan, time(8, 0))
    s_met_am = await make_schedule(db, metformin, time(8, 0))
    s_met_pm = await make_schedule(db, metformin, time(20, 0))
    s_amlo = await make_schedule(db, amlo, time(13, 0))
    await db.commit()
    return {
        "user": user,
        "patient": patient,
        "device": device,
        "meds": {"losartan": losartan, "metformin": metformin, "amlodipine": amlo},
        "scheds": {"losartan": s_los, "met_am": s_met_am, "met_pm": s_met_pm, "amlodipine": s_amlo},
    }
