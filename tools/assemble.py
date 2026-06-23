#!/usr/bin/env python3
"""Assemble the transcript archive from collected metadata + transcripts.
Outputs into ARCHIVE_DIR: one .txt per video (date+title named) and an INDEX.md + manifest.json.
Faithful: transcript bodies contain only source-provided caption text. Videos without a
retrievable transcript get a file that clearly marks why."""
import json, os, re, sys

ARCHIVE = sys.argv[1] if len(sys.argv) > 1 else "/home/user/argusagent/transcripts"
SCR = os.path.dirname(os.path.abspath(__file__))

meta = json.load(open(os.path.join(SCR, "metadata.json")))
dates = json.load(open(os.path.join(SCR, "dates.json"))) if os.path.exists(os.path.join(SCR, "dates.json")) else {}
trans = json.load(open(os.path.join(SCR, "transcripts_raw.json"))) if os.path.exists(os.path.join(SCR, "transcripts_raw.json")) else {}

os.makedirs(ARCHIVE, exist_ok=True)

def sanitize(title):
    t = title or "untitled"
    t = t.replace("/", "-").replace("\\", "-")
    t = re.sub(r'[<>:"|?*\x00-\x1f]', "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = t.replace(" ", "_")
    t = re.sub(r"_+", "_", t).strip("_.")
    return t[:90] or "untitled"

def fmt_dur(secs):
    try:
        s = int(secs)
    except (TypeError, ValueError):
        return "unknown"
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return (f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}") + f" ({s}s)"

def fmt_ts(ms):
    s = int(ms) // 1000
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"

def short_date(iso):
    if not iso:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso)
    return m.group(0) if m else None

index_rows = []
manifest = []
counts = {"success": 0, "no_captions": 0, "error": 0, "empty": 0, "pending": 0}

for m in meta:
    vid = m["videoId"]
    d = dates.get(vid, {})
    pub = d.get("publishDate") or d.get("uploadDate")
    sdate = short_date(pub) or "0000-00-00"
    title = m.get("title") or d.get("title_mf") or vid
    length = m.get("lengthSeconds") or m.get("lengthMf") or d.get("lengthMf")
    kind = m.get("kind", "video")
    url = f"https://www.youtube.com/watch?v={vid}"
    tr = trans.get(vid, {})
    status = tr.get("status")

    if status == "success" and tr.get("lines"):
        lang = tr.get("lang", "en")
        capkind = tr.get("kind", "manual")
    elif m.get("playability") == "LIVE_STREAM_OFFLINE" or not m.get("captions"):
        status = status or "no_captions"
        lang = ""
        capkind = ""
    else:
        status = status or "pending"
        lang = (m.get("captions") or [{}])[0].get("lang", "")
        capkind = (m.get("captions") or [{}])[0].get("kind", "")

    counts[status] = counts.get(status, 0) + 1

    fname = f"{sdate}_{sanitize(title)}_{vid}.txt"
    path = os.path.join(ARCHIVE, fname)

    header = [
        f"Title: {title}",
        f"Upload date: {sdate if sdate != '0000-00-00' else 'unknown'}",
        f"Upload datetime: {pub or 'unknown'}",
        f"Video ID: {vid}",
        f"Source URL: {url}",
        f"Type: {kind}",
        f"Duration: {fmt_dur(length)}",
        f"Caption language: {lang or 'n/a'}",
        f"Caption kind: {capkind or 'n/a'}",
        f"Transcript status: {status}",
    ]
    body_lines = []
    if status == "success":
        lines = tr["lines"]
        header.append(f"Transcript segments: {len(lines)}")
        header.append(f"Transcript characters: {sum(len(l[1]) for l in lines)}")
        for t, txt in lines:
            body_lines.append(f"[{fmt_ts(t)}] {txt}")
    else:
        reason = tr.get("reason")
        if not reason:
            if m.get("playability") == "LIVE_STREAM_OFFLINE":
                reason = "Live stream offline / has not aired; no captions available."
            elif not m.get("captions"):
                reason = "No caption tracks published for this video."
            else:
                reason = "Transcript not yet retrieved."
        body_lines.append(f"[NO TRANSCRIPT] {reason}")
        body_lines.append("")
        body_lines.append("This file is a placeholder. No caption text was fabricated.")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(header))
        f.write("\n" + "=" * 60 + "\n\n")
        f.write("\n".join(body_lines))
        f.write("\n")

    index_rows.append({
        "date": sdate, "title": title, "vid": vid, "kind": kind,
        "status": status, "lang": lang, "length": length, "file": fname,
        "segments": tr.get("n_lines", "") if status == "success" else "",
    })
    manifest.append({
        "videoId": vid, "title": title, "uploadDate": sdate, "uploadDatetime": pub,
        "type": kind, "lengthSeconds": length, "url": url,
        "captionLanguage": lang, "captionKind": capkind,
        "transcriptStatus": status, "segments": tr.get("n_lines"),
        "characters": tr.get("chars"), "file": fname,
        "reason": tr.get("reason"),
    })

# sort by date then title
index_rows.sort(key=lambda r: (r["date"], r["title"].lower()))
manifest.sort(key=lambda r: (r["uploadDate"], (r["title"] or "").lower()))

json.dump(manifest, open(os.path.join(ARCHIVE, "manifest.json"), "w"), indent=1, ensure_ascii=False)

# INDEX.md
total = len(meta)
with open(os.path.join(ARCHIVE, "INDEX.md"), "w", encoding="utf-8") as f:
    f.write("# Navellier Market Buzz — Transcript Archive\n\n")
    f.write(f"- **Channel:** Navellier Market Buzz (`UCqm9Z0DfGXZ8oMF70ic3B1A`)\n")
    f.write(f"- **Channel URL:** https://www.youtube.com/@navelliermarketbuzz\n")
    f.write(f"- **Total videos accounted for:** {total}\n")
    f.write(f"- **Transcripts archived (success):** {counts.get('success',0)}\n")
    f.write(f"- **No captions available:** {counts.get('no_captions',0)}\n")
    f.write(f"- **Pending/error:** {counts.get('pending',0)+counts.get('error',0)+counts.get('empty',0)}\n")
    f.write(f"- **Date range:** {index_rows[0]['date']} → {index_rows[-1]['date']}\n\n")
    f.write("Status legend: `success` = real caption text saved · `no_captions` = none published "
            "(e.g. offline live stream) · `pending`/`error` = could not retrieve (see reason in file).\n\n")
    f.write("| # | Upload date | Title | Type | Status | Lang | Len(s) | Segments | File |\n")
    f.write("|---|---|---|---|---|---|---|---|---|\n")
    for i, r in enumerate(index_rows, 1):
        safe_title = r["title"].replace("|", "\\|")
        f.write(f"| {i} | {r['date']} | {safe_title} | {r['kind']} | {r['status']} | {r['lang']} | {r['length'] or ''} | {r['segments']} | `{r['file']}` |\n")

print("Assembled archive at", ARCHIVE)
print("counts:", counts, "total:", total)
