#!/usr/bin/env python3
"""把构建产物发布到 GitHub Release。

为什么用 Python 而不是 gh CLI / bash+curl+jq：

* gh CLI 未必装在 runner 上，出错时只留一句 "Process completed with exit code 1"；
* CI 步骤日志要登录才能看，排查不到根因；
* jq 也未必在，而 JSON 拼装出错很难一眼看出来。

这里直接调 REST API，任何一步失败都把错误写进 Release 说明 ——
说明是公开的，不用登录也能看到失败原因。

环境变量：
  TAG       要发布的 tag，必填
  REPO      owner/repo，必填
  TOKEN     GitHub Token，必填
  DIST_DIR  产物目录，默认 dist
  LOG_DIR   各平台构建日志目录，默认 logs
  API_BASE  API 根地址，默认 https://api.github.com（测试时指向本地 mock）
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

TAG = os.environ["TAG"]
REPO = os.environ["REPO"]
TOKEN = os.environ["TOKEN"]
DIST_DIR = os.environ.get("DIST_DIR", "dist")
LOG_DIR = os.environ.get("LOG_DIR", "logs")
API_BASE = os.environ.get("API_BASE", "https://api.github.com")
API = f"{API_BASE}/repos/{REPO}"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


class ApiError(Exception):
    def __init__(self, method, url, status, body):
        self.status = status
        self.body = body
        super().__init__(f"{method} {url} -> HTTP {status}: {body[:500]}")


def request(method, url, data=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=data, method=method)
    for key, value in {**HEADERS, **(headers or {})}.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8", "replace")
        raise ApiError(method, url, e.code, payload) from None
    except urllib.error.URLError as e:
        raise ApiError(method, url, 0, str(e)) from None
    if raw:
        return payload
    return json.loads(payload.decode("utf-8")) if payload else None


def api_json(method, url, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    return request(method, url, data=body, headers=headers)


def collect_assets():
    """产物可能散在子目录里：upload-artifact 会保留 bundle/ 下的层级。"""
    assets = []
    seen = {}
    for root, _dirs, files in os.walk(DIST_DIR):
        for name in sorted(files):
            path = os.path.join(root, name)
            if name in seen:
                raise SystemExit(f"产物名重复：{name}（{seen[name]} 与 {path}）")
            seen[name] = path
            assets.append((name, path))
    return sorted(assets)


def collect_diagnostics():
    """各平台构建失败时的错误摘要，附在发布说明末尾。"""
    parts = []
    if not os.path.isdir(LOG_DIR):
        return parts
    for entry in sorted(os.listdir(LOG_DIR)):
        error_file = os.path.join(LOG_DIR, entry, "build-error.txt")
        if not os.path.isfile(error_file):
            continue
        with open(error_file, encoding="utf-8", errors="replace") as f:
            parts.append((entry, f.read()))
    return parts


def build_notes():
    notes_file = os.path.join(".github", "release-notes", f"{TAG}.md")
    if os.path.isfile(notes_file):
        with open(notes_file, encoding="utf-8") as f:
            notes = f.read().rstrip("\n")
    else:
        notes = f"TeaCoder {TAG}"

    diagnostics = collect_diagnostics()
    if diagnostics:
        notes += "\n\n## 构建诊断（部分平台打包失败）"
        for platform, text in diagnostics:
            notes += f"\n\n### {platform}\n\n```\n{text.rstrip()}\n```"
    return notes


def patch_release_body(release_id, body):
    api_json("PATCH", f"{API}/releases/{release_id}", {"body": body})


def main():
    assets = collect_assets()
    if not assets:
        print("没有可发布的产物，跳过发布")
        return 0

    notes = build_notes()

    release = None
    try:
        release = request("GET", f"{API}/releases/tags/{TAG}")
    except ApiError as e:
        if e.status != 404:
            raise

    if release is None:
        release = api_json(
            "POST",
            f"{API}/releases",
            {
                "tag_name": TAG,
                "name": f"TeaCoder {TAG}",
                "body": notes,
                "draft": False,
                "prerelease": False,
            },
        )
        print(f"已创建 Release {TAG}（id={release['id']}）")
    else:
        print(f"Release {TAG} 已存在（id={release['id']}）")

    release_id = release["id"]

    try:
        existing = request("GET", f"{API}/releases/{release_id}/assets?per_page=100")
        by_name = {a["name"]: a["id"] for a in existing}
        for name, path in assets:
            if name in by_name:
                request("DELETE", f"{API}/releases/assets/{by_name[name]}")
            with open(path, "rb") as f:
                payload = f.read()
            url = f"{API}/releases/{release_id}/assets?name={urllib.parse.quote(name)}"
            request(
                "POST",
                url,
                data=payload,
                headers={"Content-Type": "application/octet-stream"},
                raw=True,
            )
            print(f"已上传 {name}")

        patch_release_body(release_id, notes)
        print("发布说明已更新")
    except Exception as e:  # noqa: BLE001 —— 任何失败都要留下公开线索
        print(f"发布失败：{e}", file=sys.stderr)
        try:
            patch_release_body(
                release_id,
                f"{notes}\n\n## 发布失败\n\n```\n{str(e)[:2000]}\n```",
            )
            print("失败原因已写入发布说明")
        except Exception as inner:  # noqa: BLE001
            print(f"写入发布说明也失败了：{inner}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
