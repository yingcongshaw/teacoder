#!/usr/bin/env bash
#
# 发布 GitHub Release：把 dist/ 下的产物挂到 tag 对应的 Release 上。
#
# 发布说明优先取 .github/release-notes/<tag>.md（中文手写），
# 取不到时退回一行标题。某个平台打包失败时，把它的错误摘要附在
# 发布说明末尾 —— CI 日志需要登录才能看，Release 说明是公开的。
#
# 用法（在 CI 里）：bash scripts/ci/release.sh
#
# 环境变量：
#   TAG       要发布的 tag，必填
#   DIST_DIR  产物目录，默认 dist
#   LOG_DIR   各平台构建日志目录，默认 logs

set -uo pipefail

TAG="${TAG:?必须设置 TAG}"
DIST_DIR="${DIST_DIR:-dist}"
LOG_DIR="${LOG_DIR:-logs}"

shopt -s nullglob
assets=("$DIST_DIR"/*)
if [ ${#assets[@]} -eq 0 ]; then
  echo "没有可发布的产物，跳过发布"
  exit 0
fi

notes_file=".github/release-notes/${TAG}.md"
if [ -f "$notes_file" ]; then
  notes="$(cat "$notes_file")"
else
  notes="TeaCoder ${TAG}"
fi

failed=()
for f in "$LOG_DIR"/*/build-error.txt; do
  [ -f "$f" ] || continue
  failed+=("$f")
done

if [ ${#failed[@]} -gt 0 ]; then
  fence='```'
  notes="$notes"$'\n\n'"## 构建诊断（部分平台打包失败）"
  for f in "${failed[@]}"; do
    platform="$(basename "$(dirname "$f")")"
    notes="$notes"$'\n\n'"### ${platform}"$'\n\n'"${fence}"$'\n'"$(cat "$f")"$'\n'"${fence}"
  done
fi

tmp_notes="$(mktemp)"
printf '%s\n' "$notes" >"$tmp_notes"

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "${assets[@]}" --clobber
  gh release edit "$TAG" --notes-file "$tmp_notes"
else
  gh release create "$TAG" "${assets[@]}" --title "TeaCoder ${TAG}" --notes-file "$tmp_notes"
fi
