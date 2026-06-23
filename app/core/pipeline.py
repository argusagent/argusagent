"""Orchestrate: resolve channel -> enumerate videos -> fetch transcripts+metadata
-> package into a compressed zip. Reports progress through a callback so a UI can
render a live progress bar."""
import concurrent.futures
import sys
import threading
import traceback

from . import innertube as it
from . import packager


def run(channel_input, out_root, progress=None, max_videos=None, workers=6):
    """Run the full pipeline.

    progress(dict) is called with keys:
      phase: resolving|enumerating|fetching|packaging|done|error
      message, percent (0-100), done, total, channel, and on done: stats, zip_path.
    Returns the final status dict.
    """
    def emit(**kw):
        if progress:
            progress(kw)

    try:
        emit(phase="resolving", percent=2, message="Resolving channel…")
        channel_id, channel_title = it.resolve_channel(channel_input)
        emit(phase="resolving", percent=5, message=f"Channel: {channel_title}",
             channel=channel_title)

        emit(phase="enumerating", percent=6, message="Enumerating videos…", channel=channel_title)
        ids = it.enumerate_channel(
            channel_id, max_videos=max_videos,
            progress=lambda n: emit(phase="enumerating", percent=min(14, 6 + n // 50),
                                    message=f"Found {n} videos…", found=n, channel=channel_title))
        total = len(ids)
        if total == 0:
            raise ValueError("No videos found for this channel.")
        emit(phase="enumerating", percent=15, message=f"Found {total} videos.",
             total=total, channel=channel_title)

        recs = []
        done = {"n": 0}
        lock = threading.Lock()

        def work(vid):
            rec = it.fetch_video(vid)
            with lock:
                done["n"] += 1
                n = done["n"]
            # keep only videos that actually belong to this channel
            keep = (rec.get("channelId") in (None, channel_id))
            pct = 15 + int(80 * n / total)
            emit(phase="fetching", percent=pct, done=n, total=total, channel=channel_title,
                 message=f"Transcripts {n}/{total} · {rec.get('status', '?')}")
            return rec if keep else None

        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            for rec in ex.map(work, ids):
                if rec is not None:
                    recs.append(rec)

        emit(phase="packaging", percent=96, message="Building compressed package…",
             total=len(recs), channel=channel_title)
        zip_path, stats = packager.build_package(channel_id, channel_title, recs, out_root)

        final = {"phase": "done", "percent": 100, "channel": channel_title,
                 "message": "Done.", "zip_path": zip_path, "stats": stats,
                 "total": stats["total"]}
        emit(**final)
        return final
    except ValueError as e:
        # expected, user-facing problems (bad channel, no videos, etc.)
        final = {"phase": "error", "percent": 100, "message": str(e), "errorKind": "input"}
        emit(**final)
        return final
    except Exception as e:  # noqa: BLE001 - unexpected; log detail, show generic
        traceback.print_exc(file=sys.stderr)
        final = {"phase": "error", "percent": 100, "errorKind": "internal",
                 "message": "Something went wrong while scraping this channel. "
                            "It may be temporarily unavailable — please try again."}
        emit(**final)
        return final
