# Transcript archive — resume guide

Complete state of the archiving job for **Navellier Market Buzz**
(`UCqm9Z0DfGXZ8oMF70ic3B1A`, https://www.youtube.com/@navelliermarketbuzz).

## What is done (no YouTube site access needed — uses `youtubei.googleapis.com`)

- **Full enumeration** of all **240** distinct videos (128 long-form + 111 Shorts + 1 live stream).
  Authoritative count reconciled against the channel header ("239 videos" = 128 + 111, disjoint)
  plus 1 offline live-stream upload found via the uploads playlist.
- **Complete metadata** for every video: title, precise upload date/time, duration,
  caption availability + language, video type. Stored in `metadata.json` + `dates.json`.
- Archive scaffold built: one `.txt` per video (named `DATE_title_VIDEOID.txt`),
  `INDEX.md`, `manifest.json` in `../transcripts/`.

## Caption TEXT — DONE

`www.youtube.com` is reachable in this environment, so the caption text was
fetched and the archive is now fully populated:

- **239 / 240 videos** have real transcript text in `../transcripts/`.
- **1** (`zmnlL747KjY`, an offline "Navellier Market Buzz Live Stream" upload)
  has no published captions and is marked `no_captions` — no text fabricated.
- ~2.51M characters of source caption text total.
- `INDEX.md`, `manifest.json`, and `ANALYSIS.md` all reflect this.

The timedtext endpoint returns **format=3 XML** (`<p>`/`<s>` tags) even when
`fmt=json3` is requested, so `fetch_transcripts.py` now parses captions with an
ElementTree-based parser (`parse_timedtext_xml`) covering format=3 and srv1.

## To rebuild / re-run (resumable, faithful)

```bash
cd tools
python3 fetch_transcripts.py          # fetch+parse captions for all videos (skips done)
python3 assemble.py ../transcripts    # rebuild *.txt + INDEX.md + manifest.json
python3 analyze.py                     # recompute ticker/theme frequencies for ANALYSIS.md
```

`fetch_transcripts.py` fetches a fresh caption URL per video via the ANDROID_VR
InnerTube player and pulls the timedtext. Only source-provided caption text is
written; videos with no captions are marked, never fabricated. Pure stdlib;
the proxy CA is read from `/root/.ccr/ca-bundle.crt` via `HTTPS_PROXY`.
