"""GET /api/enumerate?channelId=UC..&cursor=<opaque> -> {ids:[...], cursor: <next|null>}

One InnerTube page per call; the cursor walks the channel's Videos/Shorts/Streams
tabs. The browser loops until cursor is null."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(__file__))
import _engine  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        cid = (q.get("channelId", [""])[0] or "").strip()
        cursor = q.get("cursor", [""])[0] or None
        if not (cid.startswith("UC") and len(cid) == 24):
            return self._json(400, {"error": "valid channelId required"})
        try:
            ids, nxt = _engine.enumerate_page(cid, cursor)
            self._json(200, {"ids": ids, "cursor": nxt})
        except Exception:
            self._json(502, {"error": "Could not reach YouTube. Please try again."})

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
