#!/usr/bin/env python3
"""Extract Douyin-related cookies from a browser profile via yt-dlp. Emits JSON to stdout."""
from __future__ import annotations

import json
import re
import sys

DOUYIN_DOMAIN_RE = re.compile(r"douyin|iesdouyin|byte|snssdk|aweme|toutiao", re.I)


def cookie_to_dict(cookie) -> dict:
    domain = getattr(cookie, "domain", "") or ""
    path = getattr(cookie, "path", "/") or "/"
    name = getattr(cookie, "name", "") or ""
    value = getattr(cookie, "value", "") or ""
    secure = bool(getattr(cookie, "secure", False))
    http_only = bool(getattr(cookie, "_rest", {}).get("HttpOnly")) if hasattr(cookie, "_rest") else False
    expires = getattr(cookie, "expires", None)
    exp_ts = int(expires) if expires else -1
    return {
        "name": name,
        "value": value,
        "domain": domain,
        "path": path,
        "secure": secure,
        "httpOnly": http_only,
        "expires": exp_ts,
    }


def main() -> int:
    browser = sys.argv[1].strip() if len(sys.argv) > 1 else "chrome"
    try:
        from yt_dlp.cookies import extract_cookies_from_browser
    except ImportError as exc:
        print(json.dumps({"ok": False, "error": f"yt_dlp not importable: {exc}", "cookies": []}))
        return 1

    try:
        jar = extract_cookies_from_browser(browser)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "cookies": []}))
        return 1

    out = []
    for cookie in jar:
        domain = getattr(cookie, "domain", "") or ""
        if not DOUYIN_DOMAIN_RE.search(domain):
            continue
        out.append(cookie_to_dict(cookie))

    print(json.dumps({"ok": True, "cookies": out, "count": len(out), "browser": browser}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
