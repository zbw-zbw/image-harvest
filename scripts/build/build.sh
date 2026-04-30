#!/bin/bash
#
# Image Harvest — Chrome Extension Build Script
#
# Usage:
#   ./scripts/build.sh                       # 使用 manifest.json 中的版本号打包
#   ./scripts/build.sh 1.2.0                 # 指定版本号打包（同时同步到 manifest.json）
#   ./scripts/build.sh --sync-from-package   # 用 package.json 的版本同步到 manifest.json 后打包
#   ./scripts/build.sh --check               # 仅检查版本一致性，不打包
#
# Output:
#   dist/image-harvest-v{version}-{yyyyMMdd-HHmmss}.zip
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
MANIFEST="$PROJECT_ROOT/manifest.json"
PACKAGE_JSON="$PROJECT_ROOT/package.json"

# ---------- 参数解析 ----------
EXPLICIT_VERSION=""
SYNC_FROM_PACKAGE=0
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --sync-from-package)
      SYNC_FROM_PACKAGE=1 ;;
    --check)
      CHECK_ONLY=1 ;;
    --help|-h)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*)
      echo "❌ Unknown option: $arg" >&2; exit 1 ;;
    *)
      EXPLICIT_VERSION="$arg" ;;
  esac
done

# ---------- 工具函数 ----------
extract_version() {
  # 从 JSON 文件中提取顶层 "version" 字段
  grep '"version"' "$1" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
}

# 把 manifest.json 中的 version 字段就地替换为指定值
write_manifest_version() {
  local new_version="$1"
  local tmp="${MANIFEST}.tmp.$"
  # 仅替换第一处 "version": "x.y.z"，避免误伤嵌套字段
  awk -v ver="$new_version" '
    !done && /"version"[[:space:]]*:[[:space:]]*"[^"]*"/ {
      sub(/"version"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"version\": \"" ver "\"")
      done = 1
    }
    { print }
  ' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
}

# ---------- 版本号 ----------
MANIFEST_VERSION="$(extract_version "$MANIFEST")"
PACKAGE_VERSION=""
if [ -f "$PACKAGE_JSON" ]; then
  PACKAGE_VERSION="$(extract_version "$PACKAGE_JSON")"
fi

# 决定本次要使用的版本号（优先级：显式参数 > --sync-from-package > manifest.json）
if [ -n "$EXPLICIT_VERSION" ]; then
  VERSION="$EXPLICIT_VERSION"
elif [ "$SYNC_FROM_PACKAGE" -eq 1 ]; then
  if [ -z "$PACKAGE_VERSION" ]; then
    echo "❌ --sync-from-package 失败：无法从 package.json 解析出 version" >&2
    exit 1
  fi
  VERSION="$PACKAGE_VERSION"
else
  VERSION="$MANIFEST_VERSION"
fi

if [ -z "$VERSION" ]; then
  echo "❌ 无法确定版本号，请检查 manifest.json 或显式传入版本参数" >&2
  exit 1
fi

# 同步 manifest.json：当显式传入版本 或 --sync-from-package 时
if [ "$VERSION" != "$MANIFEST_VERSION" ] && { [ -n "$EXPLICIT_VERSION" ] || [ "$SYNC_FROM_PACKAGE" -eq 1 ]; }; then
  echo "🔄 同步 manifest.json: $MANIFEST_VERSION → $VERSION"
  write_manifest_version "$VERSION"
  MANIFEST_VERSION="$VERSION"
fi

# 同步 package.json：当版本变更后，保持 package.json 与 manifest.json 一致
if [ -n "$PACKAGE_VERSION" ] && [ "$VERSION" != "$PACKAGE_VERSION" ]; then
  if [ -n "$EXPLICIT_VERSION" ] || [ "$SYNC_FROM_PACKAGE" -eq 1 ]; then
    echo "🔄 同步 package.json: $PACKAGE_VERSION → $VERSION"
    tmp_pkg="${PACKAGE_JSON}.tmp.$"
    awk -v ver="$VERSION" '
      !done && /"version"[[:space:]]*:[[:space:]]*"[^"]*"/ {
        sub(/"version"[[:space:]]*:[[:space:]]*"[^"]*"/, "\"version\": \"" ver "\"")
        done = 1
      }
      { print }
    ' "$PACKAGE_JSON" > "$tmp_pkg"
    mv "$tmp_pkg" "$PACKAGE_JSON"
    PACKAGE_VERSION="$VERSION"
  fi
fi

# 一致性检查
if [ -n "$PACKAGE_VERSION" ] && [ "$PACKAGE_VERSION" != "$MANIFEST_VERSION" ]; then
  echo "⚠️  版本号不一致："
  echo "    package.json:  $PACKAGE_VERSION"
  echo "    manifest.json: $MANIFEST_VERSION  ← 实际生效（Chrome Web Store 以此为准）"
  echo "    本次打包使用: $VERSION"
  echo "    👉 同步方式：./scripts/build/build.sh --sync-from-package"
  echo ""
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "✅ 版本检查："
  echo "    package.json:  ${PACKAGE_VERSION:-<missing>}"
  echo "    manifest.json: ${MANIFEST_VERSION:-<missing>}"
  exit 0
fi

TIMESTAMP=$(date +"%Y-%m-%d-%H-%M-%S")
ZIP_NAME="image-harvest-v${VERSION}-${TIMESTAMP}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

# ---------- 准备输出目录 ----------
mkdir -p "$DIST_DIR"

echo "================================================"
echo "  🖼️  Image Harvest — Build Extension Package"
echo "================================================"
echo ""
echo "  Version:    v${VERSION}"
echo "  Timestamp:  ${TIMESTAMP}"
echo "  Output:     dist/${ZIP_NAME}"
echo ""

# ---------- 打包 ----------
cd "$PROJECT_ROOT"

zip -r "$ZIP_PATH" . \
  -x ".git/*" \
  -x ".gitignore" \
  -x ".aone_copilot/*" \
  -x "dist/*" \
  -x "docs/*" \
  -x "scripts/*" \
  -x "website/*" \
  -x "node_modules/*" \
  -x "*.md" \
  -x ".DS_Store" \
  -x "**/.DS_Store" \
  -x ".env*" \
  -x "*.zip" \
  > /dev/null 2>&1

# ---------- 统计 ----------
FILE_COUNT=$(zipinfo -1 "$ZIP_PATH" | wc -l | tr -d ' ')
FILE_SIZE=$(ls -lh "$ZIP_PATH" | awk '{print $5}')

echo "  ✅ Build succeeded!"
echo ""
echo "  Files:      ${FILE_COUNT} files"
echo "  Size:       ${FILE_SIZE}"
echo "  Path:       ${ZIP_PATH}"
echo ""

# ---------- 列出历史版本 ----------
HISTORY_COUNT=$(ls -1 "$DIST_DIR"/image-harvest-v*.zip 2>/dev/null | wc -l | tr -d ' ')
if [ "$HISTORY_COUNT" -gt 1 ]; then
  echo "  📦 Build History (${HISTORY_COUNT} versions):"
  ls -1t "$DIST_DIR"/image-harvest-v*.zip | while read -r f; do
    SIZE=$(ls -lh "$f" | awk '{print $5}')
    NAME=$(basename "$f")
    printf "     %-50s %s\n" "$NAME" "$SIZE"
  done
  echo ""
fi

echo "================================================"
