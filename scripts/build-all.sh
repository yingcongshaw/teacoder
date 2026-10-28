#!/usr/bin/env bash
#
# 一次打包「宿主平台 + Windows」两套安装包。
#
# 为什么不能一条 tauri build 出两个平台：
#   tauri build 的 --target 只能给一次（clap 限制），而 --runner 是全局的 ——
#   Windows MSVC 目标在 Linux/macOS 上必须用 cargo-xwin，跟宿主平台的 cargo
#   不是同一个 runner，一次调用里混不了。所以只能分成多次调用再串联。
#
# 各宿主平台能出什么：
#   Linux 宿主   → AppImage + deb + rpm，Windows NSIS（交叉编译）
#   macOS 宿主   → dmg，Windows NSIS（交叉编译）
#   Windows 宿主 → msi + nsis
#
# macOS 的 dmg 在 Linux 上做不出来（需要 macOS 宿主做 bundle 与签名），
# 所以本机一次最多覆盖两个平台，第三个平台交给 GitHub Actions。
#
# 用法：scripts/build-all.sh [传给 tauri build 的参数]
#   scripts/build-all.sh                              全部按当前配置版本打包
#   scripts/build-all.sh --config '{"version":"0.1.1"}'  指定版本号

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

HOST_OS="$(uname -s)"

case "$HOST_OS" in
  Linux)
    echo "==> 打包 Linux（AppImage + deb + rpm）"
    bash scripts/build.sh "$@"
    echo
    echo "==> 打包 Windows（NSIS，交叉编译）"
    bash scripts/build-windows.sh "$@"
    ;;
  Darwin)
    echo "==> 打包 macOS（dmg）"
    pnpm tauri build --bundles dmg "$@"
    echo
    echo "==> 打包 Windows（NSIS，交叉编译）"
    bash scripts/build-windows.sh "$@"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    echo "==> 打包 Windows（msi + nsis）"
    pnpm tauri build "$@"
    ;;
  *)
    echo "不支持的宿主系统: $HOST_OS" >&2
    exit 1
    ;;
esac

echo
echo "==> 产物清单："
for dir in \
  src-tauri/target/release/bundle \
  src-tauri/target/x86_64-pc-windows-msvc/release/bundle \
  src-tauri/target/universal-apple-darwin/release/bundle; do
  [ -d "$dir" ] || continue
  find "$dir" -type f \
    \( -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \
    -o -name '*.dmg' -o -name '*.msi' -o -name '*-setup.exe' \) -print
done
