#!/usr/bin/env bash
#
# CI 打包包装：把构建输出同时写进日志文件；失败时把日志末尾写进
# 步骤摘要，并用 ::error:: 标注打出来。
#
# 为什么不用步骤日志：Actions 的步骤日志页需要登录才能查看，公开仓库
# 也一样。::error:: 标注会进到该次运行的 annotations，匿名可读，
# 出问题时不用点进网页就能看到失败原因。
#
# 用法：scripts/ci/run-build.sh <要执行的构建命令...>
#   scripts/ci/run-build.sh pnpm tauri build --bundles dmg
#
# 环境变量：
#   LOG_FILE        日志文件名，默认 build.log
#   GITEA/CI 摘要   写到 $GITHUB_STEP_SUMMARY（未设置时丢弃）

set -uo pipefail

LOG_FILE="${LOG_FILE:-build.log}"
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
  tail_lines() {
    tail -n "$1" "$LOG_FILE" \
      | tr -d '\r' \
      | sed -r 's/\x1b\[[0-9;]*[A-Za-z]//g'
  }

  {
    echo "### 构建失败（退出码 $status），日志末尾"
    echo '```'
    tail_lines 80
    echo '```'
  } >>"$SUMMARY" 2>/dev/null || true

  # 单条标注携带整段日志：GitHub 只解码 %0A 换行、%25 百分号
  payload=$(tail_lines 40 | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
  echo "::error::构建失败（退出码 $status），日志末尾：${payload}"
fi

exit "$status"
