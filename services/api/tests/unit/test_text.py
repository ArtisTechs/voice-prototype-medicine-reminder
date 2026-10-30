import pytest

from app.core.text import fit, to_ascii


@pytest.mark.parametrize(
    ("value", "limit", "expected"),
    [
        ("Losartan 50mg", 23, "Losartan 50mg"),
        ("A" * 23, 23, "A" * 23),
        ("A" * 24, 23, "A" * 23),
        ("Hydrochlorothiazide Extended Release 12.5mg", 23, "Hydrochlorothiazide"),
        ("After breakfast, with water, do not crush", 39, "After breakfast, with water, do not"),
        ("Supercalifragilisticexpialidocious pills", 23, "Supercalifragilisticexp"),
        ("", 10, ""),
        (None, 10, ""),
        ("  many   spaces  ", 20, "many spaces"),
        ("Señora’s – dose", 20, "Senora's - dose"),
        ("日本語 tablet", 15, "tablet"),
        ("Take, then:", 6, "Take"),
    ],
)
def test_fit(value, limit, expected):
    out = fit(value, limit)
    assert out == expected
    assert len(out) <= limit
    assert out.isascii()


def test_to_ascii_strips_control_chars():
    assert to_ascii("a\x00b\tc") == "abc"
