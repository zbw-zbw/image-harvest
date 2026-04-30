#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ICONS_DIR="$PROJECT_ROOT/icons"
WEBSITE_PUBLIC="$PROJECT_ROOT/website/public"

SOURCE="${1:-}"
if [ -z "$SOURCE" ]; then
  if [ -f "$ICONS_DIR/logo.png" ]; then
    SOURCE="$ICONS_DIR/logo.png"
  elif [ -f "$ICONS_DIR/logo.jpg" ]; then
    SOURCE="$ICONS_DIR/logo.jpg"
    echo "Warning: JPG source - transparency will be lost. Use PNG for transparent icons."
  else
    echo "No source image found. Place your icon at icons/logo.png"
    exit 1
  fi
fi

if [ ! -f "$SOURCE" ]; then
  echo "Source image not found: $SOURCE"
  exit 1
fi

echo "Image Snatcher Icon Sync"
echo "================================================="
echo "Source: $SOURCE"

SOURCE_WIDTH=$(sips --getProperty pixelWidth "$SOURCE" | tail -1 | awk '{print $2}')
SOURCE_HEIGHT=$(sips --getProperty pixelHeight "$SOURCE" | tail -1 | awk '{print $2}')
HAS_ALPHA=$(sips --getProperty hasAlpha "$SOURCE" 2>/dev/null | tail -1 | awk '{print $2}')
echo "Size: ${SOURCE_WIDTH}x${SOURCE_HEIGHT}, Alpha: ${HAS_ALPHA:-unknown}"

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo ""
echo "Processing source image..."

# Convert source to PNG
CONVERTED="$TEMP_DIR/converted.png"
SOURCE_EXT="${SOURCE##*.}"
cp "$SOURCE" "$TEMP_DIR/source_copy.${SOURCE_EXT}"
sips -s format png "$TEMP_DIR/source_copy.${SOURCE_EXT}" --out "$CONVERTED" > /dev/null 2>&1

# Auto-crop transparent borders
CROPPED="$TEMP_DIR/cropped.png"
echo "  Auto-cropping transparent borders..."
python3 "$SCRIPT_DIR/autocrop.py" "$CONVERTED" "$CROPPED"

# Read cropped dimensions
CROP_WIDTH=$(sips --getProperty pixelWidth "$CROPPED" | tail -1 | awk '{print $2}')
CROP_HEIGHT=$(sips --getProperty pixelHeight "$CROPPED" | tail -1 | awk '{print $2}')

# Make it square by padding the shorter dimension
INTERMEDIATE="$TEMP_DIR/intermediate.png"
if [ "$CROP_WIDTH" -ne "$CROP_HEIGHT" ]; then
  MAX_DIM=$((CROP_WIDTH > CROP_HEIGHT ? CROP_WIDTH : CROP_HEIGHT))
  cp "$CROPPED" "$INTERMEDIATE"
  sips -p "$MAX_DIM" "$MAX_DIM" "$INTERMEDIATE" --out "$INTERMEDIATE" > /dev/null 2>&1
  echo "  Padded to ${MAX_DIM}x${MAX_DIM} square"
else
  cp "$CROPPED" "$INTERMEDIATE"
fi

echo ""
echo "Generating Chrome Extension icons..."
for SIZE in 16 32 48 128 256; do
  OUTPUT="$ICONS_DIR/icon${SIZE}.png"
  sips -z "$SIZE" "$SIZE" "$INTERMEDIATE" --out "$OUTPUT" > /dev/null 2>&1
  echo "  icons/icon${SIZE}.png  (${SIZE}x${SIZE})"
done

cp "$ICONS_DIR/icon256.png" "$ICONS_DIR/icon.png"
echo "  icons/icon.png  (256x256)"

WEBSITE_APP="$PROJECT_ROOT/website/src/app"

echo ""
echo "Generating website icons..."
mkdir -p "$WEBSITE_PUBLIC"

# Header/footer logo (referenced in components via <Image src="/logo.png">)
sips -z 128 128 "$INTERMEDIATE" --out "$WEBSITE_PUBLIC/logo.png" > /dev/null 2>&1
echo "  website/public/logo.png  (128x128)"

# Favicon (Next.js file convention: src/app/icon.png auto-detected as favicon)
sips -z 32 32 "$INTERMEDIATE" --out "$WEBSITE_APP/icon.png" > /dev/null 2>&1
echo "  website/src/app/icon.png  (32x32, favicon)"

# Clean up legacy files
for LEGACY in "$WEBSITE_PUBLIC/favicon.ico" "$WEBSITE_PUBLIC/favicon.png" "$WEBSITE_PUBLIC/apple-touch-icon.png"; do
  if [ -f "$LEGACY" ]; then
    rm "$LEGACY"
    echo "  Removed legacy $(basename "$LEGACY")"
  fi
done

echo ""
echo "================================================="
echo "All icons synced!"
echo ""
echo "Extension:  icons/icon{16,32,48,128,256}.png + icon.png"
echo "Website:    website/public/logo.png (header/footer)"
echo "            website/src/app/icon.png (favicon, Next.js convention)"
