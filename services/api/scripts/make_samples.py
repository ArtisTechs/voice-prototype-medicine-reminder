"""Generate synthetic package photos for the demo (run inside the api container):

    python -m scripts.make_samples [--out-root /srv] [--sim-dir /sim/samples]

Writes:
  app/seed_assets/<Medicine>/{front,back,side}.jpg     reference photos used by the seed
  tests/vision_samples/<Medicine>/*.jpg                 eval set (barcode, text-only, blurry, rotated)
  tests/vision_samples/none/*.jpg                       packages that are not registered
  ../../tools/device-sim/samples/*.jpg                  what the simulator "photographs"
Replace or extend these with real camera photos for real accuracy numbers."""

import argparse
from pathlib import Path

from app.seed import DEMO_MEDICINES
from PIL import ImageFilter

from tests.imaging import jpeg, package

COLORS = {"Losartan": (40, 110, 180), "Metformin": (200, 70, 40), "Amlodipine": (60, 150, 80)}
UNKNOWN = [("Cetirizine", "10mg", (150, 60, 160), "4800777000014"), ("Paracetamol", "500mg", (220, 170, 30), None)]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out-root", default=".")
    p.add_argument("--sim-dir", default="../../tools/device-sim/samples")
    args = p.parse_args()
    root, sim_dir = Path(args.out_root), Path(args.sim_dir)
    written = 0

    def save(path: Path, img) -> None:
        nonlocal written
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(jpeg(img))
        written += 1

    for name, strength, _slot, _instr, code, *_ in DEMO_MEDICINES:
        color = COLORS[name]
        refs = root / "app" / "seed_assets" / name
        save(refs / "front.jpg", package(name, strength, code=None, color=color, seed=1))
        save(refs / "back.jpg", package(name, strength, code=code, color=color, seed=2, angle=4))
        save(refs / "side.jpg", package(name, strength, code=None, color=color, seed=3, angle=-6, size=(900, 700)))

        evald = root / "tests" / "vision_samples" / name
        save(evald / "barcode.jpg", package(name, strength, code=code, color=color, seed=11))
        save(evald / "text_only.jpg", package(name, strength, code=None, color=color, seed=12, angle=3))
        save(evald / "rotated.jpg", package(name, strength, code=code, color=color, seed=13, angle=90))
        # Out of focus: barcode and text unreadable, the package design still recognisable (embedding stage).
        blurry = package(name, strength, code=code, color=color, seed=14, angle=-3).filter(ImageFilter.GaussianBlur(7))
        save(evald / "blurry.jpg", blurry)

        save(sim_dir / f"{name.lower()}.jpg", package(name, strength, code=code, color=color, seed=21, angle=2))

    for name, strength, color, code in UNKNOWN:
        save(root / "tests" / "vision_samples" / "none" / f"{name.lower()}.jpg",
             package(name, strength, code=code, color=color, seed=31))
    save(sim_dir / "unknown.jpg", package("Cetirizine", "10mg", code="4800777000014", color=(150, 60, 160), seed=41))
    print(f"wrote {written} images")


if __name__ == "__main__":
    main()
