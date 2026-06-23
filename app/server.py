#!/usr/bin/env python3
"""Channel Transcript Scraper — web app (pure Python standard library).

Run:  python3 server.py            (then open http://127.0.0.1:8000)

Design notes / safety:
- Jobs run in background threads with a concurrency cap; excess requests get 429.
- Each job writes to its own output dir; finished jobs + zips are reaped after a TTL.
- User input is length/host/value-capped; unexpected errors are logged server-side
  and shown to the client only as a generic message.
- Security headers (CSP, nosniff, no-frame, no-referrer) on every response.
- Optional ACCESS_TOKEN gate for the /api/* endpoints when exposed publicly.
- Only faithful, source-provided captions are ever written.
"""
import json
import os
import shutil
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

from core import pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
OUT_ROOT = os.environ.get("OUTPUT_DIR", os.path.join(HERE, "output"))
os.makedirs(OUT_ROOT, exist_ok=True)

# ----- tunables (env-overridable) -------------------------------------------
MAX_VIDEOS = int(os.environ.get("MAX_VIDEOS", "2000"))          # hard per-job cap
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT_JOBS", "2"))
JOB_TTL = int(os.environ.get("JOB_TTL_SECONDS", "1800"))        # reap finished jobs
WORKERS = int(os.environ.get("WORKERS", "6"))
MAX_BODY = 16 * 1024
ACCESS_TOKEN = os.environ.get("ACCESS_TOKEN")                   # optional gate

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"),
}

JOBS = {}
JOBS_LOCK = threading.Lock()


def _running_count():
    return sum(1 for j in JOBS.values() if j.get("phase") not in ("done", "error"))


def _new_job():
    jid = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[jid] = {"phase": "queued", "percent": 0, "message": "Queued…",
                     "created": time.time(), "dir": os.path.join(OUT_ROOT, jid)}
    return jid


def _update(jid, data):
    with JOBS_LOCK:
        if jid in JOBS:
            JOBS[jid].update(data)
            if data.get("phase") in ("done", "error"):
                JOBS[jid]["finished"] = time.time()


def _run_job(jid, channel, max_videos):
    job_dir = JOBS[jid]["dir"]
    os.makedirs(job_dir, exist_ok=True)
    pipeline.run(channel, job_dir, progress=lambda d: _update(jid, d),
                 max_videos=max_videos, workers=WORKERS)


def _reaper():
    while True:
        time.sleep(60)
        now = time.time()
        stale = []
        with JOBS_LOCK:
            for jid, j in list(JOBS.items()):
                fin = j.get("finished")
                if fin and now - fin > JOB_TTL:
                    stale.append((jid, j.get("dir")))
                    del JOBS[jid]
        for jid, d in stale:
            if d and os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "TranscriptScraper"

    def log_message(self, *a):
        pass

    # ------------------------------------------------------------- responders
    def _headers(self, code, ctype, length, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self._headers(code, ctype, len(body), extra)
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json",
                   {"Cache-Control": "no-store"})

    def _authed(self):
        if not ACCESS_TOKEN:
            return True
        tok = self.headers.get("X-Access-Token")
        if not tok:
            tok = parse_qs(urlparse(self.path).query).get("token", [""])[0]
        return tok == ACCESS_TOKEN

    # -------------------------------------------------------------------- GET
    def do_GET(self):
        p = urlparse(self.path)
        route = p.path
        if route in ("/", "/index.html"):
            return self._file("index.html", "text/html; charset=utf-8")
        if route == "/app.js":
            return self._file("app.js", "application/javascript; charset=utf-8")
        if route == "/style.css":
            return self._file("style.css", "text/css; charset=utf-8")
        if route == "/healthz":
            return self._json(200, {"ok": True})

        if route.startswith("/api/"):
            if not self._authed():
                return self._json(401, {"error": "unauthorized"})
            if route == "/api/status":
                return self._status(p)
            if route == "/api/download":
                return self._download(p)
        return self._json(404, {"error": "not found"})

    def do_HEAD(self):
        self.do_GET()

    def _status(self, p):
        jid = parse_qs(p.query).get("job", [""])[0]
        with JOBS_LOCK:
            st = dict(JOBS.get(jid, {})) if jid in JOBS else None
        if st is None:
            return self._json(404, {"error": "unknown or expired job"})
        for k in ("zip_path", "dir", "created", "finished"):
            st.pop(k, None)
        st["ready"] = st.get("phase") == "done"
        return self._json(200, st)

    def _download(self, p):
        jid = parse_qs(p.query).get("job", [""])[0]
        with JOBS_LOCK:
            j = dict(JOBS.get(jid, {})) if jid in JOBS else {}
        zp = j.get("zip_path")
        if not zp or not os.path.exists(zp):
            return self._json(404, {"error": "not ready or expired"})
        stats = (j.get("stats") or {})
        ascii_name = stats.get("zipNameAscii") or "transcripts.zip"
        utf8_name = stats.get("zipName") or ascii_name
        disp = (f'attachment; filename="{ascii_name}"; '
                f"filename*=UTF-8''{quote(utf8_name)}")
        size = os.path.getsize(zp)
        if self.command == "HEAD":
            return self._headers(200, "application/zip", size,
                                 {"Content-Disposition": disp, "Cache-Control": "no-store"})
        self._headers(200, "application/zip", size,
                      {"Content-Disposition": disp, "Cache-Control": "no-store"})
        try:
            with open(zp, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ------------------------------------------------------------------- POST
    def do_POST(self):
        p = urlparse(self.path)
        if p.path != "/api/scrape":
            return self._json(404, {"error": "not found"})
        if not self._authed():
            return self._json(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY:
            return self._json(413, {"error": "payload too large"})
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"error": "invalid JSON"})
        channel = (payload.get("channel") or "").strip()
        if not channel:
            return self._json(400, {"error": "A channel URL, @handle, or id is required."})
        if len(channel) > 2048:
            return self._json(400, {"error": "Channel input is too long."})

        max_videos = payload.get("max_videos")
        try:
            max_videos = int(max_videos) if max_videos not in (None, "", 0) else None
        except (TypeError, ValueError):
            return self._json(400, {"error": "Limit must be a number."})
        if max_videos is not None and max_videos < 1:
            return self._json(400, {"error": "Limit must be at least 1."})
        # always apply the server hard cap
        max_videos = min(max_videos, MAX_VIDEOS) if max_videos else MAX_VIDEOS

        with JOBS_LOCK:
            running = _running_count()
        if running >= MAX_CONCURRENT:
            return self._json(429, {"error": "The server is busy with other scrapes. "
                                             "Please try again in a minute."})

        jid = _new_job()
        threading.Thread(target=_run_job, args=(jid, channel, max_videos), daemon=True).start()
        return self._json(200, {"job": jid})

    # ----------------------------------------------------------------- static
    def _file(self, name, ctype):
        fp = os.path.normpath(os.path.join(STATIC, name))
        if not fp.startswith(STATIC) or not os.path.exists(fp):
            return self._json(404, {"error": "not found"})
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)


def main():
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "127.0.0.1")
    threading.Thread(target=_reaper, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"Channel Transcript Scraper on http://{host}:{port}")
    print(f"Output dir: {OUT_ROOT} | max_videos/job: {MAX_VIDEOS} | "
          f"concurrent jobs: {MAX_CONCURRENT} | auth: {'on' if ACCESS_TOKEN else 'off'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        srv.shutdown()


if __name__ == "__main__":
    main()
