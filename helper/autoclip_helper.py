#!/usr/bin/env python3
"""AutoClip Helper: downloads a video link on YOUR computer (your own home IP), then hands the file to the
AutoClip website in your browser. Same idea as running yt-dlp locally, which is why YouTube does not block it.

 * Listens on 127.0.0.1 only. Nothing is reachable from the network.
 * Only answers requests that come from the AutoClip website (Origin check) and a localhost Host header.
 * Cookies are optional and never leave this computer: --browser chrome|edge|firefox|brave reads them locally,
   or put a cookies.txt next to this file.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

VERSION = "1.0.0"
PORT = 8791
ALLOWED_ORIGINS = {"https://winplaybox.github.io", "https://winplaybox.in", "https://clip.winplaybox.in",
                   "http://localhost:5500", "http://127.0.0.1:5500"}
ALLOWED_ORIGIN_RE = re.compile(r"^https://([a-z0-9-]+\.)*winplaybox\.in$")
SOURCE_DOMAINS = ("youtube.com", "youtu.be", "twitch.tv", "kick.com", "vimeo.com", "dailymotion.com", "rumble.com",
                  "facebook.com", "fb.watch", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com",
                  "streamable.com")
MAX_MINUTES = 180
WORK = os.path.join(tempfile.gettempdir(), "autoclip-helper")
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
OPTS = {"browser": None, "cookies": None}


def origin_ok(origin: str) -> bool:
    return origin in ALLOWED_ORIGINS or bool(ALLOWED_ORIGIN_RE.match(origin or ""))


def url_ok(url: str) -> str:
    u = urlparse(url.strip())
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host:
        raise ValueError("Paste a full video link starting with https://")
    if not any(host == d or host.endswith("." + d) for d in SOURCE_DOMAINS):
        raise ValueError("That site is not supported by the helper.")
    return url.strip()


def ydl_opts(outtmpl: str, hook) -> dict:
    has_ff = bool(shutil.which("ffmpeg"))
    o = {
        "outtmpl": outtmpl, "noplaylist": True, "quiet": True, "no_warnings": True, "retries": 5,
        "fragment_retries": 5, "concurrent_fragment_downloads": 6, "progress_hooks": [hook],
        "format": ("bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b"
                   if has_ff else "b[height<=1080][ext=mp4]/b[ext=mp4]/b"),
        "merge_output_format": "mp4", "match_filter": None,
    }
    if OPTS["cookies"]:
        o["cookiefile"] = OPTS["cookies"]
    elif OPTS["browser"]:
        o["cookiesfrombrowser"] = (OPTS["browser"],)
    return o


def friendly(e: Exception) -> str:
    t = str(e).lower()
    if "sign in to confirm" in t or "not a bot" in t or "login required" in t:
        return "YouTube asked for sign-in. Restart the helper with your browser name, e.g. start.bat edge"
    if "private" in t or "members" in t:
        return "This video is private or members-only."
    if "unavailable" in t or "not available" in t:
        return "This video is not available."
    if "ffmpeg" in t:
        return "ffmpeg is missing. Install it (winget install ffmpeg) and restart the helper."
    return "Download failed. Check the link and try again."


def run_download(job_id: str, url: str) -> None:
    import yt_dlp  # imported late so --help works without it

    job = JOBS[job_id]
    d = os.path.join(WORK, job_id)
    os.makedirs(d, exist_ok=True)

    def hook(p: dict) -> None:
        if p.get("status") == "downloading":
            tot = p.get("total_bytes") or p.get("total_bytes_estimate") or 0
            if tot:
                job["progress"] = min(0.99, p.get("downloaded_bytes", 0) / tot)

    try:
        with yt_dlp.YoutubeDL(ydl_opts(os.path.join(d, "source.%(ext)s"), hook)) as y:
            info = y.extract_info(url, download=False)
            if info.get("is_live"):
                raise ValueError("Live streams are not supported.")
            dur = float(info.get("duration") or 0)
            if dur > MAX_MINUTES * 60:
                raise ValueError(f"Video is {dur / 60:.0f} min. The limit is {MAX_MINUTES} min.")
            job["title"] = (info.get("title") or "")[:200]
            info = y.extract_info(url, download=True)
            path = (info.get("requested_downloads") or [{}])[0].get("filepath") or y.prepare_filename(info)
        if not path or not os.path.exists(path):
            cands = [os.path.join(d, n) for n in os.listdir(d) if n.startswith("source.")]
            path = max(cands, key=os.path.getsize) if cands else ""
        if not path:
            raise RuntimeError("no file")
        job.update(status="done", progress=1.0, path=path, size=os.path.getsize(path),
                   name=re.sub(r"[^A-Za-z0-9 ._-]", "", job.get("title") or "video")[:60].strip() or "video")
    except ValueError as e:
        job.update(status="failed", error=str(e))
    except Exception as e:  # noqa: BLE001
        job.update(status="failed", error=friendly(e))


def cleanup() -> None:
    now = time.time()
    with LOCK:
        for jid, j in list(JOBS.items()):
            if now - j["created"] > 3600:
                shutil.rmtree(os.path.join(WORK, jid), ignore_errors=True)
                JOBS.pop(jid, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "AutoClipHelper/" + VERSION

    def log_message(self, *a) -> None:  # quiet
        pass

    def _guard(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        origin = self.headers.get("Origin") or ""
        if host not in ("127.0.0.1", "localhost") or not origin_ok(origin):
            self._json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Not allowed."}, cors=False)
            return False
        return True

    def _cors(self) -> None:
        o = self.headers.get("Origin") or ""
        self.send_header("Access-Control-Allow-Origin", o)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, code: int, data: dict, cors: bool = True) -> None:
        body = json.dumps(data).encode()
        self.send_response(code)
        if cors:
            self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._guard():
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._guard():
            return
        p = urlparse(self.path).path
        if p == "/ping":
            ck = "file" if OPTS["cookies"] else (OPTS["browser"] or "none")
            return self._json(200, {"ok": True, "helper": "autoclip", "version": VERSION, "cookies": ck})
        m = re.fullmatch(r"/status/([0-9a-f]{32})", p)
        if m and m.group(1) in JOBS:
            j = JOBS[m.group(1)]
            return self._json(200, {"ok": True, **{k: j.get(k) for k in ("status", "progress", "title", "error", "size", "name")}})
        m = re.fullmatch(r"/file/([0-9a-f]{32})", p)
        if m and m.group(1) in JOBS and JOBS[m.group(1)].get("status") == "done":
            j = JOBS[m.group(1)]
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(j["size"]))
            self.end_headers()
            with open(j["path"], "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1 << 20)
            return
        self._json(404, {"ok": False, "error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        if not self._guard():
            return
        if urlparse(self.path).path != "/download":
            return self._json(404, {"ok": False, "error": "Not found."})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n, 4096)) or b"{}")
            url = url_ok(str(body.get("url", "")))
        except ValueError as e:
            return self._json(400, {"ok": False, "error": str(e)})
        except Exception:  # noqa: BLE001
            return self._json(400, {"ok": False, "error": "Bad request."})
        cleanup()
        if sum(1 for j in JOBS.values() if j["status"] == "downloading") >= 2:
            return self._json(429, {"ok": False, "error": "Helper is busy. Wait for the current download."})
        jid = uuid.uuid4().hex
        JOBS[jid] = {"status": "downloading", "progress": 0.0, "created": time.time()}
        threading.Thread(target=run_download, args=(jid, url), daemon=True).start()
        self._json(202, {"ok": True, "id": jid})


def main() -> None:
    ap = argparse.ArgumentParser(description="AutoClip Helper")
    ap.add_argument("--browser", choices=["chrome", "edge", "firefox", "brave", "opera", "vivaldi", "safari"],
                    help="read YouTube cookies from this browser, locally (only if YouTube asks you to sign in)")
    ap.add_argument("--port", type=int, default=PORT)
    a = ap.parse_args()
    OPTS["browser"] = a.browser
    cf = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
    if os.path.isfile(cf):
        OPTS["cookies"] = cf
    os.makedirs(WORK, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"AutoClip Helper {VERSION} running on http://127.0.0.1:{a.port}")
    print("Keep this window open. Open the AutoClip website and paste a link.")
    if not shutil.which("ffmpeg"):
        print("Note: ffmpeg not found. Install it for best quality:  winget install ffmpeg")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
