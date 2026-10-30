import pytest

from app.vision import barcode, embed, ocr


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (["LOSARTAN", "EXP 06/2027"], "2027-06"),
        (["Exp. Date: 12/27"], "2027-12"),
        (["EXP: 2027-03-31"], "2027-03-31"),
        (["EXPIRY 30 JUN 2027"], "2027-06-30"),
        (["EXP JUN 2027"], "2027-06"),
        (["MFG 01/2025"], None),
        (["EXP 13/2027"], None),
    ],
)
def test_parse_expiry(lines, expected):
    assert ocr.parse_expiry(lines) == expected


CANDS = [(1, "Losartan", "50mg"), (2, "Metformin", "500mg"), (3, "Amlodipine", "5mg")]


def test_ocr_scoring_picks_name_and_strength():
    scores = ocr.score_candidates(["LOSARTAN", "50 mg", "EXP 06/2027"], CANDS)
    best = ocr.pick(scores, 80, 8)
    assert best and best.medicine_id == 1


def test_ocr_unknown_text_is_not_matched():
    scores = ocr.score_candidates(["CETIRIZINE", "10mg"], CANDS)
    assert ocr.pick(scores, 80, 8) is None


def test_ocr_ambiguous_needs_margin():
    scores = [ocr.TextScore(1, 90), ocr.TextScore(2, 86)]
    assert ocr.pick(scores, 80, 8) is None


def test_embed_pick_threshold_and_margin():
    assert embed.pick([(1, 0.95), (1, 0.9), (2, 0.6)], 0.85, 0.03) == (1, 0.95)
    assert embed.pick([(1, 0.80), (2, 0.6)], 0.85, 0.03) is None
    assert embed.pick([(1, 0.91), (2, 0.90)], 0.85, 0.03) is None


@pytest.mark.parametrize(
    ("a", "b"), [("4800123456786", "04800123456786"), ("012345678905", "12345678905"), ("abc-1", "ABC-1")]
)
def test_barcode_normalize(a, b):
    assert barcode.normalize(a) == barcode.normalize(b)
