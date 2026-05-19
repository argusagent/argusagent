// Lightweight canvas chart primitives. Mobile-first, retina-aware.

function dpiSetup(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function niceTicks(min, max, count = 5) {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

function fmtTickShort(v) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + 'M';
  if (a >= 10_000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}

const COLORS = {
  gold: '#c8a55e',
  blue: '#6b8cae',
  red: '#c45a4a',
  green: '#6aa75a',
  amber: '#d49b56',
  grid: '#1f242b',
  axis: '#383f48',
  text: '#8c8d92',
};

// Line chart: series = [{ name, color, values: number[] }]; labels = string[]
export function drawLineChart(canvas, { labels, series, height = 200, yFormat = fmtTickShort, fillFirst = true, yMin: yMinArg, yMax: yMaxArg }) {
  const w = canvas.parentElement.clientWidth || 320;
  const h = height;
  const ctx = dpiSetup(canvas, w, h);
  const padL = 44, padR = 12, padT = 12, padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  let yMin = Infinity, yMax = -Infinity;
  for (const s of series) for (const v of s.values) {
    if (v < yMin) yMin = v;
    if (v > yMax) yMax = v;
  }
  if (yMinArg !== undefined) yMin = yMinArg;
  if (yMaxArg !== undefined) yMax = yMaxArg;
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  if (yMin > 0) yMin = 0; // anchor at zero for revenue/CF
  const pad = (yMax - yMin) * 0.08;
  if (yMaxArg === undefined) yMax += pad;

  const ticks = niceTicks(yMin, yMax, 4);
  // Grid + Y labels
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const y = padT + plotH - ((t - yMin) / (yMax - yMin)) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText(yFormat(t), padL - 6, y);
  }
  // Zero line
  if (yMin < 0 && yMax > 0) {
    const yz = padT + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath();
    ctx.moveTo(padL, yz);
    ctx.lineTo(w - padR, yz);
    ctx.stroke();
  }

  // X labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const n = labels.length;
  const xScale = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  // Show every label if <=10, else every other
  const showEvery = n > 10 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    if (i % showEvery !== 0 && i !== n - 1) continue;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(labels[i], xScale(i), h - padB + 6);
  }

  // Series
  for (let si = 0; si < series.length; si++) {
    const s = series[si];
    const color = s.color || COLORS.gold;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < s.values.length; i++) {
      const x = xScale(i);
      const y = padT + plotH - ((s.values[i] - yMin) / (yMax - yMin)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (fillFirst && si === 0) {
      ctx.lineTo(xScale(s.values.length - 1), padT + plotH);
      ctx.lineTo(xScale(0), padT + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, hexToRgba(color, 0.18));
      grad.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Data points
    ctx.fillStyle = color;
    for (let i = 0; i < s.values.length; i++) {
      const x = xScale(i);
      const y = padT + plotH - ((s.values[i] - yMin) / (yMax - yMin)) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Bar chart with positive/negative coloring.
export function drawBarChart(canvas, { labels, values, height = 200, yFormat = fmtTickShort }) {
  const w = canvas.parentElement.clientWidth || 320;
  const h = height;
  const ctx = dpiSetup(canvas, w, h);
  const padL = 44, padR = 12, padT = 12, padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  let yMin = Math.min(0, ...values);
  let yMax = Math.max(0, ...values);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.08;
  yMax += pad; yMin -= yMin < 0 ? pad : 0;

  const ticks = niceTicks(yMin, yMax, 4);
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const y = padT + plotH - ((t - yMin) / (yMax - yMin)) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(yFormat(t), padL - 6, y);
  }
  const yz = padT + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
  ctx.strokeStyle = COLORS.axis;
  ctx.beginPath();
  ctx.moveTo(padL, yz);
  ctx.lineTo(w - padR, yz);
  ctx.stroke();

  // Bars
  const n = values.length;
  const bw = Math.max(2, (plotW / n) * 0.7);
  for (let i = 0; i < n; i++) {
    const cx = padL + (i + 0.5) * (plotW / n);
    const v = values[i];
    const y0 = yz;
    const y1 = padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const top = Math.min(y0, y1);
    const height = Math.abs(y1 - y0);
    ctx.fillStyle = v >= 0 ? COLORS.gold : COLORS.red;
    ctx.fillRect(cx - bw / 2, top, bw, Math.max(1, height));
  }

  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const showEvery = n > 10 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    if (i % showEvery !== 0 && i !== n - 1) continue;
    ctx.fillText(labels[i], padL + (i + 0.5) * (plotW / n), h - padB + 6);
  }
}

// Sensitivity heatmap. data: 2D array (rows x cols). rowsLabels, colsLabels.
// Color scale: red (worst) → neutral → green (best), centered on 0.
export function drawHeatmap(parent, { data, rowLabels, colLabels, fmtFn, centerAtZero = true }) {
  parent.innerHTML = '';
  const cols = colLabels.length;
  // Determine range
  let vMin = Infinity, vMax = -Infinity;
  for (const row of data) for (const v of row) {
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const grid = document.createElement('div');
  grid.className = 'sens-grid';
  grid.style.gridTemplateColumns = `auto repeat(${cols}, 1fr)`;
  // Header row
  const corner = document.createElement('div');
  corner.className = 'sens-cell header label';
  grid.appendChild(corner);
  for (const c of colLabels) {
    const el = document.createElement('div');
    el.className = 'sens-cell header';
    el.textContent = c;
    grid.appendChild(el);
  }
  for (let r = 0; r < data.length; r++) {
    const lbl = document.createElement('div');
    lbl.className = 'sens-cell label';
    lbl.textContent = rowLabels[r];
    grid.appendChild(lbl);
    for (let c = 0; c < cols; c++) {
      const v = data[r][c];
      const el = document.createElement('div');
      el.className = 'sens-cell';
      let bg, fg;
      if (centerAtZero) {
        const t = Math.max(-1, Math.min(1, v / Math.max(Math.abs(vMin), Math.abs(vMax), 1)));
        if (t > 0) { bg = `rgba(106, 167, 90, ${Math.min(0.45, Math.abs(t) * 0.5)})`; fg = '#dfead8'; }
        else if (t < 0) { bg = `rgba(196, 90, 74, ${Math.min(0.45, Math.abs(t) * 0.5)})`; fg = '#f0d5d0'; }
        else { bg = 'transparent'; fg = '#a4a6ab'; }
      } else {
        const t = (v - vMin) / (vMax - vMin + 1e-9);
        bg = `rgba(200, 165, 94, ${0.05 + t * 0.4})`;
        fg = '#e6e4dd';
      }
      el.style.background = bg;
      el.style.color = fg;
      el.textContent = fmtFn(v);
      grid.appendChild(el);
    }
  }
  parent.appendChild(grid);
}

function hexToRgba(hex, a) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

export const colors = COLORS;
