#!/usr/bin/env python3
"""YouTube Channel Transcript Scraper — local web app (pure stdlib).

Run:  python3 server.py            (then open http://127.0.0.1:8000)
      PORT=9000 python3 server.py

A single dependency-free HTTP server: serves the UI, runs scrape jobs in
background threads, exposes job status for the progress bar, and streams the
finished zip for download. Faithful by design — only real captions are saved.
"""
import json
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from core import pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
OUT_ROOT = os.environ.get("OUTPUT_DIR", os.path.join(HERE, "output"))
os.makedirs(OUT_ROOT, exist_ok=True)

JOBS = {}
JOBS_LOCK = threading.Lock()


def _new_job():
    jid = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[jid] = {"phase": "queued", "percent": 0, "message": "Queued…"}
    return jid


def _update(jid, data):
    with JOBS_LOCK:
        if jid in JOBS:
            JOBS[jid].update(data)


def _run_job(jid, channel, max_videos):
    pipeline.run(channel, OUT_ROOT,
                 progress=lambda d: _update(jid, d),
                 max_videos=max_videos)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json")

    # ---------------------------------------------------------------- routing
    def do_GET(self):
        p = urlparse(self.path)
        route = p.path
        if route == "/" or route == "/index.html":
            return self._file("index.html", "text/html; charset=utf-8")
        if route == "/app.js":
            return self._file("app.js", "application/javascript; charset=utf-8")
        if route == "/style.css":
            return self._file("style.css", "text/css; charset=utf-8")
        if route == "/api/status":
            jid = parse_qs(p.query).get("job", [""])[0]
            with JOBS_LOCK:
                st = dict(JOBS.get(jid, {})) if jid in JOBS else None
            if st is None:
                return self._json(404, {"error": "unknown job"})
            st.pop("zip_path", None)  # don't leak server paths
            st["ready"] = st.get("phase") == "done"
            return self._json(200, st)
        if route == "/api/download":
            jid = parse_qs(p.query).get("job", [""])[0]
            with JOBS_LOCK:
                st = dict(JOBS.get(jid, {})) if jid in JOBS else {}
            zp = st.get("zip_path")
            if not zp or not os.path.exists(zp):
                return self._json(404, {"error": "not ready"})
            data = open(zp, "rb").read()
            return self._send(200, data, "application/zip",
                              {"Content-Disposition": f'attachment; filename="{os.path.basename(zp)}"'})
        return self._json(404, {"error": "not found"})

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        p = urlparse(self.path)
        if p.path != "/api/scrape":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "invalid JSON"})
        channel = (payload.get("channel") or "").strip()
        if not channel:
            return self._json(400, {"error": "channel is required"})
        max_videos = payload.get("max_videos")
        try:
            max_videos = int(max_videos) if max_videos else None
        except (TypeError, ValueError):
            max_videos = None
        jid = _new_job()
        threading.Thread(target=_run_job, args=(jid, channel, max_videos), daemon=True).start()
        return self._json(200, {"job": jid})

    # ----------------------------------------------------------------- static
    def _file(self, name, ctype):
        fp = os.path.join(STATIC, name)
        if not os.path.exists(fp):
            return self._json(404, {"error": "not found"})
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)


def main():
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "127.0.0.1")
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"YouTube Transcript Scraper running at http://{host}:{port}")
    print(f"Output zips are written to: {OUT_ROOT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        srv.shutdown()


if __name__ == "__main__":
    main()
