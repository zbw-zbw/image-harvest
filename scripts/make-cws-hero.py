"""Compose the 1280x800 Chrome Web Store hero image.

Why this is a brand card and not a UI screenshot: the store renders the first
screenshot at 275x175 inside search results. A side-panel capture - toolbar,
filter row, thumbnails, action bar - collapses into grey mush at that size,
while every top-ranked competitor (Imageye, picture-and-photos saver) ships a
brand card there. The thirteen real feature captures stay in slots 2-14, where
they are only seen after someone opens the detail page.

The abstract grid is not a fake UI: no window chrome, no controls, no labels.
It reads as "many images, some picked" even at 275px wide.

Usage: python3 scripts/make-cws-hero.py
Requires Pillow. Fonts are the macOS system Arial; on other hosts point
BOLD/REG at any heavy/regular sans.
"""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 800
ROOT = Path(__file__).resolve().parent.parent
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
ICON = ROOT / "assets/promo/icon-300.png"
OUT = ROOT / "assets/screenshots/hero-1280.png"

# Brand green from the install badge (#2a8323), walked darker for contrast.
TOP = (15, 61, 21)
BOTTOM = (42, 131, 35)
MINT = (173, 227, 154)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


img = Image.new("RGB", (W, H), BOTTOM)
px = img.load()
for y in range(H):
    for x in range(W):
        px[x, y] = lerp(TOP, BOTTOM, x / W * 0.45 + y / H * 0.55)

draw = ImageDraw.Draw(img, "RGBA")

# Abstract "many images, some selected" grid. Runs slightly past the right
# edge so the layout does not read as a column of centred blocks.
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grid)
CELL, GAP = 120, 22
gx, gy = 906, 176
selected = {(0, 0), (1, 0), (2, 0), (0, 1), (1, 2)}
for r in range(3):
    for c in range(3):
        x = gx + c * (CELL + GAP)
        y = gy + r * (CELL + GAP)
        box = [x, y, x + CELL, y + CELL]
        fill = MINT + (205,) if (r, c) in selected else (255, 255, 255, 38)
        gd.rounded_rectangle(box, radius=16, fill=fill)
img.paste(Image.alpha_composite(img.convert("RGBA"), grid).convert("RGB"), (0, 0))

# App icon in a rounded white tile, matching how the store shows the icon.
icon = Image.open(ICON).convert("RGBA").resize((136, 136), Image.LANCZOS)
tile = Image.new("RGBA", (136, 136), (0, 0, 0, 0))
ImageDraw.Draw(tile).rounded_rectangle([0, 0, 135, 135], radius=30,
                                       fill=(255, 255, 255, 255))
tile.alpha_composite(icon, (10, 10))
img.paste(tile, (96, 84), tile)

title = ImageFont.truetype(BOLD, 92)
sub = ImageFont.truetype(REG, 36)
tail = ImageFont.truetype(BOLD, 34)

# 92px keeps the headline legible at 275px wide (about 20px there); anything
# smaller turns into grey lines in the search result.
lines = [("Batch download", (255, 255, 255, 255)),
         ("every image", (255, 255, 255, 255)),
         ("on a page.", MINT + (255,))]
y = 268
for text, fill in lines:
    draw.text((96, y), text, font=title, fill=fill)
    y += 108

draw.text((96, 632), "Select what you want, save it all as one ZIP.",
          font=sub, fill=(205, 236, 196, 255))
draw.text((96, 700), "Free  ·  Chrome & Edge", font=tail, fill=MINT + (255,))

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG")
print("wrote", os.path.relpath(OUT, ROOT), img.size)
