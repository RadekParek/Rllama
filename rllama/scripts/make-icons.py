#!/usr/bin/env python3
"""Generates every Rllama icon from build/icon-source.png.

All shipped icons are PNG. Android also needs the adaptive-icon foreground PNG
(108dp canvas, mark inside the 66dp safe zone) because that is the only way the
launcher can mask the icon.

The source is a front-facing llama head: a near-black mark on a white canvas.
`mark_only()` therefore reads *dark* pixels; flip POLARITY if the artwork ever
goes back to a light mark on a dark tile.

Usage: python3 scripts/make-icons.py   (requires Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon-source.png"

# White tile, near-black llama. Keep these two in step with the source art.
BG = (255, 255, 255, 255)
MARK = (11, 11, 13, 255)
DARK_MARK = True


def mark_only() -> Image.Image:
    """Isolates the llama mark on transparency, trimmed to its bounding box."""
    source = Image.open(SOURCE).convert("RGBA")
    pixels = source.load()
    width, height = source.size

    mask = Image.new("L", source.size, 0)
    mask_pixels = mask.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            dark = (r + g + b) < 240
            mask_pixels[x, y] = 255 if (dark == DARK_MARK) else 0

    box = mask.getbbox()
    if not box:
        raise SystemExit("no mark found in the source image")

    mark = Image.new("RGBA", source.size, (0, 0, 0, 0))
    mark.paste(MARK, mask=mask)
    return mark.crop(box)


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
    canvas.alpha_composite(resized, ((size - target_w) // 2, (size - target_h) // 2))
    return canvas


def save(image: Image.Image, *paths: Path) -> None:
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, "PNG", optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


def main() -> None:
    # Desktop packaging (electron-builder wants >= 512, square).
    save(compose(1024, 0.66), ROOT / "build" / "icon.png")
    save(compose(512, 0.66), ROOT / "build" / "icon-512.png")

    # Web / PWA / browser tab.
    save(compose(512, 0.66), ROOT / "public" / "icons" / "icon-512.png")
    save(compose(192, 0.66), ROOT / "public" / "icons" / "icon-192.png")
    save(compose(180, 0.66), ROOT / "public" / "icons" / "apple-touch-icon.png")
    save(compose(64, 0.72), ROOT / "public" / "icons" / "favicon.png")
    save(compose(32, 0.78, rounded=False), ROOT / "public" / "icons" / "favicon-32.png")

    # Android launcher (Capacitor project). Densities are 1x..4x of 48dp.
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for density, factor in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        px = int(48 * factor)
        save(compose(px, 0.70), res / f"mipmap-{density}" / "ic_launcher.png")
        save(compose(px, 0.58, rounded=False, circular=True), res / f"mipmap-{density}" / "ic_launcher_round.png")
        # Adaptive foreground: 108dp canvas, mark inside the 66dp safe zone.
        save(compose(int(108 * factor), 0.46, rounded=False), res / f"mipmap-{density}" / "ic_launcher_foreground.png")

    # Splash used by the Capacitor launch screen: white plate, dark mark.
    save(compose(512, 0.56, rounded=False), res / "drawable" / "splash.png")


if __name__ == "__main__":
    main()
