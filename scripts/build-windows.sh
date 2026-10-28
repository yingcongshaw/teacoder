#!/usr/bin/env bash
#
# 在 Linux/macOS 上交叉编译 Windows 安装包（NSIS）。
#
# MSI 需要 WiX（Windows 专属的 .NET 工具），无法交叉编译，故本脚本只出 NSIS。
#
# 注意：不带 --target 时，pnpm tauri build 只会产出当前主机（Linux）的包，
# 所以这里必须显式指定 --target x86_64-pc-windows-msvc。
#
# 前置条件：
#   sudo apt install nsis lld llvm clang    # makensis + cargo-xwin 所需的链接器
#   rustup target add x86_64-pc-windows-msvc
#   cargo install --locked cargo-xwin
#
# tauri-bundler 每次打 NSIS 都要从 github.com 拉 nsis_tauri_utils.dll，且因为
# 缓存里没有 NSIS.exe（Linux 根本用不到），哈希校验必然失败并重建缓存目录 ——
# 等于每次打包都要联网。这里把两个文件预置到缓存目录，命中哈希校验后就不会再联网。
#
# 用法：scripts/build-windows.sh [传给 pnpm tauri build 的参数]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="x86_64-pc-windows-msvc"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/NSIS"
PLUGIN_DIR="$CACHE_DIR/Plugins/x86-unicode/additional"

# tauri-bundler 校验用的哈希，改版本时需同步
NSIS_EXE_SHA1="6d45d4e8ccf18fe1fdac9164058f356102a2ecf2"
PLUGIN_SHA1="75197fee3c6a814fe035788d1c34ead39349b860"

# github.com 直连不通时走镜像，可用 NSIS_MIRROR 覆盖
MIRROR="${NSIS_MIRROR:-https://ghproxy.net/https://github.com}"

NSIS_EXE_URL="$MIRROR/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip"
PLUGIN_URL="$MIRROR/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll"

if ! command -v makensis > /dev/null; then
  echo "缺少 makensis，请先执行: sudo apt install nsis" >&2
  exit 1
fi

if ! command -v cargo-xwin > /dev/null; then
  echo "缺少 cargo-xwin，请先执行: cargo install --locked cargo-xwin" >&2
  exit 1
fi

# cargo-xwin 用 clang 编译 C 依赖、用 lld-link 链接
for tool in clang lld-link; do
  if ! command -v "$tool" > /dev/null; then
    echo "缺少 $tool，请先执行: sudo apt install lld llvm clang" >&2
    exit 1
  fi
done

sha1_of() {
  sha1sum "$1" | cut -d' ' -f1
}

fetch_plugin() {
  mkdir -p "$PLUGIN_DIR"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --max-time 180 -o "$tmp" "$PLUGIN_URL"
  if [ "$(sha1_of "$tmp")" != "$PLUGIN_SHA1" ]; then
    rm -f "$tmp"
    echo "nsis_tauri_utils.dll 哈希校验失败，镜像可能不可信" >&2
    exit 1
  fi
  mv "$tmp" "$PLUGIN_DIR/nsis_tauri_utils.dll"
}

# NSIS.exe 只用于让哈希校验通过，Linux 打包实际用的是系统 makensis
fetch_nsis_exe() {
  local tmp zip
  tmp="$(mktemp)"
  zip="$(mktemp --suffix=.zip)"
  curl -fsSL --max-time 300 -o "$zip" "$NSIS_EXE_URL"
  python3 -I - "$zip" "$tmp" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = [n for n in z.namelist() if n.rsplit("/", 1)[-1].lower() == "nsis.exe"]
    if not names:
        sys.exit("压缩包里没有 NSIS.exe")
    open(sys.argv[2], "wb").write(z.read(names[0]))
PY
  if [ "$(sha1_of "$tmp")" != "$NSIS_EXE_SHA1" ]; then
    rm -f "$tmp" "$zip"
    echo "NSIS.exe 哈希校验失败，镜像可能不可信" >&2
    exit 1
  fi
  mkdir -p "$CACHE_DIR"
  mv "$tmp" "$CACHE_DIR/NSIS.exe"
  rm -f "$zip"
}

if [ ! -f "$PLUGIN_DIR/nsis_tauri_utils.dll" ] || [ "$(sha1_of "$PLUGIN_DIR/nsis_tauri_utils.dll")" != "$PLUGIN_SHA1" ]; then
  echo "下载 nsis_tauri_utils.dll..."
  fetch_plugin
fi

if [ ! -f "$CACHE_DIR/NSIS.exe" ] || [ "$(sha1_of "$CACHE_DIR/NSIS.exe")" != "$NSIS_EXE_SHA1" ]; then
  echo "下载 NSIS 工具链..."
  fetch_nsis_exe
fi

echo "NSIS 缓存就绪: $CACHE_DIR"

exec pnpm tauri build --runner cargo-xwin --target "$TARGET" --bundles nsis "$@"
