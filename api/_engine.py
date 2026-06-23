"""Self-contained InnerTube + timedtext engine for the Vercel serverless functions.

Each function is short-lived: resolve a channel, return one page of video ids, or
fetch one video's metadata + transcript. The browser orchestrates these calls and
assembles the zip client-side, so nothing here needs to run longer than a few
seconds — a good fit for serverless time limits.

Faithful by design: only source-provided caption text is returned; videos without
captions are reported as such, never fabricated.
"""
import base64
import html
import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"  # public InnerTube web key
_CA = "/root/.ccr/ca-bundle.crt"  # present only in the dev sandbox; ignored elsewhere
ALLOWED_HOSTS = {"www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"}
WEB_CLIENT = {"clientName": "WEB", "clientVersion": "2.20240726.00.00", "hl": "en", "gl": "US"}
TABS = [
    ("videos", "EgZ2aWRlb3PyBgQKAjoA"),
    ("shorts", "EgZzaG9ydHPyBgUKA5oBAA%3D%3D"),
    ("streams", "EgdzdHJlYW1z8gYECgJ6AA%3D%3D"),
]


def _opener():
    proxy = os.environ.get("HTTPS_PROXY")
    ctx = ssl.create_default_context(cafile=_CA) if os.path.exists(_CA) else ssl.create_default_context()
    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    handlers.append(urllib.request.HTTPSHandler(context=ctx))
    return urllib.request.build_opener(*handlers)


def post(path, body, retries=3, timeout=20):
    url = f"https://youtubei.googleapis.com/youtubei/v1/{path}?key={KEY}&prettyPrint=false"
    data = json.dumps(body).encode()
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with _opener().open(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            last = e
            if i == retries - 1:
                raise
            time.sleep(2 ** i)
    raise last


def http_get(url, retries=3, timeout=20):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with _opener().open(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            if i == retries - 1:
                raise
            time.sleep(2 ** i)
    raise last


def walk_find(obj, key, out):
    if isinstance(obj, dict):
        if key in obj:
            out.append(obj[key])
        for v in obj.values():
            walk_find(v, key, out)
    elif isinstance(obj, list):
        for x in obj:
            walk_find(x, key, out)


_VISITOR = {"t": None}
_VLOCK = threading.Lock()


def visitor_data():
    if _VISITOR["t"]:
        return _VISITOR["t"]
    with _VLOCK:
        if not _VISITOR["t"]:
            b = post("browse", {"context": {"client": WEB_CLIENT}, "browseId": "UCBR8-60-B28hp2BmDPdntcQ"})
            _VISITOR["t"] = b.get("responseContext", {}).get("visitorData")
    return _VISITOR["t"]


# ----------------------------------------------------------------- resolution
def resolve_channel(url_or_handle):
    s = (url_or_handle or "").strip()
    if not s:
        raise ValueError("Please enter a channel URL, @handle, or channel id.")
    if len(s) > 2048:
        raise ValueError("Input is too long.")
    if s.startswith("UC") and len(s) == 24 and "/" not in s and " " not in s:
        cid = s
    else:
        if s.startswith("http://") or s.startswith("https://"):
            host = (urllib.parse.urlparse(s).hostname or "").lower()
            if host not in ALLOWED_HOSTS:
                raise ValueError("Please enter a YouTube channel URL, @handle, or UC… id.")
        elif s.startswith("@"):
            s = "https://www.youtube.com/" + s
        else:
            s = "https://www.youtube.com/@" + s.lstrip("/")
        if "/channel/" in s:
            cid = s.split("/channel/")[1].split("/")[0].split("?")[0]
        else:
            try:
                r = post("navigation/resolve_url", {"context": {"client": WEB_CLIENT}, "url": s})
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):
                    raise ValueError(f"Channel not found: {url_or_handle!r}. "
                                     "Check the URL/@handle, or paste the UC… channel id.")
                raise
            cid = r.get("endpoint", {}).get("browseEndpoint", {}).get("browseId")
    if not (cid and cid.startswith("UC") and len(cid) == 24):
        raise ValueError(f"That doesn't look like a channel: {url_or_handle!r}. "
                         "Enter a channel URL, @handle, or UC… id (not a video or playlist).")
    title = cid
    try:
        b = post("browse", {"context": {"client": WEB_CLIENT}, "browseId": cid})
        meta = []
        walk_find(b, "pageHeaderViewModel", meta)
        if meta:
            t = meta[0].get("title", {}).get("dynamicTextViewModel", {}).get("text", {}).get("content")
            if t:
                title = t
        if title == cid:
            md = []
            walk_find(b, "c4TabbedHeaderRenderer", md)
            if md and md[0].get("title"):
                title = md[0]["title"]
    except Exception:
        pass
    return cid, title


def _ids_from_response(res):
    ids, seen = [], set()

    def add(v):
        if v and v not in seen:
            seen.add(v)
            ids.append(v)

    lvs = []
    walk_find(res, "lockupViewModel", lvs)
    for lv in lvs:
        if lv.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO":
            add(lv.get("contentId"))
    sls = []
    walk_find(res, "shortsLockupViewModel", sls)
    for sl in sls:
        cand = sl.get("onTap", {}).get("innertubeCommand", {}).get("reelWatchEndpoint", {}).get("videoId")
        if not cand and sl.get("entityId"):
            cand = sl["entityId"].split("-")[-1]
        add(cand)
    for key in ("videoRenderer", "richItemRenderer", "playlistVideoRenderer", "reelItemRenderer", "gridVideoRenderer"):
        rs = []
        walk_find(res, key, rs)
        for r in rs:
            add(r.get("videoId"))
    return ids


def _continuation(res):
    toks = []
    walk_find(res, "continuationItemRenderer", toks)
    for t in toks:
        tok = t.get("continuationEndpoint", {}).get("continuationCommand", {}).get("token")
        if tok:
            return tok
    return None


def _encode_cursor(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).decode()


def _decode_cursor(c):
    if not c:
        return {"ti": 0, "tok": None}
    try:
        return json.loads(base64.urlsafe_b64decode(c.encode()).decode())
    except Exception:
        return {"ti": 0, "tok": None}


def enumerate_page(channel_id, cursor):
    """Return (ids, next_cursor). One InnerTube browse call per page; the cursor
    walks the Videos -> Shorts -> Streams tabs. next_cursor is None when done."""
    st = _decode_cursor(cursor)
    ti, tok = st.get("ti", 0), st.get("tok")
    if ti >= len(TABS):
        return [], None
    tab_name, params = TABS[ti]
    try:
        if tok:
            res = post("browse", {"context": {"client": WEB_CLIENT}, "continuation": tok})
        else:
            res = post("browse", {"context": {"client": WEB_CLIENT}, "browseId": channel_id, "params": params})
    except Exception:
        # skip a broken/absent tab, advance to the next
        nxt = {"ti": ti + 1, "tok": None}
        return [], (_encode_cursor(nxt) if ti + 1 < len(TABS) else None)
    ids = _ids_from_response(res)
    ntok = _continuation(res)
    if ntok and ntok != tok:
        nxt = {"ti": ti, "tok": ntok}
    else:
        nxt = {"ti": ti + 1, "tok": None}
    next_cursor = _encode_cursor(nxt) if nxt["ti"] < len(TABS) else None
    return ids, next_cursor


# --------------------------------------------------------------------- players
def android_vr_player(vid):
    cl = {"clientName": "ANDROID_VR", "clientVersion": "1.60.19", "androidSdkVersion": 32,
          "hl": "en", "gl": "US", "visitorData": visitor_data()}
    return post("player", {"context": {"client": cl}, "videoId": vid, "contentCheckOk": True, "racyCheckOk": True})


def web_player(vid):
    cl = dict(WEB_CLIENT, visitorData=visitor_data())
    return post("player", {"context": {"client": cl}, "videoId": vid, "contentCheckOk": True, "racyCheckOk": True})


def pick_track(tracks):
    def score(t):
        lang = t.get("languageCode") or ""
        return (lang.startswith("en"), t.get("kind") != "asr")
    return sorted(tracks, key=score, reverse=True)[0] if tracks else None


def parse_captions(raw):
    head = raw[:64].lstrip()
    if head[:1] in (b"{", b"["):
        try:
            data = json.loads(raw)
            lines = []
            for ev in data.get("events", []):
                segs = ev.get("segs")
                if not segs:
                    continue
                txt = "".join(s.get("utf8", "") for s in segs).strip("\n")
                if txt.strip():
                    lines.append([ev.get("tStartMs", 0), txt])
            if lines:
                return lines
        except Exception:
            pass
    try:
        root = ET.fromstring(raw)
    except Exception:
        return []
    lines = []
    body = root.find("body")
    for p in (body.findall("p") if body is not None else []):
        try:
            t = int(p.get("t", "0"))
        except ValueError:
            t = 0
        parts = []
        if p.text:
            parts.append(p.text)
        for s in p:
            if s.text:
                parts.append(s.text)
            if s.tail:
                parts.append(s.tail)
        txt = "".join(parts).strip()
        if txt:
            lines.append([t, txt])
    if lines:
        return lines
    for tx in root.findall(".//text"):
        try:
            t = int(float(tx.get("start", "0")) * 1000)
        except ValueError:
            t = 0
        txt = html.unescape((tx.text or "").strip())
        if txt:
            lines.append([t, txt])
    return lines


def fetch_video(vid):
    rec = {"videoId": vid, "url": f"https://www.youtube.com/watch?v={vid}"}
    try:
        pa = android_vr_player(vid)
    except Exception as e:
        return {**rec, "status": "error", "reason": repr(e)[:160], "lines": []}
    vd = pa.get("videoDetails", {})
    ls = vd.get("lengthSeconds")
    rec.update({
        "title": vd.get("title") or vid,
        "lengthSeconds": ls,
        "viewCount": vd.get("viewCount"),
        "channelId": vd.get("channelId"),
        "isShort": (ls or "999").isdigit() and int(ls or 999) <= 60,
    })
    try:
        mf = web_player(vid).get("microformat", {}).get("playerMicroformatRenderer", {})
        rec["publishDate"] = mf.get("publishDate")
        rec["uploadDate"] = mf.get("uploadDate")
        rec["category"] = mf.get("category")
    except Exception:
        rec["publishDate"] = rec["uploadDate"] = rec["category"] = None

    status = pa.get("playabilityStatus", {}).get("status")
    ct = pa.get("captions", {}).get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
    if not ct:
        rec["status"] = "no_captions"
        rec["reason"] = ("Live stream offline / not yet aired." if status == "LIVE_STREAM_OFFLINE"
                         else "No caption tracks published for this video.")
        rec["lines"] = []
        return rec
    track = pick_track(ct)
    rec["captionLang"] = track.get("languageCode")
    rec["captionKind"] = track.get("kind", "manual")
    base = track["baseUrl"]
    try:
        lines = parse_captions(http_get(base + ("&" if "?" in base else "?") + "fmt=json3"))
        if not lines:
            lines = parse_captions(http_get(base))
    except Exception as e:
        return {**rec, "status": "error", "reason": repr(e)[:160], "lines": []}
    rec["lines"] = lines
    rec["status"] = "success" if lines else "empty"
    if not lines:
        rec["reason"] = "Caption track present but empty/unparseable."
    return rec
