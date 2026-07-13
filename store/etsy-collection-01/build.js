#!/usr/bin/env node
/**
 * Kaze Collection — generative japandi print system.
 * Each design is a function (W, H) => SVG string, so every aspect ratio is a
 * true recomposition, never a crop. Run: node build.js [outdir] [--ratios=preview]
 */
const fs = require("fs");
const path = require("path");

// ---------- palette (validated against 2026 trend research) ----------
const P = {
  paper: "#F2ECE1",   // warm white
  sand: "#E7DCCB",
  clay: "#D9A588",
  terracotta: "#C1704F",
  rust: "#9E5637",
  sage: "#9AA48A",
  olive: "#6F7A5E",
  ink: "#37332B",
  softInk: "#5A544A",
};

// ---------- shared texture / edge defs ----------
// linen: two directional fractal-noise sheets + fine grain, very low alpha.
// wobble: displacement filter that roughens edges (wabi-sabi, anti-clip-art).
const DEFS = (seed) => `
<defs>
  <filter id="linen" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.35" numOctaves="2" seed="${seed}" result="warp"/>
    <feColorMatrix in="warp" type="matrix" values="0 0 0 0 0.33 0 0 0 0 0.30 0 0 0 0 0.26 0 0 0 0.045 0" result="w1"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.35 0.012" numOctaves="2" seed="${seed + 7}" result="weft"/>
    <feColorMatrix in="weft" type="matrix" values="0 0 0 0 0.33 0 0 0 0 0.30 0 0 0 0 0.26 0 0 0 0.045 0" result="w2"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed + 13}" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0.42 0 0 0 0 0.38 0 0 0 0 0.33 0 0 0 0.05 0" result="g2"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="w1"/><feMergeNode in="w2"/><feMergeNode in="g2"/></feMerge>
  </filter>
  <filter id="plaster" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="3" seed="${seed + 3}" result="m"/>
    <feColorMatrix in="m" type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.50 0 0 0 0 0.44 0 0 0 0.10 0" result="m2"/>
    <feComposite in="m2" in2="SourceGraphic" operator="over"/>
  </filter>
  <filter id="wobble">
    <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" seed="${seed + 5}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="wobbleSoft">
    <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="2" seed="${seed + 9}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="drybrush">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.4" numOctaves="3" seed="${seed + 11}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.12 0.9" numOctaves="2" seed="${seed + 17}" result="mask"/>
    <feComponentTransfer in="mask" result="mask2"><feFuncA type="discrete" tableValues="0 0.35 0.8 1 1 1 1 1"/></feComponentTransfer>
    <feComposite in="d" in2="mask2" operator="in"/>
  </filter>
  <filter id="paperShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#37332B" flood-opacity="0.10"/>
  </filter>
</defs>`;

const svgOpen = (W, H, seed, bg = P.paper) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  DEFS(seed) +
  `<rect width="${W}" height="${H}" fill="${bg}"/>` +
  `<g filter="url(#plaster)"><rect width="${W}" height="${H}" fill="${bg}"/></g>`;
const svgClose = (W, H) =>
  `<g filter="url(#linen)"><rect width="${W}" height="${H}" fill="none"/><rect width="${W}" height="${H}" fill="rgba(0,0,0,0)"/></g></svg>`;

// arch path: rounded top, flat bottom, centered at cx, width w, total height h, base at y0
const arch = (cx, y0, w, h) => {
  const r = w / 2;
  return `M ${cx - r} ${y0} L ${cx - r} ${y0 - (h - r)} A ${r} ${r} 0 0 1 ${cx + r} ${y0 - (h - r)} L ${cx + r} ${y0} Z`;
};

// organic pebble: closed catmull-ish blob around (cx,cy)
const pebble = (cx, cy, rx, ry, irregular = 0.14, rot = 0, n = 9, phase = 0) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    const wob = 1 + irregular * Math.sin(a * 3 + phase) * Math.cos(a * 2 - phase);
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    d += ` Q ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d + " Z";
};

// tapered brush stroke along a horizontal-ish sweep
const brushStroke = (x0, y0, x1, y1, w0, w1, bow = 0) => {
  const mx = (x0 + x1) / 2 + bow, my = (y0 + y1) / 2 - Math.abs(bow) * 0.3;
  return `M ${x0} ${y0 - w0 / 2} Q ${mx} ${my - w0 * 0.4} ${x1} ${y1 - w1 / 2} L ${x1} ${y1 + w1 / 2} Q ${mx} ${my + w0 * 0.4} ${x0} ${y0 + w0 / 2} Z`;
};

// ---------- designs ----------
// Every design receives (W, H); layout is proportional with a safe margin.
const designs = {
  // ————— ARCH TRIO —————
  "01-arc-and-sun": (W, H) => {
    const s = svgOpen(W, H, 11, P.paper);
    const cx = W / 2, m = Math.min(W, H);
    const aw = m * 0.62, ah = H * 0.60, y0 = H * 0.865;
    const sunR = m * 0.115;
    return s +
      `<g filter="url(#wobbleSoft)">
        <circle cx="${cx - aw * 0.40}" cy="${y0 - ah - sunR * 0.28}" r="${sunR}" fill="${P.clay}"/>
      </g>
      <g filter="url(#wobble)">
        <path d="${arch(cx, y0, aw, ah)}" fill="${P.terracotta}"/>
        <rect x="${W * 0.14}" y="${y0 + H * 0.030}" width="${W * 0.72}" height="${m * 0.008}" fill="${P.ink}" opacity="0.85"/>
      </g>
      <g filter="url(#wobbleSoft)">
        <circle cx="${cx + aw * 0.30}" cy="${y0 - ah * 0.62}" r="${m * 0.052}" fill="${P.paper}" opacity="0.92"/>
      </g>` + svgClose(W, H);
  },

  "02-layered-arches": (W, H) => {
    const s = svgOpen(W, H, 23, P.sand);
    const cx = W / 2, m = Math.min(W, H), y0 = H * 0.885;
    return s +
      `<g filter="url(#wobble)">
        <path d="${arch(cx - m * 0.10, y0, m * 0.60, H * 0.66)}" fill="${P.sage}" opacity="0.96"/>
        <path d="${arch(cx + m * 0.08, y0, m * 0.56, H * 0.56)}" fill="${P.clay}" opacity="0.97"/>
        <path d="${arch(cx - m * 0.015, y0, m * 0.40, H * 0.42)}" fill="${P.rust}"/>
        <path d="${arch(cx, y0, m * 0.19, H * 0.24)}" fill="${P.paper}" opacity="0.95"/>
      </g>` + svgClose(W, H);
  },

  "03-arch-botanical": (W, H) => {
    const s = svgOpen(W, H, 37, P.paper);
    const cx = W / 2, m = Math.min(W, H), y0 = H * 0.87;
    const stemX = cx, stemTop = H * 0.24;
    let leaves = "";
    const NL = 6;
    for (let i = 0; i < NL; i++) {
      const t = i / (NL - 1);
      const y = stemTop + t * (H * 0.44);
      const side = i % 2 === 0 ? -1 : 1;
      const len = m * (0.10 + 0.055 * Math.sin(t * Math.PI));
      const lx = stemX + side * len, ly = y - len * 0.42;
      const col = i === 2 ? P.terracotta : P.olive;
      leaves += `<path d="M ${stemX} ${y} Q ${stemX + side * len * 0.55} ${y - len * 0.55} ${lx} ${ly} Q ${stemX + side * len * 0.72} ${y + len * 0.12} ${stemX} ${y}" fill="${col}" opacity="0.94"/>`;
    }
    return s +
      `<g filter="url(#wobbleSoft)"><path d="${arch(cx, y0, m * 0.66, H * 0.68)}" fill="${P.sand}"/></g>
      <g filter="url(#wobble)">
        <path d="M ${stemX} ${H * 0.78} C ${stemX - m * 0.012} ${H * 0.6} ${stemX + m * 0.012} ${H * 0.42} ${stemX} ${stemTop}" stroke="${P.ink}" stroke-width="${m * 0.008}" fill="none" stroke-linecap="round"/>
        ${leaves}
        <ellipse cx="${cx}" cy="${H * 0.815}" rx="${m * 0.085}" ry="${m * 0.028}" fill="${P.ink}" opacity="0.9"/>
      </g>` + svgClose(W, H);
  },

  // ————— WABI-SABI TRIO —————
  "04-enso-sun": (W, H) => {
    const s = svgOpen(W, H, 41, P.paper);
    const cx = W / 2, cy = H * 0.46, m = Math.min(W, H), R = m * 0.335;
    let ring = "";
    const N = 170;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      if (t > 0.88) continue; // enso opening
      const a = t * Math.PI * 2 - Math.PI * 0.62;
      // smooth taper: thick start, thin trailing end, no discrete beads
      const taper = Math.pow(1 - t, 0.55);
      const wid = m * (0.020 + 0.038 * taper + 0.004 * Math.sin(t * 23));
      const rr = R + m * 0.006 * Math.sin(t * 11); // slight hand wobble in radius
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      ring += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${wid.toFixed(1)}" fill="${P.ink}" opacity="${(0.94 - t * 0.30).toFixed(2)}"/>`;
    }
    return s +
      `<g filter="url(#drybrush)">${ring}</g>
      <g filter="url(#wobble)">
        <circle cx="${cx + R * 0.62}" cy="${cy - R * 0.70}" r="${m * 0.055}" fill="${P.terracotta}"/>
        <rect x="${W * 0.30}" y="${H * 0.845}" width="${W * 0.40}" height="${m * 0.006}" fill="${P.softInk}" opacity="0.7"/>
      </g>` + svgClose(W, H);
  },

  "05-balance": (W, H) => {
    const s = svgOpen(W, H, 53, P.sand);
    const cx = W / 2, m = Math.min(W, H);
    const k = 1.22; // stack scale
    const stones = [
      { ry: 0.075 * k, rx: 0.240 * k, col: P.ink, dx: 0.00 },
      { ry: 0.062 * k, rx: 0.190 * k, col: P.terracotta, dx: -0.018 },
      { ry: 0.052 * k, rx: 0.150 * k, col: P.paper, dx: 0.022 },
      { ry: 0.042 * k, rx: 0.110 * k, col: P.olive, dx: -0.010 },
      { ry: 0.030 * k, rx: 0.070 * k, col: P.clay, dx: 0.012 },
    ];
    let y = H * 0.82, out = "";
    stones.forEach((st, i) => {
      const ry = m * st.ry, rx = m * st.rx;
      y -= ry * 1.06;
      out += `<path d="${pebble(cx + m * st.dx, y, rx, ry, 0.10, i * 0.7, 9, i * 1.3)}" fill="${st.col}" ${i === 2 ? `stroke="${P.softInk}" stroke-width="${m * 0.002}"` : ""}/>`;
      y -= ry * 0.92;
    });
    return s +
      `<g filter="url(#wobble)">${out}
      <circle cx="${W * 0.78}" cy="${H * 0.20}" r="${m * 0.075}" fill="${P.paper}" opacity="0.9"/>
      <rect x="${W * 0.20}" y="${H * 0.845}" width="${W * 0.60}" height="${m * 0.007}" fill="${P.ink}" opacity="0.8"/></g>` + svgClose(W, H);
  },

  "06-brushfield": (W, H) => {
    const s = svgOpen(W, H, 67, P.paper);
    const m = Math.min(W, H);
    return s +
      `<g filter="url(#drybrush)">
        <path d="${brushStroke(W * 0.16, H * 0.34, W * 0.86, H * 0.325, m * 0.10, m * 0.022, m * 0.045)}" fill="${P.sage}"/>
        <path d="${brushStroke(W * 0.12, H * 0.52, W * 0.82, H * 0.545, m * 0.15, m * 0.030, -m * 0.055)}" fill="${P.terracotta}"/>
        <path d="${brushStroke(W * 0.22, H * 0.70, W * 0.88, H * 0.690, m * 0.08, m * 0.016, m * 0.035)}" fill="${P.ink}" opacity="0.88"/>
      </g>
      <g filter="url(#wobbleSoft)"><circle cx="${W * 0.80}" cy="${H * 0.175}" r="${m * 0.045}" fill="${P.rust}"/></g>` + svgClose(W, H);
  },

  // ————— SUMI LANDSCAPE TRIO —————
  "07-ridge": (W, H) => {
    const s = svgOpen(W, H, 71, P.paper);
    const m = Math.min(W, H), hy = H * 0.62;
    return s +
      `<g filter="url(#wobbleSoft)"><circle cx="${W * 0.63}" cy="${H * 0.27}" r="${m * 0.13}" fill="${P.terracotta}" opacity="0.96"/></g>
      <g filter="url(#wobble)">
        <path d="M ${-W * 0.05} ${hy + H * 0.10} L ${W * 0.28} ${hy - H * 0.16} L ${W * 0.46} ${hy} L ${W * 0.66} ${hy - H * 0.24} L ${W * 0.85} ${hy - H * 0.02} L ${W * 1.05} ${hy - H * 0.10} L ${W * 1.05} ${H * 1.05} L ${-W * 0.05} ${H * 1.05} Z" fill="${P.ink}" opacity="0.93"/>
        <path d="M ${-W * 0.05} ${hy + H * 0.16} L ${W * 0.22} ${hy + H * 0.04} L ${W * 0.52} ${hy + H * 0.17} L ${W * 0.80} ${hy + H * 0.06} L ${W * 1.05} ${hy + H * 0.18} L ${W * 1.05} ${H * 1.05} L ${-W * 0.05} ${H * 1.05} Z" fill="${P.softInk}" opacity="0.65"/>
      </g>
      <g filter="url(#drybrush)">
        <path d="${brushStroke(W * 0.10, H * 0.84, W * 0.9, H * 0.845, m * 0.02, m * 0.012, 0)}" fill="${P.sand}" opacity="0.9"/>
      </g>` + svgClose(W, H);
  },

  "08-still-lake": (W, H) => {
    const s = svgOpen(W, H, 83, P.sand);
    const m = Math.min(W, H), cx = W / 2;
    let ripples = "";
    for (let i = 0; i < 5; i++) {
      const y = H * (0.60 + i * 0.062);
      const w = W * (0.55 - i * 0.09);
      ripples += `<path d="${brushStroke(cx - w / 2, y, cx + w / 2, y, m * 0.010, m * 0.006, 0)}" fill="${P.ink}" opacity="${0.85 - i * 0.13}"/>`;
    }
    return s +
      `<g filter="url(#wobbleSoft)"><circle cx="${cx}" cy="${H * 0.30}" r="${m * 0.155}" fill="${P.paper}" stroke="${P.softInk}" stroke-width="${m * 0.0025}"/></g>
      <g filter="url(#wobble)"><circle cx="${cx + m * 0.045}" cy="${H * 0.275}" r="${m * 0.115}" fill="${P.clay}" opacity="0.55"/></g>
      <g filter="url(#drybrush)">${ripples}</g>` + svgClose(W, H);
  },

  "09-heron": (W, H) => {
    const s = svgOpen(W, H, 97, P.paper);
    const m = Math.min(W, H), cx = W * 0.46, gy = H * 0.78;
    const bodyR = m * 0.085;
    let reeds = "";
    const reedDefs = [[0.20, 0.30], [0.26, 0.38], [0.74, 0.34], [0.80, 0.26], [0.68, 0.22]];
    reedDefs.forEach(([rx, rh], i) => {
      const x = W * rx, bow = (i % 2 ? 1 : -1) * m * 0.03;
      reeds += `<path d="M ${x} ${gy} C ${x + bow * 0.3} ${gy - H * rh * 0.5} ${x + bow} ${gy - H * rh * 0.9} ${x + bow * 1.15} ${gy - H * rh}" stroke="${P.olive}" stroke-width="${m * 0.006}" fill="none" stroke-linecap="round" opacity="0.9"/>`;
    });
    const bodyCx = cx, bodyCy = gy - H * 0.175;         // body center
    const bw = bodyR * 1.75, bh = bodyR * 0.80;          // slim horizontal teardrop
    const neckBaseX = bodyCx + bw * 0.62, neckBaseY = bodyCy - bh * 0.42;
    const headX = bodyCx + bw * 0.82, headY = bodyCy - bh * 0.5 - H * 0.180;
    const headR = m * 0.020;
    return s +
      `<g filter="url(#wobbleSoft)"><circle cx="${W * 0.72}" cy="${H * 0.22}" r="${m * 0.105}" fill="${P.terracotta}" opacity="0.95"/></g>
      <g filter="url(#wobble)">
        ${reeds}
        <path d="M ${bodyCx - bw * 0.16} ${bodyCy + bh * 0.85} L ${bodyCx - bw * 0.19} ${gy}" stroke="${P.ink}" stroke-width="${m * 0.0065}" stroke-linecap="round"/>
        <path d="M ${bodyCx + bw * 0.14} ${bodyCy + bh * 0.82} L ${bodyCx + bw * 0.22} ${gy - H * 0.055} L ${bodyCx + bw * 0.12} ${gy}" stroke="${P.ink}" stroke-width="${m * 0.0065}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${pebble(bodyCx, bodyCy, bw, bh, 0.06, 0.25, 11)}" fill="${P.ink}"/>
        <path d="M ${bodyCx - bw * 0.95} ${bodyCy - bh * 0.1} Q ${bodyCx - bw * 1.35} ${bodyCy + bh * 0.35} ${bodyCx - bw * 1.15} ${bodyCy + bh * 0.75}" stroke="${P.ink}" stroke-width="${m * 0.006}" fill="none" stroke-linecap="round"/>
        <path d="M ${neckBaseX} ${neckBaseY}
                 C ${neckBaseX + bw * 0.42} ${neckBaseY - H * 0.045} ${headX - bw * 0.42} ${headY + H * 0.085} ${headX - bw * 0.10} ${headY + H * 0.030}
                 S ${headX - m * 0.002} ${headY + m * 0.008} ${headX} ${headY}"
              stroke="${P.ink}" stroke-width="${m * 0.0095}" fill="none" stroke-linecap="round"/>
        <circle cx="${headX}" cy="${headY}" r="${headR}" fill="${P.ink}"/>
        <path d="M ${headX + headR * 0.8} ${headY + headR * 0.1} L ${headX + headR * 4.6} ${headY + headR * 0.9}" stroke="${P.rust}" stroke-width="${m * 0.0058}" stroke-linecap="round"/>
      </g>
      <g filter="url(#drybrush)"><path d="${brushStroke(W * 0.14, gy + m * 0.01, W * 0.86, gy + m * 0.012, m * 0.014, m * 0.008, 0)}" fill="${P.softInk}" opacity="0.75"/></g>` + svgClose(W, H);
  },

  // ————— HORIZONTAL ABOVE-BED PANORAMA —————
  "10-above-the-ridge": (W, H) => {
    const s = svgOpen(W, H, 101, P.paper);
    const m = Math.min(W, H), hy = H * 0.58;
    return s +
      `<g filter="url(#wobbleSoft)"><circle cx="${W * 0.72}" cy="${H * 0.30}" r="${m * 0.16}" fill="${P.terracotta}"/></g>
      <g filter="url(#wobble)">
        <path d="M ${-W * 0.02} ${hy + H * 0.06} L ${W * 0.13} ${hy - H * 0.10} L ${W * 0.24} ${hy + H * 0.02} L ${W * 0.38} ${hy - H * 0.20} L ${W * 0.52} ${hy - H * 0.01} L ${W * 0.63} ${hy - H * 0.12} L ${W * 0.76} ${hy + H * 0.03} L ${W * 0.9} ${hy - H * 0.07} L ${W * 1.02} ${hy + H * 0.04} L ${W * 1.02} ${H * 1.02} L ${-W * 0.02} ${H * 1.02} Z" fill="${P.ink}" opacity="0.92"/>
        <path d="M ${-W * 0.02} ${hy + H * 0.16} L ${W * 0.18} ${hy + H * 0.08} L ${W * 0.42} ${hy + H * 0.19} L ${W * 0.70} ${hy + H * 0.09} L ${W * 1.02} ${hy + H * 0.20} L ${W * 1.02} ${H * 1.02} L ${-W * 0.02} ${H * 1.02} Z" fill="${P.sage}" opacity="0.8"/>
      </g>
      <g filter="url(#drybrush)">
        <path d="${brushStroke(W * 0.06, H * 0.87, W * 0.94, H * 0.875, m * 0.03, m * 0.015, 0)}" fill="${P.sand}"/>
      </g>` + svgClose(W, H);
  },
};

// ---------- ratio tables (max common print size @300dpi) ----------
const PORTRAIT_RATIOS = {
  "2x3-24x36in": [7200, 10800],
  "3x4-18x24in": [5400, 7200],
  "4x5-16x20in": [4800, 6000],
  "11x14in": [3300, 4200],
  "ISO-A1": [7016, 9933],
};
const LANDSCAPE_RATIOS = {
  "3x2-36x24in": [10800, 7200],
  "4x3-24x18in": [7200, 5400],
  "5x4-20x16in": [6000, 4800],
  "14x11in": [4200, 3300],
  "ISO-A1-landscape": [9933, 7016],
};
const PREVIEW = { preview: [720, 900] }; // fast QC pass (4:5)
const PREVIEW_L = { preview: [1080, 720] };

// ---------- emit ----------
const outdir = process.argv[2] || "out-svg";
const mode = (process.argv.find((a) => a.startsWith("--ratios=")) || "--ratios=full").split("=")[1];
fs.mkdirSync(outdir, { recursive: true });

for (const [name, fn] of Object.entries(designs)) {
  const landscape = name.startsWith("10");
  const table = mode === "preview" ? (landscape ? PREVIEW_L : PREVIEW) : landscape ? LANDSCAPE_RATIOS : PORTRAIT_RATIOS;
  for (const [ratio, [w, h]] of Object.entries(table)) {
    const svg = fn(w, h);
    const f = path.join(outdir, `${name}__${ratio}.svg`);
    fs.writeFileSync(f, svg);
    console.log("wrote", f, `${w}x${h}`);
  }
}
