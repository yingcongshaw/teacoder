#!/usr/bin/env bash
#
# 发布 GitHub Release：把 dist/ 下的产物挂到 tag 对应的 Release 上。
#
# 不用 gh CLI：一是它未必装在 runner 上，二是出错时只有一句
# "Process completed with exit code 1"，排查不到根因。这里直接调
# GitHub REST API，失败时把 HTTP 状态码和响应体原样打出来，
# 并附到发布说明里（发布说明是公开的，CI 日志要登录才能看）。
#
# 发布顺序：先建 Release（只带说明），再逐个传产物，最后回写说明。
# 这样即使传产物失败，Release 页也已经存在，失败原因能公开看到。
#
# 用法（在 CI 里）：bash scripts/ci/release.sh
#
# 环境变量：
#   TAG       要发布的 tag，必填
#   REPO      owner/repo，必填
#   TOKEN     GitHub Token，必填
#   DIST_DIR  产物目录，默认 dist
#   LOG_DIR   各平台构建日志目录，默认 logs
#   API_BASE  API 根地址，默认 https://api.github.com（测试时指向本地 mock）

set -uo pipefail

TAG="${TAG:?必须设置 TAG}"
REPO="${REPO:?必须设置 REPO}"
TOKEN="${TOKEN:?必须设置 TOKEN}"
DIST_DIR="${DIST_DIR:-dist}"
LOG_DIR="${LOG_DIR:-logs}"
API_BASE="${API_BASE:-https://api.github.com}"

API="${API_BASE}/repos/${REPO}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

# curl 的响应体与状态码分开拿：状态码决定走哪条分支，响应体用来报错
RESP_BODY=""
HTTP_CODE=""

api() {
  # api <方法> <路径> [JSON 文件]
  local method="$1" path="$2" payload="${3:-}"
  RESP_BODY="$(mktemp)"
  local -a args=(-sS -X "$method" "${API}${path}" "${AUTH[@]}" -o "$RESP_BODY" -w '%{http_code}')
  if [ -n "$payload" ]; then
    args+=(-H "Content-Type: application/json" --data-binary "@${payload}")
  fi
  HTTP_CODE="$(curl "${args[@]}")"
}

urlencode() {
  # 产物名里的字符不多，但 & ? # 在查询串里会出事，统一编码
  printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/ /%20/g' -e 's/&/%26/g' -e 's/?/%3F/g' -e 's/#/%23/g' -e 's/+/%2B/g'
}

# ---- 发布说明：手写的中文说明 + 各平台失败时的错误摘要 ------------------

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

tmp_payload="$(mktemp)"
jq -n --arg tag "$TAG" --arg name "TeaCoder ${TAG}" --rawfile body "$tmp_notes" \
  '{tag_name: $tag, name: $name, body: $body, draft: false, prerelease: false}' >"$tmp_payload"

# ---- 1. 建（或找到）Release --------------------------------------------

release_id=""
api GET "/releases/tags/${TAG}"
if [ "$HTTP_CODE" = "200" ]; then
  release_id="$(jq -r '.id' "$RESP_BODY")"
  echo "Release ${TAG} 已存在（id=${release_id}）"
elif [ "$HTTP_CODE" = "404" ]; then
  api POST "/releases" "$tmp_payload"
  if [ "$HTTP_CODE" = "201" ]; then
    release_id="$(jq -r '.id' "$RESP_BODY")"
    echo "已创建 Release ${TAG}（id=${release_id}）"
  else
    echo "创建 Release 失败：HTTP ${HTTP_CODE}"
    cat "$RESP_BODY"
    exit 1
  fi
else
  echo "查询 Release 失败：HTTP ${HTTP_CODE}"
  cat "$RESP_BODY"
  exit 1
fi

# ---- 2. 传产物（同名先删，避免重跑时 422） -----------------------------

upload_failed=0
shopt -s nullglob
for f in "$DIST_DIR"/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  api GET "/releases/${release_id}/assets?per_page=100"
  old_id=""
  if [ "$HTTP_CODE" = "200" ]; then
    old_id="$(jq -r --arg n "$name" '.[] | select(.name == $n) | .id' "$RESP_BODY" | head -n 1)"
  fi
  if [ -n "$old_id" ]; then
    api DELETE "/releases/assets/${old_id}"
    if [ "$HTTP_CODE" != "204" ]; then
      echo "删除旧产物 ${name} 失败：HTTP ${HTTP_CODE}"
      cat "$RESP_BODY"
    fi
  fi

  code="$(curl -sS -X POST "${API}/releases/${release_id}/assets?name=$(urlencode "$name")" \
    "${AUTH[@]}" -H "Content-Type: application/octet-stream" \
    --data-binary "@${f}" -o "$RESP_BODY" -w '%{http_code}')"
  if [ "$code" = "201" ]; then
    echo "已上传 ${name}"
  else
    echo "上传 ${name} 失败：HTTP ${code}"
    cat "$RESP_BODY"
    upload_failed=1
  fi
done

# ---- 3. 回写说明（含构建诊断） ------------------------------------------

jq -n --rawfile body "$tmp_notes" '{body: $body}' >"$tmp_payload"
api PATCH "/releases/${release_id}" "$tmp_payload"
if [ "$HTTP_CODE" = "200" ]; then
  echo "发布说明已更新"
else
  echo "更新发布说明失败：HTTP ${HTTP_CODE}"
  cat "$RESP_BODY"
  upload_failed=1
fi

exit "$upload_failed"
