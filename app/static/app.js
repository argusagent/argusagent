const $ = (id) => document.getElementById(id);
let poll = null;
let currentJob = null;

const form = $("form");
const go = $("go");
const btnLabel = go.querySelector(".btn-label");
const spinner = go.querySelector(".spinner");

function show(sec) {
  for (const id of ["progress", "done", "error"]) $(id).hidden = (id !== sec);
}

function setBusy(busy) {
  go.disabled = busy;
  spinner.hidden = !busy;
  btnLabel.textContent = busy ? "Scraping…" : "Scrape Video Transcripts";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const channel = $("channel").value.trim();
  if (!channel) return;
  const max = $("max").value.trim();
  setBusy(true);
  show("progress");
  $("bar").style.width = "3%";
  $("phase").textContent = "Starting";
  $("pct").textContent = "";
  $("msg").textContent = "Contacting YouTube…";
  $("stats").hidden = true;

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, max_videos: max ? Number(max) : null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    currentJob = data.job;
    startPolling(data.job);
  } catch (err) {
    fail(err.message);
  }
});

function startPolling(job) {
  if (poll) clearInterval(poll);
  poll = setInterval(() => tick(job), 750);
  tick(job);
}

async function tick(job) {
  let st;
  try {
    const res = await fetch(`/api/status?job=${job}`);
    st = await res.json();
  } catch {
    return; // transient; keep polling
  }
  if (st.error) return;

  const pct = Math.max(3, Math.min(100, st.percent || 0));
  $("bar").style.width = pct + "%";
  $("pct").textContent = pct + "%";
  $("phase").textContent = (st.phase || "").replace("ing", "ing");
  $("msg").textContent = st.message || "";

  if (st.phase === "fetching" && st.total) {
    renderStats({
      Found: st.total,
      Fetched: st.done || 0,
      Channel: st.channel || "—",
      Status: "working",
    });
  }

  if (st.phase === "done") {
    clearInterval(poll); poll = null;
    finish(st);
  } else if (st.phase === "error") {
    clearInterval(poll); poll = null;
    fail(st.message || "Something went wrong.");
  }
}

function renderStats(obj) {
  const el = $("stats");
  el.hidden = false;
  el.innerHTML = "";
  for (const [lbl, num] of Object.entries(obj)) {
    const d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = `<div class="num">${num}</div><div class="lbl">${lbl}</div>`;
    el.appendChild(d);
  }
}

function finish(st) {
  setBusy(false);
  show("done");
  const s = st.stats || {};
  const c = s.counts || {};
  const range = (s.dateRange || []).join(" → ");
  $("done-title").textContent = `${st.channel || "Channel"} — ${s.total || 0} videos`;
  $("done-sub").textContent =
    `${c.success || 0} transcripts captured · ${c.no_captions || 0} without captions · ` +
    `${s.chunks || 1} upload chunk(s) · ${range}`;
  const url = `/api/download?job=${currentJob}`;
  $("download").href = url;
  // auto-download
  const a = document.createElement("a");
  a.href = url; a.download = s.zipName || "transcripts.zip";
  document.body.appendChild(a); a.click(); a.remove();
}

function fail(message) {
  setBusy(false);
  show("error");
  $("error-msg").textContent = message;
}

$("again").addEventListener("click", reset);
$("retry").addEventListener("click", reset);
function reset() {
  show("progress"); $("progress").hidden = true;
  $("channel").focus();
}
