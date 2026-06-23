"use strict";
const $ = (id) => document.getElementById(id);
const CHUNK_CHARS = 300000;
const CONCURRENCY = 6;
let blobUrl = null;

const form = $("form"), go = $("go");
const btnLabel = go.querySelector(".btn-label"), spinner = go.querySelector(".spinner");

function show(sec) { for (const id of ["progress", "done", "error"]) $(id).hidden = id !== sec; }
function setBusy(b) { go.disabled = b; spinner.hidden = !b; btnLabel.textContent = b ? "Scraping…" : "Scrape Video Transcripts"; }
function setBar(pct, phase, msg) {
  $("bar").style.width = Math.max(3, Math.min(100, pct)) + "%";
  if (phase !== undefined) $("phase").textContent = phase;
  $("pct").textContent = Math.round(pct) + "%";
  if (msg !== undefined) $("msg").textContent = msg;
}
function statChips(o) {
  const el = $("stats"); el.hidden = false; el.innerHTML = "";
  for (const [lbl, num] of Object.entries(o)) {
    const d = document.createElement("div"); d.className = "stat";
    d.innerHTML = `<div class="num">${num}</div><div class="lbl">${lbl}</div>`;
    el.appendChild(d);
  }
}

async function jget(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const channel = $("channel").value.trim();
  if (!channel) return;
  const maxV = parseInt($("max").value, 10);
  const limit = Number.isFinite(maxV) && maxV > 0 ? maxV : null;

  setBusy(true); show("progress"); $("stats").hidden = true;
  setBar(3, "Resolving", "Looking up the channel…");

  try {
    // 1) resolve
    const { channelId, title } = await jget(`/api/resolve?channel=${encodeURIComponent(channel)}`);
    setBar(6, "Enumerating", `Channel: ${title}`);

    // 2) enumerate every video id (paged)
    const ids = [];
    const seen = new Set();
    let cursor = null;
    do {
      const u = `/api/enumerate?channelId=${encodeURIComponent(channelId)}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const page = await jget(u);
      for (const v of page.ids || []) if (v && !seen.has(v)) { seen.add(v); ids.push(v); }
      cursor = page.cursor;
      setBar(Math.min(14, 6 + ids.length / 40), "Enumerating", `Found ${ids.length} videos…`);
      if (limit && ids.length >= limit) break;
    } while (cursor);

    const work = limit ? ids.slice(0, limit) : ids;
    if (work.length === 0) throw new Error("No videos found for this channel.");
    const total = work.length;

    // 3) fetch each video's transcript+metadata with a small concurrency pool
    const recs = [];
    let done = 0, ok = 0, noCap = 0, errs = 0;
    statChips({ Found: total, Fetched: 0, Transcripts: 0, "No captions": 0 });

    async function worker(vid) {
      let rec;
      try { rec = await jget(`/api/video?id=${encodeURIComponent(vid)}`); }
      catch { rec = { videoId: vid, url: `https://www.youtube.com/watch?v=${vid}`, status: "error", reason: "fetch failed", lines: [] }; }
      done++;
      if (rec.channelId && rec.channelId !== channelId) return; // drop foreign videos
      if (rec.status === "success") ok++;
      else if (rec.status === "no_captions") noCap++;
      else errs++;
      recs.push(rec);
      setBar(15 + (75 * done) / total, "Fetching transcripts", `${done}/${total} · ${rec.title ? rec.title.slice(0, 54) : rec.videoId}`);
      statChips({ Found: total, Fetched: done, Transcripts: ok, "No captions": noCap });
    }
    await pool(work, worker, CONCURRENCY);

    // 4) build the package (zip) in the browser
    setBar(92, "Building package", "Assembling the compressed archive…");
    const { blob, stats, zipName } = await buildZip(channelId, title, recs);

    // 5) hand it over + auto-download
    finish(title, stats, blob, zipName);
  } catch (err) {
    fail(err.message || "Something went wrong.");
  }
});

function pool(items, worker, n) {
  return new Promise((resolve) => {
    let i = 0, active = 0, finished = 0;
    const next = () => {
      if (finished >= items.length) return resolve();
      while (active < n && i < items.length) {
        const item = items[i++]; active++;
        worker(item).catch(() => {}).finally(() => { active--; finished++; next(); });
      }
    };
    next();
  });
}

/* ---------------------------- packaging (faithful) ---------------------------- */
function sanitize(name, max = 90) {
  let t = (name || "untitled").replace(/[\/\\]/g, "-").replace(/[<>:"|?*\x00-\x1f]/g, "");
  t = t.replace(/\s+/g, " ").trim().replace(/ /g, "_").replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "");
  return (t.slice(0, max) || "untitled");
}
function pad(n) { return String(n).padStart(2, "0"); }
function fmtDur(s) { s = parseInt(s, 10); if (!Number.isFinite(s)) return "unknown";
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = s % 60;
  return (h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`) + ` (${s}s)`; }
function fmtTs(ms) { let s = (ms / 1000) | 0; const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = s % 60;
  return h ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`; }
function shortDate(r) { const iso = r.publishDate || r.uploadDate; const m = iso && iso.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : "0000-00-00"; }

function videoText(r) {
  const sd = shortDate(r);
  const head = [
    `Title: ${r.title}`,
    `Upload date: ${sd !== "0000-00-00" ? sd : "unknown"}`,
    `Upload datetime: ${r.publishDate || r.uploadDate || "unknown"}`,
    `Video ID: ${r.videoId}`,
    `Source URL: ${r.url}`,
    `Type: ${r.isShort ? "short" : "video"}`,
    `Duration: ${fmtDur(r.lengthSeconds)}`,
    `View count: ${r.viewCount || "n/a"}`,
    `Category: ${r.category || "n/a"}`,
    `Caption language: ${r.captionLang || "n/a"}`,
    `Caption kind: ${r.captionKind || "n/a"}`,
    `Transcript status: ${r.status}`,
  ];
  const body = [];
  if (r.status === "success" && r.lines && r.lines.length) {
    head.push(`Transcript segments: ${r.lines.length}`);
    head.push(`Transcript characters: ${r.lines.reduce((a, l) => a + l[1].length, 0)}`);
    for (const [t, txt] of r.lines) body.push(`[${fmtTs(t)}] ${txt}`);
  } else {
    body.push(`[NO TRANSCRIPT] ${r.reason || "Transcript not available."}`, "", "This file is a placeholder. No caption text was fabricated.");
  }
  return head.join("\n") + "\n" + "=".repeat(60) + "\n\n" + body.join("\n") + "\n";
}

async function buildZip(channelId, title, recs) {
  recs.sort((a, b) => (shortDate(a) + (a.title || "")).localeCompare(shortDate(b) + (b.title || "")));
  const counts = { success: 0, no_captions: 0, error: 0, empty: 0 };
  const zip = new JSZip();
  const safe = sanitize(title, 60) || channelId;
  const root = zip.folder(safe);
  const manifest = [], combined = [];

  for (const r of recs) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    const sd = shortDate(r), year = sd !== "0000-00-00" ? sd.slice(0, 4) : "unknown";
    const fname = `${sd}_${sanitize(r.title)}_${r.videoId}.txt`;
    const text = videoText(r);
    root.folder("transcripts_by_year").folder(year).file(fname, text);
    manifest.push({
      videoId: r.videoId, title: r.title, uploadDate: sd, uploadDatetime: r.publishDate || r.uploadDate,
      type: r.isShort ? "short" : "video", lengthSeconds: r.lengthSeconds, viewCount: r.viewCount,
      category: r.category, url: r.url, captionLanguage: r.captionLang, captionKind: r.captionKind,
      transcriptStatus: r.status, segments: r.status === "success" ? r.lines.length : null,
      characters: r.status === "success" ? r.lines.reduce((a, l) => a + l[1].length, 0) : null,
      file: `transcripts_by_year/${year}/${fname}`, reason: r.reason || null,
    });
    combined.push([r, text]);
  }

  const total = recs.length;
  const lo = (manifest.find((m) => m.uploadDate !== "0000-00-00") || {}).uploadDate || "unknown";
  const hi = ([...manifest].reverse().find((m) => m.uploadDate !== "0000-00-00") || {}).uploadDate || "unknown";

  root.file("manifest.json", JSON.stringify({ channel: { id: channelId, title }, counts, total, dateRange: [lo, hi], videos: manifest }, null, 1));

  // combined chronological
  let comb = `# ${title} — All Transcripts (chronological)\n\n` +
    `Channel: https://www.youtube.com/channel/${channelId} (${channelId})\n` +
    `${total} videos, ${lo} to ${hi}. ${counts.success || 0} with transcript text; ${counts.no_captions || 0} without captions. Faithful source captions — none fabricated.\n`;
  combined.forEach(([r, text], i) => {
    const body = text.split("=".repeat(60));
    comb += `\n\n${"=".repeat(80)}\n# [${i + 1}/${total}] ${shortDate(r)} — ${r.title}\n` +
      `Video ID: ${r.videoId} | ${r.url} | ${r.isShort ? "short" : "video"} | ${r.status}\n${"=".repeat(80)}\n\n` +
      (body.length > 1 ? body.slice(1).join("=".repeat(60)).trim() : text) + "\n";
  });
  root.file("ALL_TRANSCRIPTS_chronological.md", comb);

  // chat-sized chunks
  const chunksFolder = root.folder("chunks");
  const chunks = []; let cur = [], curLen = 0;
  for (const [r, text] of combined) {
    const body = text.split("=".repeat(60));
    const piece = `\n\n${"=".repeat(80)}\n# ${shortDate(r)} — ${r.title}\nVideo ID: ${r.videoId} | ${r.url}\n${"=".repeat(80)}\n\n` +
      (body.length > 1 ? body.slice(1).join("=".repeat(60)).trim() : text) + "\n";
    if (cur.length && curLen + piece.length > CHUNK_CHARS) { chunks.push(cur); cur = []; curLen = 0; }
    cur.push(piece); curLen += piece.length;
  }
  if (cur.length) chunks.push(cur);
  const nChunks = chunks.length;
  chunks.forEach((pieces, idx) => {
    const n = String(idx + 1).padStart(3, "0"), tot = String(nChunks).padStart(3, "0");
    chunksFolder.file(`part_${n}_of_${tot}.md`,
      `# ${title} — Transcripts (part ${idx + 1} of ${nChunks})\nUpload this part to a chat together with the other parts (or one at a time).\n` + pieces.join(""));
  });

  // INDEX.md
  let idx = `# ${title} — Transcript Archive\n\n- **Channel:** ${title} (\`${channelId}\`)\n` +
    `- **URL:** https://www.youtube.com/channel/${channelId}\n- **Total videos:** ${total}\n` +
    `- **Transcripts captured:** ${counts.success || 0}\n- **No captions:** ${counts.no_captions || 0} · **Errors/empty:** ${(counts.error || 0) + (counts.empty || 0)}\n` +
    `- **Date range:** ${lo} → ${hi}\n\n| # | Date | Title | Type | Status | Lang | Len(s) | Views | File |\n|---|---|---|---|---|---|---|---|---|\n`;
  manifest.forEach((m, i) => {
    idx += `| ${i + 1} | ${m.uploadDate} | ${(m.title || "").replace(/\|/g, "\\|")} | ${m.type} | ${m.transcriptStatus} | ${m.captionLanguage || ""} | ${m.lengthSeconds || ""} | ${m.viewCount || ""} | \`${m.file}\` |\n`;
  });
  root.file("INDEX.md", idx);

  // README.md
  root.file("README.md",
`# ${title} — Transcript Package

**Channel:** ${title} (\`${channelId}\`)
https://www.youtube.com/channel/${channelId}

**Contents:** ${total} videos, ${lo} to ${hi}.
${counts.success || 0} have full caption text; ${counts.no_captions || 0} have no published captions (marked accordingly).
Captions are the videos' own text — faithful, never fabricated.

## How to use this package
- **ALL_TRANSCRIPTS_chronological.md** — every transcript in date order. Upload this one file to a new chat for whole-corpus analysis.
- **chunks/** — the same content pre-split into ${nChunks} chat-sized file(s) for when the combined file is too large to upload at once.
- **transcripts_by_year/<year>/** — one file per video to focus on a period.
- **INDEX.md** — sortable table of every video.  **manifest.json** — machine-readable metadata.

## Suggested prompt for a fresh chat
> "Attached are transcripts from the ${title} YouTube channel (${lo} to ${hi}). Analyze them at an expert level: identify recurring themes, the topics/entities discussed, how the messaging and focus evolve over time, contradictions or notable claims, and any patterns. Cite specific dates/episodes."
`);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => setBar(92 + meta.percent * 0.07, "Building package", `Compressing… ${Math.round(meta.percent)}%`));
  return { blob, zipName: `${safe}.zip`, stats: { total, counts, chunks: nChunks, dateRange: [lo, hi] } };
}

function finish(title, stats, blob, zipName) {
  setBusy(false); show("done");
  const c = stats.counts || {};
  $("done-title").textContent = `${title} — ${stats.total} videos`;
  $("done-sub").textContent = `${c.success || 0} transcripts captured · ${c.no_captions || 0} without captions · ${stats.chunks} upload chunk(s) · ${stats.dateRange.join(" → ")}`;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(blob);
  const dl = $("download"); dl.href = blobUrl; dl.download = zipName;
  // auto-download
  const a = document.createElement("a"); a.href = blobUrl; a.download = zipName;
  document.body.appendChild(a); a.click(); a.remove();
}

function fail(message) { setBusy(false); show("error"); $("error-msg").textContent = message; }
$("again").addEventListener("click", reset);
$("retry").addEventListener("click", reset);
function reset() { show("progress"); $("progress").hidden = true; $("channel").focus(); }
