#!/usr/bin/env python3
"""Loopback-only deterministic media fixture server (Python standard library)."""
import argparse
import json
import mimetypes
import os
import re
import socket
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
MEDIA = ROOT / "media"
LOG_LOCK = threading.Lock()


def utc():
    return datetime.now(timezone.utc).isoformat()


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port=0, log_path=None):
        super().__init__(("127.0.0.1", port), FixtureHandler)
        self.log_path = Path(log_path) if log_path else ROOT / "server-requests.jsonl"
        if ROOT not in self.log_path.resolve().parents:
            raise ValueError("Request logs must remain under fixture root")


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalMediaFixture/1.0"

    def log_message(self, fmt, *args):
        # Do not log request headers, authentication, user agents, or environment.
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # A media probe may close an idle keep-alive connection after reading enough.
            self.close_connection = True

    def do_HEAD(self):
        self.handle_request(head=True)

    def do_GET(self):
        self.handle_request(head=False)

    def handle_request(self, head):
        self.observation = {"started_at_utc": utc(), "method": self.command,
                            "path": urlsplit(self.path).path, "range": self.headers.get("Range"),
                            "response_status": None, "body_bytes_sent": 0}
        started = time.monotonic()
        try:
            self.route(head)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.observation["client_disconnected"] = True
            self.close_connection = True
        finally:
            self.observation.update({"finished_at_utc": utc(), "elapsed_seconds": round(time.monotonic() - started, 6)})
            with LOG_LOCK:
                with self.server.log_path.open("a", encoding="utf-8") as log:
                    log.write(json.dumps(self.observation, ensure_ascii=False) + "\n")

    def respond(self, code, body, content_type="text/plain; charset=utf-8", head=False):
        self.observation["response_status"] = code
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head:
            self.wfile.write(body)
            self.observation["body_bytes_sent"] += len(body)

    def route(self, head):
        route = urlsplit(self.path).path
        if route == "/health":
            return self.respond(200, b'{"ok":true,"loopback_only":true}', "application/json", head)
        if route in ("/", "/watch", "/watch/direct", "/watch/hls", "/watch/dash", "/playlist"):
            return self.respond(200, self.html(route).encode("utf-8"), "text/html; charset=utf-8", head)
        if route == "/missing.mp4":
            return self.respond(404, b"Deterministic missing media fixture\n", head=head)
        if route == "/denied.mp4":
            return self.respond(403, b"Deterministic access denied fixture\n", head=head)
        aliases = {"/direct.mp4": "sample-720.mp4", "/slow.mp4": "sample-720.mp4",
                   "/disconnect.mp4": "sample-720.mp4", "/annotated.mp4": "sample-annotated.mp4"}
        if route in aliases:
            target = MEDIA / aliases[route]
        elif route.startswith("/media/"):
            target = (MEDIA / unquote(route[len("/media/"):])).resolve()
            if MEDIA not in target.parents:
                return self.respond(403, b"Path outside fixture media root\n", head=head)
        else:
            return self.respond(404, b"Unknown fixture route\n", head=head)
        if not target.is_file():
            return self.respond(404, b"Missing fixture file\n", head=head)
        return self.serve_file(target, head=head, slow=route == "/slow.mp4", disconnect=route == "/disconnect.mp4")

    def serve_file(self, path, head=False, slow=False, disconnect=False):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        raw_range = self.headers.get("Range")
        if raw_range:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", raw_range.strip())
            if not match or not any(match.groups()):
                return self.respond(400, b"Fixture supports exactly one byte range\n", head=head)
            left, right = match.groups()
            if left:
                start = int(left)
                end = min(int(right), size - 1) if right else size - 1
            else:
                suffix = int(right)
                start = max(0, size - suffix)
                end = size - 1
                if suffix == 0:
                    start = size
            if start >= size or start > end:
                self.observation["response_status"] = 416
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%s" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.observation["response_status"] = status
        self.observation["selected_start"] = start
        self.observation["selected_end"] = end
        self.send_response(status)
        types = {".m3u8": "application/vnd.apple.mpegurl", ".mpd": "application/dash+xml",
                 ".ts": "video/mp2t", ".m4s": "video/iso.segment", ".vtt": "text/vtt; charset=utf-8",
                 ".srt": "application/x-subrip", ".m4a": "audio/mp4"}
        self.send_header("Content-Type", types.get(path.suffix, mimetypes.guess_type(str(path))[0] or "application/octet-stream"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-store")
        self.send_header("ETag", '"synthetic-%s-%s"' % (path.name, size))
        if status == 206:
            self.send_header("Content-Range", "bytes %s-%s/%s" % (start, end, size))
        if disconnect:
            self.send_header("Connection", "close")
        self.end_headers()
        if head:
            return
        remaining = end - start + 1
        if disconnect:
            remaining = min(remaining, 131072)
            self.observation["intentional_disconnect"] = True
        with path.open("rb") as stream:
            stream.seek(start)
            while remaining:
                chunk = stream.read(min(8192 if slow else 65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
                self.observation["body_bytes_sent"] += len(chunk)
                remaining -= len(chunk)
                if slow and remaining:
                    time.sleep(len(chunk) / 32768.0)
        if disconnect:
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    def html(self, route):
        source = "/direct.mp4"
        content_type = "video/mp4"
        if route == "/watch/hls":
            source, content_type = "/media/hls/master.m3u8", "application/vnd.apple.mpegurl"
        elif route == "/watch/dash":
            source, content_type = "/media/dash/manifest.mpd", "application/dash+xml"
        return '''<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Local synthetic download fixture</title>
<meta name="description" content="A locally generated 12-second synthetic test pattern; no third-party video.">
<body><h1>Local synthetic download fixture</h1>
<p>12 seconds · 720p/360p · H.264 + AAC · English authored captions · CC0 fixture data.</p>
<video controls preload="metadata" width="640">
<source src="%s" type="%s">
<track src="/media/captions.en.vtt" kind="subtitles" srclang="en" label="English" default>
</video>
<nav><a href="/direct.mp4">720p MP4</a> · <a href="/media/sample-360.mp4">360p MP4</a> ·
<a href="/annotated.mp4">MP4 with embedded subtitles and chapters</a> ·
<a href="/media/sample-audio.m4a">Audio</a> · <a href="/media/captions.en.srt">SRT</a> ·
<a href="/media/hls/master.m3u8">HLS master</a> · <a href="/media/dash/manifest.mpd">DASH MPD</a></nav>
<h2>Two-item link collection (no site-specific playlist extractor implied)</h2>
<ol><li><a href="/direct.mp4">Item 1: 720p</a></li><li><a href="/media/sample-360.mp4">Item 2: 360p</a></li></ol>
<p><a href="/slow.mp4">Throttled at 32 KiB/s</a> · <a href="/disconnect.mp4">Mid-response disconnect</a> ·
<a href="/missing.mp4">Fixed 404</a> · <a href="/denied.mp4">Fixed 403</a></p>
</body></html>''' % (source, content_type)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0, help="0 chooses an available ephemeral port")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be 0..65535")
    server = FixtureServer(args.port)
    base = "http://127.0.0.1:%s" % server.server_address[1]
    state = {"started_at_utc": utc(), "pid": os.getpid(), "base_url": base,
             "media_root": str(MEDIA), "log_path": str(server.log_path),
             "routes": [base + x for x in ("/", "/watch/direct", "/watch/hls", "/watch/dash", "/playlist",
                                             "/direct.mp4", "/annotated.mp4", "/slow.mp4", "/disconnect.mp4",
                                             "/missing.mp4", "/denied.mp4", "/media/hls/master.m3u8", "/media/dash/manifest.mpd")]}
    (ROOT / "server-state.json").write_text(json.dumps(state, indent=2))
    print(json.dumps(state, indent=2), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
