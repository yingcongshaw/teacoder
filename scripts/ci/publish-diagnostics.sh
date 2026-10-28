#!/usr/bin/env bash
#
# 把各平台的构建失败摘要发到仓库的公开 Issue。
#
# CI 步骤日志要登录才能看，Release 说明又依赖发布流程本身成功 ——
# 一旦发布环节出问题，就没有任何公开渠道能看到失败原因。Issue 永远
# 公开可见，也不依赖发布流程，因此单独走这一条通道。
#
# 用法（在 CI 里）：bash scripts/ci/publish-diagnostics.sh
#
# 环境变量：
#   REPO     owner/repo，必填
#   TOKEN    GitHub Token，必填
#   LOG_DIR  各平台构建日志目录，默认 logs
#   TITLE    Issue 标题，默认「CI 构建诊断」
#   API_BASE API 根地址，默认 https://api.github.com（测试时指向本地 mock）

set -uo pipefail

REPO="${REPO:?必须设置 REPO}"
TOKEN="${TOKEN:?必须设置 TOKEN}"
LOG_DIR="${LOG_DIR:-logs}"
TITLE="${TITLE:-CI 构建诊断}"
API_BASE="${API_BASE:-https://api.github.com}"

API="${API_BASE}/repos/${REPO}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

failed=()
for f in "$LOG_DIR"/*/build-error.txt; do
  [ -f "$f" ] || continue
  failed+=("$f")
done

if [ ${#failed[@]} -eq 0 ]; then
  echo "没有平台构建失败，无需发布诊断"
  exit 0
fi

fence='```'
body="构建失败的平台与错误摘要（CI 步骤日志需登录查看，这里是公开副本）："
for f in "${failed[@]}"; do
  platform="$(basename "$(dirname "$f")")"
  body="$body"$'\n\n'"### ${platform}"$'\n\n'"${fence}"$'\n'"$(cat "$f")"$'\n'"${fence}"
done

tmp_body="$(mktemp)"
printf '%s\n' "$body" >"$tmp_body"

tmp_payload="$(mktemp)"
jq -n --rawfile body "$tmp_body" '{body: $body}' >"$tmp_payload"

# 同一个标题只留一个 Issue，重跑时更新它
resp="$(mktemp)"
curl -sS "${API}/issues?state=all&per_page=100" "${AUTH[@]}" -o "$resp"
issue_id="$(jq -r --arg t "$TITLE" 'map(select(.title == $t)) | .[0].id // empty' "$resp")"

if [ -n "$issue_id" ]; then
  code="$(curl -sS -X PATCH "${API}/issues/${issue_id}" "${AUTH[@]}" \
    -H "Content-Type: application/json" --data-binary "@${tmp_payload}" \
    -o "$resp" -w '%{http_code}')"
  echo "已更新诊断 Issue #${issue_id}（HTTP ${code}）"
else
  jq -n --arg t "$TITLE" --rawfile body "$tmp_body" '{title: $t, body: $body}' >"$tmp_payload"
  code="$(curl -sS -X POST "${API}/issues" "${AUTH[@]}" \
    -H "Content-Type: application/json" --data-binary "@${tmp_payload}" \
    -o "$resp" -w '%{http_code}')"
  if [ "$code" = "201" ]; then
    echo "已创建诊断 Issue #$(jq -r '.number' "$resp")"
  else
    echo "创建诊断 Issue 失败：HTTP ${code}"
    cat "$resp"
    exit 1
  fi
fi
