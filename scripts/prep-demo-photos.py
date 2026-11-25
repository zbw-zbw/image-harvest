#!/usr/bin/env python3
"""Crop + recompress the stock photos used by the store-screenshot demo page.

The demo page (e2e/fixtures/store-demo.html) is what Chrome Web Store and
Microsoft Edge Add-ons screenshots are captured against, so its images have
to look like a real photo site rather than placeholder colour blocks:

  * landscape crops of 1.9:1 - 2.2:1 — the panel thumbnail box is about 2.2:1
    and the image is fitted inside it, so anything squarer than ~1.9 leaves a
    wide white gutter down both sides of every card and the panel reads as
    broken layout;
  * sane file sizes — the card metadata shows width x height and byte size,
    so a 900px JPEG at ~60 KB reads like a normal web photo.

Source photos live outside the repo. Point SOURCE_DIR at wherever they are
(any JPEG set works) and edit PHOTOS if you swap them.

Usage:
    SOURCE_DIR=/tmp/photos python3 scripts/prep-demo-photos.py
"""
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.environ.get("SOURCE_DIR", "/tmp/photos")
OUT_DIR = os.path.join(REPO, "e2e", "fixtures", "demo")

# (source file, output slug, width in px, aspect w/h, focus x/y in 0..1)
#
# Aspects vary between 1.9 and 2.2 rather than being identical: all-identical
# crops make the page grid look machine-generated, and 2.2 is exactly the panel
# thumbnail box so it leaves no gutter at all. Widths differ for the same
# reason — a page where every image reports the same 900x450 makes both the
# card metadata and the Size filter ("Large 500-1000px (9)") look synthetic.
PHOTOS = [
    ("p1015.jpg", "vestfjorden", 900, 2.0, (0.50, 0.50)),
    ("p1016.jpg", "ridge-sunset", 640, 1.9, (0.50, 0.50)),
    ("p1018.jpg", "mountain-road", 480, 2.0, (0.55, 0.45)),
    ("p1039.jpg", "waterfall", 900, 2.0, (0.50, 0.45)),
    ("p1043.jpg", "valley-river", 640, 2.1, (0.50, 0.55)),
    ("p1050.jpg", "sea-cliffs", 900, 1.9, (0.50, 0.50)),
    ("p1057.jpg", "west-coast", 640, 2.2, (0.60, 0.50)),
    ("p1060.jpg", "morning-coffee", 480, 2.0, (0.55, 0.45)),
    ("p1067.jpg", "city-dusk", 900, 2.2, (0.55, 0.50)),
]

QUALITY = 78
PROGRESSIVE = True


def crop_to_aspect(im: Image.Image, aspect: float, focus: tuple[float, float]) -> Image.Image:
    w, h = im.size
    if w / h > aspect:
        # too wide — trim the sides
        new_w = int(round(h * aspect))
        cx = int(round(w * focus[0]))
        left = max(0, min(w - new_w, cx - new_w // 2))
        box = (left, 0, left + new_w, h)
    else:
        # too tall — trim top/bottom
        new_h = int(round(w / aspect))
        cy = int(round(h * focus[1]))
        top = max(0, min(h - new_h, cy - new_h // 2))
        box = (0, top, w, top + new_h)
    return im.crop(box)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for src, slug, width, aspect, focus in PHOTOS:
        src_path = os.path.join(SOURCE_DIR, src)
        im = Image.open(src_path).convert("RGB")
        im = crop_to_aspect(im, aspect, focus)
        im = im.resize((width, int(round(width / aspect))), Image.LANCZOS)
        out_path = os.path.join(OUT_DIR, f"{slug}.jpg")
        im.save(out_path, "JPEG", quality=QUALITY, progressive=PROGRESSIVE, optimize=True)
        size = os.path.getsize(out_path)
        total += size
        print(f"{slug:16s} {im.size[0]}x{im.size[1]:<5d} {size / 1024:6.1f} KB")
    print(f"{'total':16s} {'':11s} {total / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
