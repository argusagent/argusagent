"""GET /api/resolve?channel=<url|@handle|UC id> -> {channelId, title}"""
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
        channel = (q.get("channel", [""])[0] or "").strip()
        try:
            cid, title = _engine.resolve_channel(channel)
            self._json(200, {"channelId": cid, "title": title})
        except ValueError as e:
            self._json(400, {"error": str(e)})
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
