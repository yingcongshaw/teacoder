#!/usr/bin/env python3
"""把各平台的构建失败摘要发到仓库的公开 Issue。

CI 步骤日志要登录才能看，Release 说明又依赖发布流程本身成功 ——
一旦发布环节出问题，就没有任何公开渠道能看到失败原因。Issue 永远公开可见，
也不依赖发布流程，因此单独走这一条通道。

环境变量：
  REPO      owner/repo，必填
  TOKEN     GitHub Token，必填
  LOG_DIR   各平台构建日志目录，默认 logs
  TITLE     Issue 标题，默认「CI 构建诊断」
  API_BASE  API 根地址，默认 https://api.github.com（测试时指向本地 mock）
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = os.environ["REPO"]
TOKEN = os.environ["TOKEN"]
LOG_DIR = os.environ.get("LOG_DIR", "logs")
TITLE = os.environ.get("TITLE", "CI 构建诊断")
API_BASE = os.environ.get("API_BASE", "https://api.github.com")
API = f"{API_BASE}/repos/{REPO}"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def request(method, url, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = dict(HEADERS)
    if body:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method)
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise SystemExit(f"{method} {url} -> HTTP {e.code}: {detail[:500]}")
    except urllib.error.URLError as e:
        raise SystemExit(f"{method} {url} 失败：{e}")
    return json.loads(raw.decode("utf-8")) if raw else None


def collect_failures():
    failures = []
    if not os.path.isdir(LOG_DIR):
        return failures
    for entry in sorted(os.listdir(LOG_DIR)):
        error_file = os.path.join(LOG_DIR, entry, "build-error.txt")
        if not os.path.isfile(error_file):
            continue
        with open(error_file, encoding="utf-8", errors="replace") as f:
            failures.append((entry, f.read().rstrip()))
    return failures


def main():
    failures = collect_failures()
    if not failures:
        print("没有平台构建失败，无需发布诊断")
        return 0

    body = "构建失败的平台与错误摘要（CI 步骤日志需登录查看，这里是公开副本）："
    for platform, text in failures:
        body += f"\n\n### {platform}\n\n```\n{text}\n```"

    # 同一个标题只留一个 Issue，重跑时更新它
    query = urllib.parse.urlencode({"state": "all", "per_page": 100})
    issues = request("GET", f"{API}/issues?{query}") or []
    existing = next((i for i in issues if i.get("title") == TITLE), None)

    if existing:
        request("PATCH", f"{API}/issues/{existing['id']}", {"body": body})
        print(f"已更新诊断 Issue #{existing['number']}")
    else:
        created = request("POST", f"{API}/issues", {"title": TITLE, "body": body})
        print(f"已创建诊断 Issue #{created['number']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
