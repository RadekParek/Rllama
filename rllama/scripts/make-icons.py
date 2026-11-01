#!/usr/bin/env python3
"""Generates every Rllama icon from assets/icon-source.png.

The source is the owner's own line-art llama: black strokes on white, portrait
format (head plus body). Only the head is used for the icon, so the crop keeps
the top of the artwork.

All shipped icons are PNG. Android additionally needs the adaptive-icon
foreground (108dp canvas, mark inside the 66dp safe zone) because that is the
only way the launcher can mask the icon.

Layout note: icons live in assets/, not build/ — the repository ignores `build`
entries, which silently dropped earlier icon files from git.

Usage: python3 scripts/make-icons.py   (requires Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "icon-source.png"

# The artwork is a head over a body; keep the head plus a little neck.
HEAD_CROP = 0.70
# White plate, near-black ink.
BG = (255, 255, 255, 255)
INK = (13, 13, 15, 255)


def mark_only() -> Image.Image:
    """Isolates the ink on transparency, trimmed to its bounding box."""
    source = Image.open(SOURCE).convert("RGBA")
    width, height = source.size
    source = source.crop((0, 0, width, int(height * HEAD_CROP)))

    mask = Image.new("L", source.size, 0)
    src = source.load()
    dst = mask.load()
    for y in range(source.height):
        for x in range(source.width):
            r, g, b, _ = src[x, y]
            dst[x, y] = 255 if (r + g + b) < 300 else 0

    box = mask.getbbox()
    if not box:
        raise SystemExit("no ink found in the source image")

    pad = int(max(mask.width, mask.height) * 0.01)
    box = (
        max(0, box[0] - pad),
        max(0, box[1] - pad),
        min(mask.width, box[2] + pad),
        min(mask.height, box[3] + pad),
    )
    mask = mask.crop(box)

    mark = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    mark.paste(INK, mask=mask)
    return mark


def compose(size: int, scale: float, rounded: bool = True, circular: bool = False) -> Image.Image:
    mark = mark_only()
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    if circular:
        draw.ellipse([0, 0, size - 1, size - 1], fill=BG)
    elif rounded:
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)
    else:
        draw.rectangle([0, 0, size - 1, size - 1], fill=BG)

    # Fit inside a square box: scaling by width alone crops tall marks.
    box = size * scale
    target_w = int(box)
    target_h = max(1, round(mark.height * (target_w / mark.width)))
    if target_h > box:
        target_h = int(box)
        target_w = max(1, round(mark.width * (target_h / mark.height)))
    resized = mark.resize((target_w, target_h), Image.LANCZOS)

    # Thin line art fades out when scaled down; lift the alpha so strokes stay
    # solid at launcher sizes.
    if size <= 96:
        alpha = resized.getchannel("A").point(lambda value: min(255, int(value * 1.9)))
        resized.putalpha(alpha)

    canvas.alpha_composite(resized, ((size - target_w) // 2, (size - target_h) // 2))
    return canvas


def save(image: Image.Image, *paths: Path) -> None:
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, "PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


def main() -> None:
    # Desktop packaging (electron-builder wants >= 512, square).
    save(compose(1024, 0.86), ROOT / "assets" / "icon.png")
    save(compose(512, 0.86), ROOT / "assets" / "icon-512.png")

    # Web / PWA / browser tab.
    save(compose(512, 0.86), ROOT / "public" / "icons" / "icon-512.png")
    save(compose(192, 0.86), ROOT / "public" / "icons" / "icon-192.png")
    save(compose(180, 0.86), ROOT / "public" / "icons" / "apple-touch-icon.png")
    save(compose(64, 0.90), ROOT / "public" / "icons" / "favicon.png")
    save(compose(32, 0.94, rounded=False), ROOT / "public" / "icons" / "favicon-32.png")

    # Android launcher (Capacitor project). Densities are 1x..4x of 48dp.
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for density, factor in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        px = int(48 * factor)
        save(compose(px, 0.88), res / f"mipmap-{density}" / "ic_launcher.png")
        save(compose(px, 0.74, rounded=False, circular=True), res / f"mipmap-{density}" / "ic_launcher_round.png")
        # Adaptive foreground: 108dp canvas, mark inside the 66dp safe zone.
        save(compose(int(108 * factor), 0.56, rounded=False), res / f"mipmap-{density}" / "ic_launcher_foreground.png")

    # Splash used by the Capacitor launch screen: white plate, ink mark.
    save(compose(512, 0.62, rounded=False), res / "drawable" / "splash.png")


if __name__ == "__main__":
    main()
