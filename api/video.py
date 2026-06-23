"""GET /api/video?id=<videoId> -> {videoId, title, publishDate, lengthSeconds,
viewCount, category, isShort, status, captionLang, captionKind, lines:[[ms,text]]}

One video's metadata + faithful transcript. Short-lived (a few seconds)."""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(__file__))
import _engine  # noqa: E402

_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        vid = (q.get("id", [""])[0] or "").strip()
        if not _ID.match(vid):
            return self._json(400, {"error": "valid video id required"})
        try:
            rec = _engine.fetch_video(vid)
            self._json(200, rec)
        except Exception:
            # never fail the whole job for one video
            self._json(200, {"videoId": vid, "url": f"https://www.youtube.com/watch?v={vid}",
                             "status": "error", "reason": "fetch failed", "lines": []})

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
