"""Compose the 1280x800 Chrome Web Store hero image.

Why this is a brand card and not a UI screenshot: the store renders the first
screenshot at 275x175 inside search results. A side-panel capture - toolbar,
filter row, thumbnails, action bar - collapses into grey mush at that size,
while every top-ranked competitor (Imageye, picture-and-photos saver) ships a
brand card there.

Layout rules learned the hard way:
- No bleed. Content stays inside a 96px margin on all four sides; a grid that
  runs past the edge reads as a cropping bug, not as a design.
- The source icon carries 37-42px of transparent padding on every side, so it
  must be cropped to its alpha bbox before scaling, otherwise it sits off
  centre inside its tile and looks small.
- Flat brand green. A diagonal two-stop gradient across a dark green reads as
  muddy at large sizes, and it leaves the light green artwork with no edge.

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
MARGIN = 96
ROOT = Path(__file__).resolve().parent.parent
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
ICON = ROOT / "assets/promo/icon-300.png"
OUT = ROOT / "assets/screenshots/hero-1280.png"

BG = (42, 131, 35)  # #2a8323, the install-badge brand green
MINT = (173, 227, 154)

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img, "RGBA")

# Right-hand grid, fully inside the margin: the last column must land exactly
# on the 96px guide, never past it.
CELL, GAP = 109, 18
COL = 3 * CELL + 2 * GAP  # 363
gx = W - MARGIN - COL  # 821
gy = (H - COL) // 2  # 218
selected = {(0, 0), (1, 0), (2, 0), (0, 1), (1, 2)}
for r in range(3):
    for c in range(3):
        x = gx + c * (CELL + GAP)
        y = gy + r * (CELL + GAP)
        fill = MINT + (255,) if (r, c) in selected else (0, 0, 0, 34)
        draw.rounded_rectangle([x, y, x + CELL, y + CELL], radius=15, fill=fill)

# Icon: crop the transparent padding first, then sit it on a white plate.
# Two separate problems, both visible only when composed against green:
# skipping the crop leaves it visually off-centre, and pasting the bare
# artwork drops a light green-on-green shape with no edge. The plate radius
# is the icon's own radius plus the padding, so the white ring stays even.
icon = Image.open(ICON).convert("RGBA")
icon = icon.crop(icon.getchannel("A").getbbox())
side, pad = 136, 12
icon = icon.resize((side, side), Image.LANCZOS)
plate = side + pad * 2
ImageDraw.Draw(img).rounded_rectangle(
    [MARGIN, 72, MARGIN + plate, 72 + plate], radius=44, fill=(255, 255, 255, 255)
)
img.paste(icon, (MARGIN + pad, 72 + pad), icon)

title = ImageFont.truetype(BOLD, 84)
sub = ImageFont.truetype(REG, 34)
tail = ImageFont.truetype(BOLD, 30)

# 84px keeps the headline legible at 275px wide (about 18px there).
lines = [("Batch download", (255, 255, 255, 255)),
         ("every image", (255, 255, 255, 255)),
         ("on a page.", MINT + (255,))]
y = 286
for text, fill in lines:
    draw.text((MARGIN, y), text, font=title, fill=fill)
    y += 100

draw.text((MARGIN, 632), "Select what you want, save it all as one ZIP.",
          font=sub, fill=(214, 240, 206, 255))
draw.text((MARGIN, 698), "Free  ·  Chrome & Edge", font=tail, fill=MINT + (255,))

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG")
print("wrote", os.path.relpath(OUT, ROOT), img.size)
