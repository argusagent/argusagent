"""InnerTube + timedtext client (pure stdlib).

Reuses the proven approach from the original archiving tool: enumerate a channel
with the public WEB InnerTube client, then fetch captions with the ANDROID_VR
player (which returns working timedtext baseUrls), and exact upload dates with a
WEB player call that carries a visitorData token.

Honest/faithful by design: only source-provided caption text is ever returned;
videos without captions are reported as such, never fabricated.
"""
import json
import os
import ssl
import time
import html
import threading
import urllib.request
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET

ALLOWED_HOSTS = {"www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"}

KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"  # public InnerTube web key
_CA = "/root/.ccr/ca-bundle.crt"

# Channel-independent tab params (base64). Used to page each section of a channel.
TAB_PARAMS = {
    "videos": "EgZ2aWRlb3PyBgQKAjoA",
    "shorts": "EgZzaG9ydHPyBgUKA5oBAA%3D%3D",
    "streams": "EgdzdHJlYW1z8gYECgJ6AA%3D%3D",
}

WEB_CLIENT = {"clientName": "WEB", "clientVersion": "2.20240726.00.00", "hl": "en", "gl": "US"}


def _opener():
    proxy = os.environ.get("HTTPS_PROXY")
    handlers = []
    if os.path.exists(_CA):
        ctx = ssl.create_default_context(cafile=_CA)
    else:
        ctx = ssl.create_default_context()
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    handlers.append(urllib.request.HTTPSHandler(context=ctx))
    return urllib.request.build_opener(*handlers)


def post(path, body, retries=4, timeout=60):
    """POST to the InnerTube API. A fresh opener per call keeps this thread-safe."""
    url = f"https://youtubei.googleapis.com/youtubei/v1/{path}?key={KEY}&prettyPrint=false"
    data = json.dumps(body).encode()
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(
                url, data=data,
                headers={"Content-Type": "application/json",
                         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            with _opener().open(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry transient errors
            last = e
            if i == retries - 1:
                raise
            time.sleep(2 ** i)
    raise last


def http_get(url, timeout=40, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with _opener().open(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - retry transient network errors
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


# ---------------------------------------------------------------- visitor data
_VISITOR = {"token": None}
_VISITOR_LOCK = threading.Lock()


def visitor_data():
    if _VISITOR["token"]:
        return _VISITOR["token"]
    with _VISITOR_LOCK:
        if _VISITOR["token"]:
            return _VISITOR["token"]
        b = post("browse", {"context": {"client": WEB_CLIENT},
                            "browseId": "UCBR8-60-B28hp2BmDPdntcQ"})  # YouTube's own channel
        _VISITOR["token"] = b.get("responseContext", {}).get("visitorData")
    return _VISITOR["token"]


# ------------------------------------------------------------------- resolution
def resolve_channel(url_or_handle):
    """Resolve a channel URL / @handle / UC id to (channelId, channelTitle).

    Only YouTube hosts are accepted for full URLs (defense-in-depth: this keeps
    the resolver from being pointed at arbitrary hosts)."""
    s = (url_or_handle or "").strip()
    if not s:
        raise ValueError("Please enter a channel URL, @handle, or channel id.")
    if len(s) > 2048:
        raise ValueError("Input is too long.")
    # direct UC id
    if s.startswith("UC") and len(s) >= 20 and "/" not in s and " " not in s:
        cid = s
    else:
        if s.startswith("http://") or s.startswith("https://"):
            host = (urllib.parse.urlparse(s).hostname or "").lower()
            if host not in ALLOWED_HOSTS:
                raise ValueError("Please enter a YouTube channel URL, @handle, or UC… id.")
        elif s.startswith("@"):
            s = "https://www.youtube.com/" + s
        else:
            # bare handle or name
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
            ep = r.get("endpoint", {})
            cid = ep.get("browseEndpoint", {}).get("browseId")
    # A YouTube channel id is always "UC" + 22 chars. Reject anything else
    # (e.g. a playlist or video URL that resolved to a non-channel browseId).
    if not (cid and cid.startswith("UC") and len(cid) == 24):
        raise ValueError(f"That doesn't look like a channel: {url_or_handle!r}. "
                         "Enter a channel URL, @handle, or UC… id (not a video or playlist).")
    # fetch the channel header for a human title
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
    """Pull candidate video IDs out of a channel/tab browse response."""
    ids = []
    seen = set()

    def add(vid):
        if vid and vid not in seen:
            seen.add(vid)
            ids.append(vid)

    lvs = []
    walk_find(res, "lockupViewModel", lvs)
    for lv in lvs:
        if lv.get("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO" and lv.get("contentId"):
            add(lv["contentId"])
    sls = []
    walk_find(res, "shortsLockupViewModel", sls)
    for sl in sls:
        ent = sl.get("entityId", "")  # e.g. "shorts-shelf-item-<videoId>"
        cand = sl.get("onTap", {}).get("innertubeCommand", {}).get("reelWatchEndpoint", {}).get("videoId")
        if not cand and ent:
            cand = ent.split("-")[-1]
        add(cand)
    for key in ("videoRenderer", "richItemRenderer", "playlistVideoRenderer", "reelItemRenderer", "gridVideoRenderer"):
        rs = []
        walk_find(res, key, rs)
        for r in rs:
            add(r.get("videoId"))
    return ids


def _continuation_token(res):
    toks = []
    walk_find(res, "continuationItemRenderer", toks)
    for t in toks:
        tok = t.get("continuationEndpoint", {}).get("continuationCommand", {}).get("token")
        if tok:
            return tok
    return None


def enumerate_channel(channel_id, progress=None, max_videos=None):
    """Return an ordered, de-duplicated list of video IDs across the channel's
    Videos, Shorts and Streams tabs. `progress(found:int)` is called as we go."""
    all_ids = []
    seen = set()

    def add_many(ids):
        for v in ids:
            if v and v not in seen:
                seen.add(v)
                all_ids.append(v)
        if progress:
            progress(len(all_ids))

    for tab, params in TAB_PARAMS.items():
        try:
            res = post("browse", {"context": {"client": WEB_CLIENT}, "browseId": channel_id, "params": params})
        except Exception:
            continue
        add_many(_ids_from_response(res))
        tok = _continuation_token(res)
        guard = 0
        while tok and guard < 200:
            guard += 1
            if max_videos and len(all_ids) >= max_videos:
                break
            try:
                res = post("browse", {"context": {"client": WEB_CLIENT}, "continuation": tok})
            except Exception:
                break
            before = len(all_ids)
            add_many(_ids_from_response(res))
            ntok = _continuation_token(res)
            if ntok == tok or (len(all_ids) == before and ntok is None):
                break
            tok = ntok
        if max_videos and len(all_ids) >= max_videos:
            break
    if max_videos:
        all_ids = all_ids[:max_videos]
    return all_ids


# ---------------------------------------------------------------------- players
def android_vr_player(vid):
    cl = {"clientName": "ANDROID_VR", "clientVersion": "1.60.19", "androidSdkVersion": 32,
          "hl": "en", "gl": "US", "visitorData": visitor_data()}
    return post("player", {"context": {"client": cl}, "videoId": vid,
                           "contentCheckOk": True, "racyCheckOk": True})


def web_player(vid):
    cl = dict(WEB_CLIENT, visitorData=visitor_data())
    return post("player", {"context": {"client": cl}, "videoId": vid,
                           "contentCheckOk": True, "racyCheckOk": True})


def pick_track(tracks):
    def score(t):
        lang = t.get("languageCode") or ""
        return (lang.startswith("en"), t.get("kind") != "asr")
    return sorted(tracks, key=score, reverse=True)[0] if tracks else None


def parse_captions(raw):
    """json3 first, then the timedtext format=3 XML (<p>/<s>) and srv1 (<text>)."""
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
                    lines.append((ev.get("tStartMs", 0), txt))
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
            lines.append((t, txt))
    if lines:
        return lines
    for tx in root.findall(".//text"):
        try:
            t = int(float(tx.get("start", "0")) * 1000)
        except ValueError:
            t = 0
        txt = html.unescape((tx.text or "").strip())
        if txt:
            lines.append((t, txt))
    return lines


def fetch_video(vid):
    """Fetch metadata + transcript for one video. Returns a dict; never raises for
    a missing transcript (status reflects what happened)."""
    rec = {"videoId": vid, "url": f"https://www.youtube.com/watch?v={vid}"}
    try:
        pa = android_vr_player(vid)
    except Exception as e:
        rec["status"] = "error"
        rec["reason"] = repr(e)[:160]
        return rec
    vd = pa.get("videoDetails", {})
    rec["title"] = vd.get("title") or vid
    rec["lengthSeconds"] = vd.get("lengthSeconds")
    rec["viewCount"] = vd.get("viewCount")
    rec["channelId"] = vd.get("channelId")
    rec["author"] = vd.get("author")
    rec["isShort"] = (vd.get("lengthSeconds") or "999").isdigit() and int(vd.get("lengthSeconds") or 999) <= 60

    # exact upload date via WEB+visitorData microformat (best effort)
    try:
        pw = web_player(vid)
        mf = pw.get("microformat", {}).get("playerMicroformatRenderer", {})
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
        raw = http_get(base + ("&" if "?" in base else "?") + "fmt=json3")
        lines = parse_captions(raw)
        if not lines:
            lines = parse_captions(http_get(base))
    except Exception as e:
        rec["status"] = "error"
        rec["reason"] = repr(e)[:160]
        rec["lines"] = []
        return rec
    rec["lines"] = lines
    rec["status"] = "success" if lines else "empty"
    if not lines:
        rec["reason"] = "Caption track present but empty/unparseable."
    return rec
