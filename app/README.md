# Channel Transcript Scraper

A small, dependency-free web app that turns a **YouTube channel link** into a
**compressed package of every video's transcript + metadata**, organized and
ready to upload to a chat (Claude/ChatGPT/etc.) for analysis.

It scales the one-off Navellier Market Buzz archiving job into a reusable tool:
paste any channel URL/@handle/`UC…` id → click **Scrape Video Transcripts** →
watch a live progress bar → the finished `.zip` downloads automatically.

## Run it

No installs needed — pure Python standard library (Python 3.9+).

```bash
cd app
python3 server.py
# then open http://127.0.0.1:8000
```

Options:

```bash
PORT=9000 HOST=0.0.0.0 python3 server.py     # change bind address/port
OUTPUT_DIR=/path/to/zips python3 server.py    # where finished zips are written
```

## What's in the downloaded zip

```
<Channel Title>/
├── README.md                        how to use + a ready-to-paste analysis prompt
├── INDEX.md                         sortable table of every video
├── manifest.json                    machine-readable metadata for every video
├── ALL_TRANSCRIPTS_chronological.md  every transcript in one file (single upload)
├── chunks/
│   └── part_001_of_00N.md           same content, split into chat-sized pieces
└── transcripts_by_year/
    └── <YYYY>/<date>_<title>_<id>.txt  one file per video
```

Each transcript file carries a metadata header (title, exact upload date/time,
duration, view count, category, caption language/kind) followed by the
timestamped caption text.

## How it works

```
server.py            stdlib HTTP server: serves the UI, runs jobs in background
static/              the UI (index.html, style.css, app.js) — progress bar, auto-download
core/innertube.py    InnerTube + timedtext client (resolve, enumerate, fetch captions)
core/pipeline.py     orchestration with progress callbacks + bounded concurrency
core/packager.py     builds the organized tree, chunks, INDEX/manifest/README, zip
```

- **Enumeration** pages a channel's Videos, Shorts and Streams tabs, then keeps
  only videos whose `channelId` matches the resolved channel.
- **Transcripts** come from the ANDROID_VR InnerTube player's caption track +
  the `timedtext` endpoint (json3, with format-3/srv1 XML fallbacks).
- **Exact upload dates** come from a WEB player call carrying a visitorData token.

### Faithfulness

Only source-provided caption text is ever written. Videos with no published
captions (e.g. offline live streams) are clearly marked `no_captions` — text is
never fabricated or paraphrased. Captions are usually auto-generated (ASR), so
spellings of names/tickers are approximate.

### Notes & limits

- Requires network access to `youtube.com` / `youtubei.googleapis.com`.
- Large channels take a while (≈2 API calls + 1 caption fetch per video);
  the progress bar reflects real per-video progress. Concurrency is bounded
  (default 6 workers) to stay polite to the API.
- The bundled CLI-free design means you can also call the core directly:
  `from core import pipeline; pipeline.run("@handle", "out/")`.
