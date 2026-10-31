"""Draw the VOICE app icon (speech bubble holding a capsule) and write every size Expo needs.

Run from the repo root:  python tools/icons/make_icons.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "apps" / "mobile" / "assets"
SS = 4  # supersampling factor for smooth edges

BLUE_TOP = (61, 94, 240)  # gradient over the brand primary #2E4FD8
BLUE_BOTTOM = (35, 64, 192)
PRIMARY = (46, 79, 216)
ACCENT = (10, 107, 92)
WHITE = (255, 255, 255)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BLUE_TOP, BLUE_BOTTOM)) + (255,))
    return img


def capsule(length: int, thick: int, mono: bool) -> Image.Image:
    """A horizontal two-tone capsule; rotated by the caller."""
    img = Image.new("RGBA", (length, thick), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = thick // 2
    if mono:  # punched out of the white bubble
        d.rounded_rectangle([0, 0, length - 1, thick - 1], radius=r, fill=(0, 0, 0, 255))
        d.rectangle([length // 2 - thick // 14, 0, length // 2 + thick // 14, thick], fill=(0, 0, 0, 0))
        return img
    left = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(left).rounded_rectangle([0, 0, length - 1, thick - 1], radius=r, fill=PRIMARY + (255,))
    right = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(right).rounded_rectangle([0, 0, length - 1, thick - 1], radius=r, fill=ACCENT + (255,))
    img.paste(left.crop((0, 0, length // 2, thick)), (0, 0))
    img.paste(right.crop((length // 2, 0, length, thick)), (length // 2, 0))
    # soft shine on the blue half
    ImageDraw.Draw(img).rounded_rectangle(
        [thick // 3, thick // 5, length // 2 - thick // 6, thick // 5 + thick // 7], radius=thick // 14, fill=(255, 255, 255, 90)
    )
    return img


def mark(size: int, scale: float = 1.0, mono: bool = False) -> Image.Image:
    """The bubble + capsule on a transparent square; scale shrinks it about the centre."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    u = n / 1024 * scale  # design units are a 1024 grid
    cx = cy = n / 2

    def p(x: float, y: float) -> tuple[float, float]:
        return (cx + (x - 512) * u, cy + (y - 512) * u)

    d = ImageDraw.Draw(img)
    (x0, y0), (x1, y1) = p(200, 220), p(824, 720)
    d.rounded_rectangle([x0, y0, x1, y1], radius=170 * u, fill=WHITE + (255,))
    d.polygon([p(300, 680), p(262, 838), p(450, 700)], fill=WHITE + (255,))

    cap = capsule(round(430 * u), round(160 * u), mono).rotate(35, resample=Image.BICUBIC, expand=True)
    pos = (round(p(512, 470)[0] - cap.width / 2), round(p(512, 470)[1] - cap.height / 2))
    if mono:
        hole = Image.new("L", img.size, 0)
        hole.paste(cap.getchannel("A"), pos)
        alpha = img.getchannel("A")
        img.putalpha(Image.composite(Image.new("L", img.size, 0), alpha, hole))
    else:
        img.alpha_composite(cap, pos)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    icon = gradient(1024)
    icon.alpha_composite(mark(1024))
    icon.convert("RGB").save(OUT / "icon.png")  # iOS rejects alpha in the app icon

    mark(1024, 0.9).save(OUT / "splash-icon.png")
    mark(512, 0.62).save(OUT / "android-icon-foreground.png")  # stays inside the adaptive-icon safe zone
    gradient(512).save(OUT / "android-icon-background.png")
    mark(432, 0.62, mono=True).save(OUT / "android-icon-monochrome.png")

    fav = gradient(48 * SS)
    fav.alpha_composite(mark(48 * SS))
    fav.resize((48, 48), Image.LANCZOS).save(OUT / "favicon.png")
    print("wrote icons to", OUT)


if __name__ == "__main__":
    main()
