#!/bin/bash
#
# Resize, crop and (optionally) round-corner images for Chrome Web Store assets.
#
# Usage:
#   ./resize-promo.sh <input> <output> [width] [height] [options]
#
# Options:
#   -r, --radius <px>    圆角半径（默认 16）
#   --no-radius          不加圆角
#   --no-trim            不自动裁掉源图的透明边
#   --fit <mode>         适配模式：cover（裁剪填满，默认）| contain（完整保留+透明留白）
#
# Examples:
#   ./resize-promo.sh source.png promo.png                       # 440x280 + cover + r=16
#   ./resize-promo.sh source.png marquee.png 1400 560 -r 24      # 自定义尺寸+圆角
#   ./resize-promo.sh source.png promo.png --fit contain         # 保留完整内容
#   ./resize-promo.sh source.png promo.jpg --no-radius           # 无圆角输出 jpg
#
# Notes:
#   - 加圆角时输出会强制为 PNG（透明通道），若指定的扩展名不是 .png 会自动改为 .png
#   - 输出尺寸严格等于 WIDTH x HEIGHT
#   - 依赖：Python3 + Pillow（已自动检测安装）

set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

INPUT="$1"
OUTPUT="$2"
shift 2

WIDTH=440
HEIGHT=280
RADIUS=16
ENABLE_RADIUS=1
ENABLE_TRIM=1
FIT_MODE="cover"

# 兼容位置参数：[width] [height]
if [ $# -gt 0 ] && [[ "$1" =~ ^[0-9]+$ ]]; then
  WIDTH="$1"; shift
fi
if [ $# -gt 0 ] && [[ "$1" =~ ^[0-9]+$ ]]; then
  HEIGHT="$1"; shift
fi

while [ $# -gt 0 ]; do
  case "$1" in
    -r|--radius)
      RADIUS="$2"; ENABLE_RADIUS=1; shift 2 ;;
    --no-radius)
      ENABLE_RADIUS=0; shift ;;
    --no-trim)
      ENABLE_TRIM=0; shift ;;
    --fit)
      FIT_MODE="$2"; shift 2 ;;
    *)
      echo "❌ Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ "$FIT_MODE" != "cover" ] && [ "$FIT_MODE" != "contain" ]; then
  echo "❌ --fit 仅支持 cover | contain，得到: $FIT_MODE" >&2
  exit 1
fi

if [ ! -f "$INPUT" ]; then
  echo "❌ Input file not found: $INPUT" >&2
  exit 1
fi

# 圆角需要 PNG（透明通道），自动纠正输出扩展名
if [ "$ENABLE_RADIUS" -eq 1 ]; then
  EXT_LOWER="$(printf '%s' "${OUTPUT##*.}" | tr '[:upper:]' '[:lower:]')"
  if [ "$EXT_LOWER" != "png" ]; then
    NEW_OUTPUT="${OUTPUT%.*}.png"
    echo "ℹ️  圆角需要透明通道，输出已自动改为: $NEW_OUTPUT"
    OUTPUT="$NEW_OUTPUT"
  fi
fi

# 确保 Pillow 可用
if ! python3 -c "import PIL" >/dev/null 2>&1; then
  echo "⚠️  未检测到 Pillow，正在尝试安装..."
  python3 -m pip install --user --quiet pillow || {
    echo "❌ Pillow 安装失败，请手动执行: python3 -m pip install --user pillow" >&2
    exit 1
  }
fi

# 一次性完成 trim + resize + fit + 圆角，输出严格为 WIDTH x HEIGHT
python3 - "$INPUT" "$OUTPUT" "$WIDTH" "$HEIGHT" "$RADIUS" "$ENABLE_RADIUS" "$ENABLE_TRIM" "$FIT_MODE" <<'PY'
import sys
from PIL import Image, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
target_w = int(sys.argv[3])
target_h = int(sys.argv[4])
radius = int(sys.argv[5])
enable_radius = sys.argv[6] == "1"
enable_trim = sys.argv[7] == "1"
fit_mode = sys.argv[8]

img = Image.open(src).convert("RGBA")

# Step 1: trim 透明边
if enable_trim:
    bbox = img.getchannel("A").getbbox()
    if bbox and bbox != (0, 0, img.width, img.height):
        img = img.crop(bbox)

src_w, src_h = img.size

# Step 2: 等比缩放
if fit_mode == "cover":
    # 缩放到能完全覆盖目标尺寸的最小尺寸，再居中裁剪
    scale = max(target_w / src_w, target_h / src_h)
    new_w = round(src_w * scale)
    new_h = round(src_h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    img = img.crop((left, top, left + target_w, top + target_h))
    canvas = img
else:  # contain
    # 缩放到能完全放入目标尺寸的最大尺寸，居中放在透明画布上
    scale = min(target_w / src_w, target_h / src_h)
    new_w = round(src_w * scale)
    new_h = round(src_h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    canvas.paste(img, ((target_w - new_w) // 2, (target_h - new_h) // 2), img)

# Step 3: 圆角（4x 超采样抗锯齿）
if enable_radius and radius > 0:
    ss = 4
    mask = Image.new("L", (target_w * ss, target_h * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, target_w * ss, target_h * ss),
        radius=radius * ss,
        fill=255,
    )
    mask = mask.resize((target_w, target_h), Image.LANCZOS)
    # 把已有 alpha 与圆角 mask 相乘，保留 contain 模式下的透明留白
    existing_alpha = canvas.getchannel("A")
    combined = Image.new("L", (target_w, target_h))
    combined.paste(mask)
    # 取两者的最小值（按比例相乘更精确）
    from PIL import ImageChops
    final_alpha = ImageChops.multiply(existing_alpha, mask)
    canvas.putalpha(final_alpha)

# Step 4: 保存
ext = dst.rsplit(".", 1)[-1].lower()
if enable_radius or ext == "png":
    canvas.save(dst, "PNG", optimize=True)
else:
    # 无圆角且非 png：转 RGB 输出
    Image.alpha_composite(Image.new("RGBA", canvas.size, (255, 255, 255, 255)), canvas).convert("RGB").save(dst)

print(f"final_size={target_w}x{target_h}")
PY

EXTRA=""
if [ "$ENABLE_RADIUS" -eq 1 ]; then EXTRA=", radius=${RADIUS}px"; fi
echo "✅ Done: $OUTPUT (${WIDTH}x${HEIGHT}, fit=${FIT_MODE}${EXTRA})"
