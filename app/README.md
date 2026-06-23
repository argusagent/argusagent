# Channel Transcript Scraper

A small, dependency-free web app that turns a **YouTube channel link** into a
**compressed package of every video's transcript + metadata**, organized and
ready to upload to a chat (Claude/ChatGPT/etc.) for analysis.

It scales the one-off Navellier Market Buzz archiving job into a reusable tool:
paste any channel URL/@handle/`UC…` id → click **Scrape Video Transcripts** →
watch a live progress bar → the finished `.zip` downloads automatically.

## Run it locally

No installs needed — pure Python standard library (Python 3.9+).

```bash
cd app
python3 server.py
# then open http://127.0.0.1:8000
```

## Deploy

The app is a single dependency-free process; any container or PaaS works.

**Docker**

```bash
cd app
docker build -t transcript-scraper .
docker run -p 8000:8000 -e ACCESS_TOKEN=choose-a-secret transcript-scraper
# open http://localhost:8000/?token=choose-a-secret
```

**PaaS (Render / Railway / Fly / Heroku-style)** — a `Procfile` (`web: python3 server.py`)
is included. Set the start command to `python3 server.py`, bind via the platform's
`$PORT`, and set `HOST=0.0.0.0` and the env vars below.

> The remote container this was developed in is ephemeral, so a permanent public
> URL has to be created on a hosting platform you control — the Docker image above
> is the portable artifact for that.

### Configuration (environment variables)

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` in containers. |
| `PORT` | `8000` | Port to listen on. |
| `OUTPUT_DIR` | `app/output` | Where job folders + zips are written (ephemeral). |
| `MAX_VIDEOS` | `2000` | Hard per-job cap (protects memory on huge channels). |
| `MAX_CONCURRENT_JOBS` | `2` | Simultaneous scrapes; excess requests get HTTP 429. |
| `JOB_TTL_SECONDS` | `1800` | Finished jobs + their zips are deleted after this. |
| `WORKERS` | `6` | Per-job fetch concurrency. |
| `ACCESS_TOKEN` | _(unset)_ | If set, `/api/*` requires it. The UI forwards `?token=…`. |

### Security & safety

- **Public exposure:** set `ACCESS_TOKEN` (and serve behind HTTPS) before binding to
  `0.0.0.0`. Without a token the API is open to anyone who can reach the port.
- **Input is validated:** only YouTube hosts/handles/`UC…` ids are accepted (the
  resolver can't be pointed at arbitrary hosts), with length and value caps; the
  request-body size is capped.
- **Resource limits:** per-job video cap, concurrency cap, and TTL cleanup of jobs
  and zips prevent unbounded memory/disk growth.
- **No path traversal:** downloads are looked up by server-issued job id (never a
  user path); static files are confined to `static/`; output filenames are sanitized.
- **Headers:** every response sends a strict CSP, `nosniff`, `X-Frame-Options: DENY`,
  and `no-referrer`. Internal errors are logged server-side and shown to users only
  as a generic message (no stack traces or hostnames leaked).
- **Runs as non-root** in the Docker image.

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
