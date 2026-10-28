#!/usr/bin/env bash
#
# CI 打包包装：把构建输出写进日志文件；失败时留下错误摘要文件，
# 并用 ::error:: 标注打出来。
#
# 为什么不用步骤日志：Actions 的步骤日志页需要登录才能查看，公开仓库
# 也一样。::error:: 标注会进到该次运行的 annotations，匿名可读，
# 出问题时不用点进网页就能看到失败原因。
#
# 用法：scripts/ci/run-build.sh <要执行的构建命令...>
#   scripts/ci/run-build.sh pnpm tauri build --bundles dmg
#
# 环境变量：
#   LOG_FILE     日志文件名，默认 build.log
#   ERROR_FILE   失败摘要文件名，默认 build-error.txt
#   SUMMARY      步骤摘要文件，默认取 $GITHUB_STEP_SUMMARY

set -uo pipefail

LOG_FILE="${LOG_FILE:-build.log}"
ERROR_FILE="${ERROR_FILE:-build-error.txt}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

{
  echo "### 构建环境"
  echo '```'
  rustc -V 2>/dev/null || true
  node -v 2>/dev/null || true
  uname -a 2>/dev/null || true
  df -h . 2>/dev/null | tail -2 || true
  echo '```'
} >>"$SUMMARY" 2>/dev/null || true

"$@" 2>&1 | tee "$LOG_FILE"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  # 去 ANSI 颜色：BSD sed 不认 \x 转义，用 printf 拼出 ESC 再做字符类匹配
  ESC="$(printf '\033')"
  tail -n 80 "$LOG_FILE" \
    | tr -d '\r' \
    | sed -e "s/${ESC}\\[[0-9;]*[A-Za-z]//g" \
    > "$ERROR_FILE"

  {
    echo "### 构建失败（退出码 $status），日志末尾"
    echo '```'
    cat "$ERROR_FILE"
    echo '```'
  } >>"$SUMMARY" 2>/dev/null || true

  # 标注正文必须短：过长时 GitHub 会整条丢弃，只剩「Process completed ...」
  one_line=$(head -c 900 "$ERROR_FILE" | tr '\n' ' ' | sed -e 's/%/%25/g')
  # 前面补一个换行：构建输出末尾常不带换行，不补的话标注会粘在最后一行
  # 输出的尾巴上，runner 只认行首的 ::，整条标注就被当成普通日志丢掉
  printf '\n::error::build failed (exit %s): %s\n' "$status" "$one_line"
fi

exit "$status"
