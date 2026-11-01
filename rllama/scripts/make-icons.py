#!/usr/bin/env python3
"""Generates every Rllama icon from build/icon-source.png.

All shipped icons are PNG. Android also needs the adaptive-icon foreground PNG
(108dp canvas, mark inside the 66dp safe zone) because that is the only way the
launcher can mask the icon.

Usage: python3 scripts/make-icons.py   (requires Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon-source.png"
BG = (11, 11, 13, 255)


def mark_only() -> Image.Image:
    """Isolates the white mark on transparency, trimmed to its bounding box.

    The generated source sits on a white canvas with a dark rounded tile in the
    middle, so the tile is located first and everything outside it is ignored.
    """
    source = Image.open(SOURCE).convert("RGBA")
    pixels = source.load()
    width, height = source.size

    # 1. Find the dark tile (the icon background).
    tile = Image.new("L", source.size, 0)
    tile_pixels = tile.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            tile_pixels[x, y] = 255 if (r + g + b) < 200 else 0
    tile_box = tile.getbbox()
    if not tile_box:
        raise SystemExit("no dark tile found in the source image")

    # 2. Inset past the tile's rounded corners, so the white canvas outside the
    #    rounded square is never mistaken for the mark.
    left, top, right, bottom = tile_box
    inset = int((right - left) * 0.14)
    left, top, right, bottom = left + inset, top + inset, right - inset, bottom - inset

    # 3. Inside that window, the mark is the white part.
    mark = Image.new("RGBA", source.size, (0, 0, 0, 0))
    mask = Image.new("L", source.size, 0)
    mask_pixels = mask.load()
    for y in range(top, bottom):
        for x in range(left, right):
            r, g, b, _ = pixels[x, y]
            mask_pixels[x, y] = 255 if (r + g + b) > 380 else 0
    mark.paste((255, 255, 255, 255), mask=mask)
    mark_box = mask.getbbox()
    if not mark_box:
        raise SystemExit("no white mark found inside the tile")
    return mark.crop(mark_box)


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

    target_w = int(size * scale)
    target_h = max(1, round(mark.height * (target_w / mark.width)))
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
    save(compose(1024, 0.62), ROOT / "build" / "icon.png")
    save(compose(512, 0.62), ROOT / "build" / "icon-512.png")

    # Web / PWA / browser tab.
    save(compose(512, 0.62), ROOT / "public" / "icons" / "icon-512.png")
    save(compose(192, 0.62), ROOT / "public" / "icons" / "icon-192.png")
    save(compose(180, 0.62), ROOT / "public" / "icons" / "apple-touch-icon.png")
    save(compose(64, 0.66), ROOT / "public" / "icons" / "favicon.png")
    save(compose(32, 0.70, rounded=False), ROOT / "public" / "icons" / "favicon-32.png")

    # Android launcher (Capacitor project). Densities are 1x..4x of 48dp.
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for density, factor in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        px = int(48 * factor)
        save(compose(px, 0.62), res / f"mipmap-{density}" / "ic_launcher.png")
        save(compose(px, 0.55, rounded=False, circular=True), res / f"mipmap-{density}" / "ic_launcher_round.png")
        # Adaptive foreground: 108dp canvas, mark inside the 66dp safe zone.
        foreground = compose(int(108 * factor), 0.42, rounded=False)
        save(foreground, res / f"mipmap-{density}" / "ic_launcher_foreground.png")

    # Splash used by the Capacitor launch screen.
    save(compose(512, 0.5, rounded=False), ROOT / "android" / "app" / "src" / "main" / "res" / "drawable" / "splash.png")


if __name__ == "__main__":
    main()
