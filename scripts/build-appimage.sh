#!/usr/bin/env bash
#
# 构建 AppImage，并在 GitHub 不可达时改用本地缓存的 AppImage runtime。
#
# appimagetool 默认要从 github.com 下载 type2-runtime；网络受限时打包会
# 以 "failed to run linuxdeploy" 收场，实际错误埋在子进程输出里。
# linuxdeploy 的 appimage 插件支持 LDAI_RUNTIME_FILE，指向本地 runtime 后
# 不再联网下载。
#
# runtime 的获取顺序：
#   1. 缓存目录中已有
#   2. 从历史产物 AppImage 中切出（AppImage = runtime ELF + squashfs）
#   3. 从 GitHub 下载（网络可达时）

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) RUNTIME_NAME="runtime-x86_64" ;;
  aarch64 | arm64) RUNTIME_NAME="runtime-aarch64" ;;
  *) echo "不支持的架构: $ARCH" >&2; exit 1 ;;
esac

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/appimage-runtime"
RUNTIME_FILE="$CACHE_DIR/$RUNTIME_NAME"
RUNTIME_URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/$RUNTIME_NAME"
BUNDLE_DIR="src-tauri/target/release/bundle/appimage"

mkdir -p "$CACHE_DIR"

# 从已有 AppImage 切出 runtime：squashfs 超级块以 hsqs 开头，
# 其后偏移 12 处的块大小为 131072，据此定位 runtime 与文件系统���分界。
extract_from_appimage() {
  local appimage="$1"
  python3 -I - "$appimage" "$RUNTIME_FILE" <<'PY'
import sys

appimage, out = sys.argv[1], sys.argv[2]
data = open(appimage, "rb").read()
magic, block_size = b"hsqs", 131072
offset = -1
pos = 0
while True:
    hit = data.find(magic, pos)
    if hit < 0:
        break
    # 校验超级块：偏移 12 处为小端块大小
    if int.from_bytes(data[hit + 12:hit + 16], "little") == block_size:
        offset = hit
        break
    pos = hit + 1
if offset <= 0:
    sys.exit("未在 AppImage 中定位到 squashfs 超级块")
open(out, "wb").write(data[:offset])
print(f"已切出 runtime: {offset} 字节")
PY
}

if [ -s "$RUNTIME_FILE" ]; then
  echo "使用已缓存的 runtime: $RUNTIME_FILE"
elif compgen -G "$BUNDLE_DIR/*.AppImage" > /dev/null; then
  echo "从历史产物提取 runtime..."
  if extract_from_appimage "$(ls -t "$BUNDLE_DIR"/*.AppImage | head -1)"; then
    echo "已提取: $RUNTIME_FILE"
  else
    rm -f "$RUNTIME_FILE"
    echo "提取失败，改为下载" >&2
    curl -fsSL -o "$RUNTIME_FILE" "$RUNTIME_URL"
  fi
else
  echo "下载 runtime: $RUNTIME_URL"
  curl -fsSL -o "$RUNTIME_FILE" "$RUNTIME_URL"
fi

chmod +x "$RUNTIME_FILE"

export LDAI_RUNTIME_FILE="$RUNTIME_FILE"
exec pnpm tauri build --bundles appimage "$@"
