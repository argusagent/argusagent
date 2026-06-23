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

## What remains: the caption TEXT

The actual transcript text lives only at `https://www.youtube.com/api/timedtext`.
That host is blocked by this environment's egress policy (HTTP 403 on CONNECT).
The reachable alternative (`youtubei.googleapis.com/youtubei/v1/get_transcript`) is
auth-gated (`FAILED_PRECONDITION`). So transcript text could not be downloaded here.

## To finish (in an environment whose network policy allows youtube.com)

```bash
cd tools
python3 fetch_transcripts.py          # downloads + parses captions for all videos (resumable)
python3 assemble.py ../transcripts    # rebuilds *.txt + INDEX.md + manifest.json with real text
```

`fetch_transcripts.py` re-fetches a fresh caption URL per video via the ANDROID_VR
InnerTube player (bypasses bot detection) and pulls the `fmt=json3` timedtext, falling
back to XML. It is faithful: only source-provided caption text is written; videos with
no captions are marked, never fabricated. Re-running skips already-completed videos.

Requires: `pip install yt-dlp` is NOT needed — pure stdlib + the InnerTube calls.
The proxy CA is read from `/root/.ccr/ca-bundle.crt` via `HTTPS_PROXY`.
