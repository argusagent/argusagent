"""Turn fetched video records into an upload-ready, compressed package.

Output zip layout:
  <Channel>/
    README.md                      - what this is + a ready-to-paste analysis prompt
    INDEX.md                       - sortable table of every video
    manifest.json                  - machine-readable metadata
    ALL_TRANSCRIPTS_chronological.md - every transcript, date order (single-file upload)
    chunks/part_001.md ...         - the same, split into chat-sized pieces
    transcripts_by_year/<YYYY>/<date_title_id>.txt
"""
import json
import os
import re
import shutil
import zipfile

CHUNK_CHARS = 300_000  # ~chat-friendly size per chunk file


def sanitize(name, maxlen=90):
    t = (name or "untitled").replace("/", "-").replace("\\", "-")
    t = re.sub(r'[<>:"|?*\x00-\x1f]', "", t)
    t = re.sub(r"\s+", " ", t).strip().replace(" ", "_")
    t = re.sub(r"_+", "_", t).strip("_.")
    return t[:maxlen] or "untitled"


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


def _short_date(rec):
    iso = rec.get("publishDate") or rec.get("uploadDate")
    if iso:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso)
        if m:
            return m.group(0)
    return "0000-00-00"


def _video_text(rec):
    sdate = _short_date(rec)
    header = [
        f"Title: {rec.get('title')}",
        f"Upload date: {sdate if sdate != '0000-00-00' else 'unknown'}",
        f"Upload datetime: {rec.get('publishDate') or rec.get('uploadDate') or 'unknown'}",
        f"Video ID: {rec['videoId']}",
        f"Source URL: {rec['url']}",
        f"Type: {'short' if rec.get('isShort') else 'video'}",
        f"Duration: {fmt_dur(rec.get('lengthSeconds'))}",
        f"View count: {rec.get('viewCount') or 'n/a'}",
        f"Category: {rec.get('category') or 'n/a'}",
        f"Caption language: {rec.get('captionLang') or 'n/a'}",
        f"Caption kind: {rec.get('captionKind') or 'n/a'}",
        f"Transcript status: {rec.get('status')}",
    ]
    body = []
    if rec.get("status") == "success" and rec.get("lines"):
        header.append(f"Transcript segments: {len(rec['lines'])}")
        header.append(f"Transcript characters: {sum(len(t) for _, t in rec['lines'])}")
        for t, txt in rec["lines"]:
            body.append(f"[{fmt_ts(t)}] {txt}")
    else:
        body.append(f"[NO TRANSCRIPT] {rec.get('reason', 'Transcript not available.')}")
        body.append("")
        body.append("This file is a placeholder. No caption text was fabricated.")
    return "\n".join(header) + "\n" + "=" * 60 + "\n\n" + "\n".join(body) + "\n"


def build_package(channel_id, channel_title, recs, out_root):
    """Write the package tree under out_root/<safe title> and zip it.
    Returns (zip_path, stats)."""
    recs = sorted(recs, key=lambda r: (_short_date(r), (r.get("title") or "").lower()))
    safe_ch = sanitize(channel_title, 60) or channel_id
    base = os.path.join(out_root, safe_ch)
    if os.path.exists(base):
        shutil.rmtree(base)
    os.makedirs(base)

    counts = {"success": 0, "no_captions": 0, "error": 0, "empty": 0}
    manifest = []
    combined_parts = []

    for r in recs:
        counts[r.get("status", "error")] = counts.get(r.get("status", "error"), 0) + 1
        sdate = _short_date(r)
        year = sdate[:4] if sdate != "0000-00-00" else "unknown"
        fname = f"{sdate}_{sanitize(r.get('title'))}_{r['videoId']}.txt"
        ydir = os.path.join(base, "transcripts_by_year", year)
        os.makedirs(ydir, exist_ok=True)
        text = _video_text(r)
        with open(os.path.join(ydir, fname), "w", encoding="utf-8") as f:
            f.write(text)
        manifest.append({
            "videoId": r["videoId"], "title": r.get("title"), "uploadDate": sdate,
            "uploadDatetime": r.get("publishDate") or r.get("uploadDate"),
            "type": "short" if r.get("isShort") else "video",
            "lengthSeconds": r.get("lengthSeconds"), "viewCount": r.get("viewCount"),
            "category": r.get("category"), "url": r["url"],
            "captionLanguage": r.get("captionLang"), "captionKind": r.get("captionKind"),
            "transcriptStatus": r.get("status"),
            "segments": len(r.get("lines", [])) if r.get("status") == "success" else None,
            "characters": sum(len(t) for _, t in r.get("lines", [])) if r.get("status") == "success" else None,
            "file": f"transcripts_by_year/{year}/{fname}", "reason": r.get("reason"),
        })
        combined_parts.append((r, text))

    total = len(recs)
    date_lo = next((m["uploadDate"] for m in manifest if m["uploadDate"] != "0000-00-00"), "unknown")
    date_hi = next((m["uploadDate"] for m in reversed(manifest) if m["uploadDate"] != "0000-00-00"), "unknown")

    # manifest.json
    with open(os.path.join(base, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"channel": {"id": channel_id, "title": channel_title},
                   "counts": counts, "total": total,
                   "dateRange": [date_lo, date_hi], "videos": manifest},
                  f, indent=1, ensure_ascii=False)

    # combined single file
    combined_path = os.path.join(base, "ALL_TRANSCRIPTS_chronological.md")
    with open(combined_path, "w", encoding="utf-8") as f:
        f.write(f"# {channel_title} — All Transcripts (chronological)\n\n")
        f.write(f"Channel: https://www.youtube.com/channel/{channel_id} ({channel_id})\n")
        f.write(f"{total} videos, {date_lo} to {date_hi}. "
                f"{counts.get('success', 0)} with transcript text; "
                f"{counts.get('no_captions', 0)} without captions. "
                "Faithful source captions — none fabricated.\n")
        for i, (r, text) in enumerate(combined_parts, 1):
            body = text.split("=" * 60, 1)
            f.write(f"\n\n{'=' * 80}\n# [{i}/{total}] {_short_date(r)} — {r.get('title')}\n")
            f.write(f"Video ID: {r['videoId']} | {r['url']} | "
                    f"{'short' if r.get('isShort') else 'video'} | {r.get('status')}\n{'=' * 80}\n\n")
            f.write((body[1].strip() if len(body) > 1 else text))
            f.write("\n")

    # chat-sized chunks
    chunk_dir = os.path.join(base, "chunks")
    os.makedirs(chunk_dir)
    chunks = []
    cur, cur_len, idx = [], 0, 1
    header_for = lambda r: (f"\n\n{'=' * 80}\n# {_short_date(r)} — {r.get('title')}\n"
                            f"Video ID: {r['videoId']} | {r['url']}\n{'=' * 80}\n\n")
    for r, text in combined_parts:
        body = text.split("=" * 60, 1)
        piece = header_for(r) + (body[1].strip() if len(body) > 1 else text) + "\n"
        if cur and cur_len + len(piece) > CHUNK_CHARS:
            chunks.append((idx, cur)); idx += 1; cur, cur_len = [], 0
        cur.append(piece); cur_len += len(piece)
    if cur:
        chunks.append((idx, cur))
    n_chunks = len(chunks)
    for idx, pieces in chunks:
        with open(os.path.join(chunk_dir, f"part_{idx:03d}_of_{n_chunks:03d}.md"), "w", encoding="utf-8") as f:
            f.write(f"# {channel_title} — Transcripts (part {idx} of {n_chunks})\n")
            f.write("Upload this part to a chat together with the other parts (or one at a time).\n")
            f.write("".join(pieces))

    # INDEX.md
    with open(os.path.join(base, "INDEX.md"), "w", encoding="utf-8") as f:
        f.write(f"# {channel_title} — Transcript Archive\n\n")
        f.write(f"- **Channel:** {channel_title} (`{channel_id}`)\n")
        f.write(f"- **URL:** https://www.youtube.com/channel/{channel_id}\n")
        f.write(f"- **Total videos:** {total}\n")
        f.write(f"- **Transcripts captured:** {counts.get('success', 0)}\n")
        f.write(f"- **No captions:** {counts.get('no_captions', 0)}  ·  "
                f"**Errors/empty:** {counts.get('error', 0) + counts.get('empty', 0)}\n")
        f.write(f"- **Date range:** {date_lo} → {date_hi}\n\n")
        f.write("| # | Date | Title | Type | Status | Lang | Len(s) | Views | File |\n")
        f.write("|---|---|---|---|---|---|---|---|---|\n")
        for i, m in enumerate(manifest, 1):
            safe_t = (m["title"] or "").replace("|", "\\|")
            f.write(f"| {i} | {m['uploadDate']} | {safe_t} | {m['type']} | {m['transcriptStatus']} | "
                    f"{m['captionLanguage'] or ''} | {m['lengthSeconds'] or ''} | {m['viewCount'] or ''} | "
                    f"`{m['file']}` |\n")

    # README.md
    with open(os.path.join(base, "README.md"), "w", encoding="utf-8") as f:
        f.write(f"""# {channel_title} — Transcript Package

**Channel:** {channel_title} (`{channel_id}`)
https://www.youtube.com/channel/{channel_id}

**Contents:** {total} videos, {date_lo} to {date_hi}.
{counts.get('success', 0)} have full caption text; {counts.get('no_captions', 0)} have no published
captions (marked accordingly). Captions are the videos' own text — faithful, never fabricated.

## How to use this package
- **`ALL_TRANSCRIPTS_chronological.md`** — every transcript in date order. Upload this one
  file to a new chat for whole-corpus analysis (themes, trends, patterns).
- **`chunks/`** — the same content pre-split into {n_chunks} chat-sized file(s) for when the
  combined file is too large to upload at once.
- **`transcripts_by_year/<year>/`** — one file per video to focus on a period.
- **`INDEX.md`** — sortable table of every video.  **`manifest.json`** — machine-readable metadata.

## Suggested prompt for a fresh chat
> "Attached are transcripts from the {channel_title} YouTube channel ({date_lo} to {date_hi}).
> Analyze them at an expert level: identify recurring themes, the topics/entities discussed,
> how the messaging and focus evolve over time, contradictions or notable claims, and any
> patterns. Cite specific dates/episodes."
""")

    # zip it
    zip_path = base + ".zip"
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, _, files in os.walk(base):
            for fn in files:
                fp = os.path.join(root, fn)
                z.write(fp, os.path.relpath(fp, out_root))

    zip_name = os.path.basename(zip_path)
    ascii_name = zip_name.encode("ascii", "ignore").decode("ascii") or "transcripts.zip"
    if not ascii_name.endswith(".zip"):
        ascii_name += ".zip"
    stats = {"total": total, "counts": counts, "chunks": n_chunks,
             "dateRange": [date_lo, date_hi], "zipName": zip_name, "zipNameAscii": ascii_name}
    return zip_path, stats
