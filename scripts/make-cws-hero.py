"""Compose the store artwork: the 1280x800 hero and the two promo tiles.

The hero used to be a flat green card with an abstract 3x3 grid. At 275x175 in
store search that grid reads as decoration, not as a product, and a flat fill
looks synthetic next to the gradient tiles already in assets/promo. It is now
a real side-panel capture on the branded gradient: the first screenshot has to
answer "what does this do" before anyone reads the description.

All three images share one gradient, one palette and one typeface so the small
tile, the large tile and the first screenshot cannot drift apart. The colours
are the extension's own --primary-color / --primary-hover from css/variables.css,
which is also what the panel itself renders with.

Rules that survived review:
- Text sits on the dark end of the gradient. White on #60b557 is 2.6:1.
- The capture is the real 600x800 panel, cropped out of the batch-select shot,
  rounded and shadowed so it reads as a surface above the green instead of a
  pasted rectangle.
- No abstract UI, no fake browser chrome, no second accent colour.

Usage: python3 scripts/make-cws-hero.py
Requires Pillow + numpy. Typeface is Avenir Next, present on macOS; on another
host point BOLD / REG at any geometric sans.

Grain and the capture make these PNGs large (hero lands near 1.3 MB). Run
`oxipng -o4 --strip safe` on the three outputs before uploading; it is lossless
and takes the hero under 1.25 MB, well inside the store's 2 MB cap.
"""
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "assets/screenshots"
PROMO = ROOT / "assets/promo"

BOLD = ("/System/Library/Fonts/Avenir Next.ttc", 0)
REG = ("/System/Library/Fonts/Avenir Next.ttc", 7)

DARK = (42, 131, 35)  # #2a8323, --primary-color
LIGHT = (124, 201, 117)  # #7cc975, the dark-mode primary; also the light end here
MINT = (200, 240, 180)
WHITE = (255, 255, 255)
SUB = (226, 245, 218)

# The panel half of every 1280x800 store screenshot: the capture is 680px of
# page plus 600px of panel, so the panel always starts at x=680.
PANEL_CROP = (680, 0, 1280, 800)
PANEL_SRC = SCREENS / "batch-select-1280.png"


def font(spec, size):
    path, index = spec
    return ImageFont.truetype(path, size, index=index)


def fit_size(draw, lines, spec, max_w, hi, lo):
    """Largest size at which every line fits the column."""
    for size in range(hi, lo, -1):
        f = font(spec, size)
        if all(draw.textlength(line, font=f) <= max_w for line in lines):
            return size
    return lo


def backdrop(w, h):
    """Brand gradient, a slight vignette, a little grain.

    The grain is what separates this from a flat template fill; 2 grey levels
    of noise is invisible on a thumbnail but stops the gradient banding at
    full size. The vignette keeps the corners from looking printed.
    """
    yy, xx = np.mgrid[0:h, 0:w]
    t = (xx / (w - 1)) * 0.78 + (yy / (h - 1)) * 0.22
    # Gamma on the ramp keeps the left half on the dark end. A straight lerp
    # between two greens this close reads as a flat fill on a thumbnail.
    t = np.clip(t, 0.0, 1.0)[..., None] ** 1.30

    start, end = np.array(DARK, float), np.array(LIGHT, float)
    rgb = start + (end - start) * t

    dx = (xx - w / 2) / (w / 2)
    dy = (yy - h / 2) / (h / 2)
    edge = (dx * dx + dy * dy) / 2.0
    rgb = rgb - edge[..., None] ** 1.4 * 14

    rng = np.random.default_rng(7)
    rgb = rgb + rng.normal(0.0, 2.0, rgb.shape)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def panel_capture(w, h, crop=PANEL_CROP):
    shot = Image.open(PANEL_SRC).convert("RGB").crop(crop)
    return shot.resize((w, h), Image.LANCZOS).convert("RGBA")


def paste_panel(canvas, x, y, w, h, radius=20, crop=PANEL_CROP, shadow_offset=(0, 12)):
    shot = panel_capture(w, h, crop)
    mask = Image.new("L", (w, h), 0)
    box = ImageDraw.Draw(mask)
    if radius:
        box.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    else:
        box.rectangle([0, 0, w - 1, h - 1], fill=255)

    sx, sy = shadow_offset
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [x + sx, y + sy, x + w - 1 + sx, y + h - 1 + sy], radius=radius, fill=(0, 0, 0, 120)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))
    canvas.paste(shot, (x, y), mask)

    edge = ImageDraw.Draw(canvas)
    edge.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius,
                           outline=(255, 255, 255, 34), width=1)
    return canvas


def icon_mark(canvas, x, y, side):
    """The app icon, cropped to its alpha bbox before scaling.

    The source PNG carries 37-42px of transparent padding on every side, so
    pasting it un-cropped leaves the artwork visually off-centre. No white
    plate: the icon already has its own light rim, and a plate behind it reads
    as a sticker.
    """
    icon = Image.open(PROMO / "icon-300.png").convert("RGBA")
    icon = icon.crop(icon.getchannel("A").getbbox()).resize((side, side), Image.LANCZOS)
    canvas.paste(icon, (x, y), icon)
    return side


def pill(draw, x, baseline, text, size=22, pad_x=22, pad_y=13):
    """White pill with brand-green text.

    A translucent white pill over light green left the label at about 1.2:1 in
    the first pass: pale text on a pale wash. Solid white and #1f5c1a is the
    only version that stays legible over every part of the gradient.
    """
    f = font(BOLD, size)
    w = draw.textlength(text, font=f)
    top = baseline - size
    draw.rounded_rectangle([x, top - pad_y, x + w + pad_x * 2, baseline + pad_y + size * 0.18],
                           radius=(pad_y * 2 + size) // 2, fill=(255, 255, 255, 238))
    draw.text((x + pad_x, baseline), text, font=f, fill=(31, 92, 26), anchor="ls")


def write_hero(path):
    W, H = 1280, 800
    canvas = backdrop(W, H)
    draw = ImageDraw.Draw(canvas)

    # Panel: 0.94 of its native pixels, inset 24px on three sides so all four
    # corners stay visible. The right-hand gutter is what keeps it from looking
    # like a crop that ran off the canvas.
    pw, ph = 564, 752
    px, py = W - pw - 24, 24
    paste_panel(canvas, px, py, pw, ph)

    col = 88
    col_w = px - 56 - col

    plate = icon_mark(canvas, col, 88, 96)
    draw = ImageDraw.Draw(canvas)
    draw.text((col + plate + 24, 88 + plate / 2), "Image Harvest",
              font=font(BOLD, 34), fill=WHITE, anchor="lm")

    lines = ["Batch download", "every image", "on a page."]
    size = fit_size(draw, lines, BOLD, col_w, 72, 44)
    line = round(size * 1.16)
    base = 316
    for i, text in enumerate(lines):
        draw.text((col, base + i * line), text,
                  font=font(BOLD, size), fill=MINT if i == 2 else WHITE, anchor="ls")

    sub_base = base + 2 * line + 78
    for i, text in enumerate(["Select what you want,", "save it all as one ZIP."]):
        draw.text((col, sub_base + i * 38), text, font=font(REG, 27), fill=SUB, anchor="ls")

    pill(draw, col, sub_base + 38 + 62, "Free  ·  Chrome & Edge")

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(path, "PNG")
    print("wrote", os.path.relpath(path, ROOT), (W, H), "title", size)


def write_small(path):
    W, H = 440, 280
    canvas = backdrop(W, H)
    draw = ImageDraw.Draw(canvas)

    # 440x280 is a third of the hero's height, so the same lockup at hero scale
    # left the tile two-thirds empty. The icon now takes half the height, and
    # both halves are centred on the same horizontal line (y=140): icon spans
    # 68-212, the four text rows span 76-204. Margins land at 28/35 left-right
    # and 68/68 top-bottom, so no side looks emptier than another.
    # Brand 30 and tagline 18 are the largest sizes whose widest line still
    # clears a 216px column.
    plate = icon_mark(canvas, 28, 68, 144)
    draw = ImageDraw.Draw(canvas)

    tx = 28 + plate + 20
    draw.text((tx, 97), "Image Harvest", font=font(BOLD, 30), fill=WHITE, anchor="ls")
    draw.text((tx, 129), "Batch download", font=font(BOLD, 18), fill=WHITE, anchor="ls")
    draw.text((tx, 153), "every image on a page.", font=font(BOLD, 18), fill=WHITE, anchor="ls")
    pill(draw, tx, 193, "Free  ·  Chrome & Edge", size=14, pad_x=16, pad_y=9)

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(path, "PNG")
    print("wrote", os.path.relpath(path, ROOT), (W, H))


def write_top(path):
    W, H = 1400, 560
    canvas = backdrop(W, H)
    draw = ImageDraw.Draw(canvas)

    # The panel bleeds off the top, right and bottom edges. Cutting at y=136 is
    # the card grid's first row: everything above it is the toolbar and filter
    # row, and a cut anywhere inside those two left half-drawn labels sitting on
    # the banner's top edge (y=60 did exactly that). Dropping both rows makes the
    # capture 600x664 instead of 600x800, which at 560 tall is 506 wide -- 28%
    # wider than the 396px the first pass used and 11% wider than 454.
    pw, ph = 506, 560
    px, py = W - pw, 0
    paste_panel(canvas, px, py, pw, ph, radius=0, crop=(680, 136, 1280, 800),
                shadow_offset=(-14, 0))
    draw = ImageDraw.Draw(canvas)

    col = 64
    col_w = px - 56 - col

    plate = icon_mark(canvas, col, 84, 96)
    draw = ImageDraw.Draw(canvas)
    draw.text((col + plate + 26, 84 + plate / 2), "Image Harvest",
              font=font(BOLD, 42), fill=WHITE, anchor="lm")

    # Two lines instead of three: "Batch download" alone left 100px of dead ramp
    # between the copy and the panel, which is what made the banner look split.
    # At 768px of column the fit lands on 68px, and the longest line stops 59px
    # short of the panel -- close enough that the two halves read as one block.
    lines = ["Download every image", "on a page at once."]
    size = fit_size(draw, lines, BOLD, col_w, 76, 48)
    line = round(size * 1.16)
    base = 302
    for i, text in enumerate(lines):
        draw.text((col, base + i * line), text,
                  font=font(BOLD, size), fill=MINT if i == 1 else WHITE, anchor="ls")

    pill(draw, col, base + line + 78, "Select a few. Save one ZIP.", size=24)

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(path, "PNG")
    print("wrote", os.path.relpath(path, ROOT), (W, H), "title", size)


if __name__ == "__main__":
    write_hero(SCREENS / "hero-1280.png")
    write_small(PROMO / "small-new.png")
    write_top(PROMO / "top-new.png")
