#!/usr/bin/env node
/** Room-scene mockup generator. Emits HTML scenes that frame preview PNGs;
 *  render with Chromium at 2700x2025 (Etsy hero image). */
const fs = require("fs");
const path = require("path");

const px = (n) => `${n}px`;
const SCENE_W = 2700, SCENE_H = 2025;

const frame = (img, w, h, extra = "") => `
  <div class="frame" style="width:${px(w)};height:${px(h)};${extra}">
    <div class="mat"><img src="${img}"></div>
  </div>`;

const scene = (inner, wall = "#EDE6DA") => `<!doctype html><html><head><style>
  * { margin:0; box-sizing:border-box; }
  body { width:${px(SCENE_W)}; height:${px(SCENE_H)}; overflow:hidden;
    font-family: Georgia, serif;
    background:
      radial-gradient(ellipse 120% 90% at 50% -10%, rgba(255,255,255,0.55), rgba(255,255,255,0) 60%),
      linear-gradient(180deg, ${wall} 0%, ${wall} 78.5%, #D9CFC0 78.5%, #CFC4B3 79%, #E3DACB 79.2%, #DDD3C2 100%);
  }
  .room { position:relative; width:100%; height:100%; }
  /* soft window light from the left */
  .light { position:absolute; inset:0;
    background: linear-gradient(100deg, rgba(255,252,245,0.35) 0%, rgba(255,252,245,0) 45%),
                radial-gradient(ellipse 60% 45% at 82% 100%, rgba(90,80,66,0.10), rgba(0,0,0,0) 70%); }
  .frames { position:absolute; left:50%; top:44%; transform:translate(-50%,-50%);
    display:flex; gap:72px; align-items:center; }
  .frame { background:#2E2B26; padding:16px; box-shadow: 0 22px 44px rgba(55,51,43,0.30), 0 4px 10px rgba(55,51,43,0.18); }
  .frame.oak { background:#B49B76; }
  .mat { background:#FAF7F0; padding:34px; width:100%; height:100%; }
  .mat img { width:100%; height:100%; object-fit:cover; display:block; }
  .shelf { position:absolute; left:50%; transform:translateX(-50%); top:78.5%; }
  .bench { width:1150px; height:26px; background:#B49B76; border-radius:6px 6px 3px 3px;
    box-shadow: 0 30px 40px rgba(55,51,43,0.22); position:relative; }
  .bench:before, .bench:after { content:""; position:absolute; top:26px; width:26px; height:250px; background:#A8906C; }
  .bench:before { left:90px; } .bench:after { right:90px; }
  .vase { position:absolute; left:50%; transform:translateX(-50%); top:-170px; width:110px; height:170px;
    background:#C1704F; border-radius:22px 22px 46px 46px / 30px 30px 60px 60px; }
  .vase:before { content:""; position:absolute; left:50%; top:-96px; width:5px; height:104px; background:#6F7A5E;
    transform:translateX(-50%) rotate(4deg); border-radius:3px;
    box-shadow: -26px 8px 0 -1px #6F7A5E, 22px 12px 0 -1px #96A48A; }
  .plant { position:absolute; right:150px; bottom:0; width:340px; height:700px; }
  .plant .pot { position:absolute; bottom:0; left:50%; transform:translateX(-50%);
    width:230px; height:190px; background:#DCCDB8; border-radius:14px 14px 60px 60px; box-shadow: inset -20px -14px 0 rgba(55,51,43,0.08); }
  .plant .leaf { position:absolute; bottom:150px; left:50%; width:16px; height:460px; background:#7A8468;
    border-radius:50% 50% 0 0; transform-origin:bottom center; }
  .bed { position:absolute; left:50%; transform:translateX(-50%); top:66%; width:1750px; }
  .headboard { width:100%; height:230px; background:#CBB89C; border-radius:26px 26px 0 0; }
  .mattress { width:100%; height:250px; background:#F5F0E6; border-radius:12px;
    box-shadow: 0 36px 60px rgba(55,51,43,0.25); position:relative; }
  .pillow { position:absolute; top:-64px; width:420px; height:150px; background:#EFE7D9; border-radius:26px;
    box-shadow: 0 8px 16px rgba(55,51,43,0.12); }
  .throw { position:absolute; right:0; bottom:0; width:430px; height:250px; background:#9AA48A; border-radius:0 12px 12px 0; }
</style></head><body><div class="room">${inner}<div class="light"></div></div></body></html>`;

const trioScene = (imgs, fw, fh, oak = false) =>
  scene(`
    <div class="frames">${imgs.map((i) => frame(i, fw, fh, oak ? "" : "")).join("")}</div>
    <div class="shelf"><div class="bench"><div class="vase"></div></div></div>
    <div class="plant"><span class="leaf" style="transform:translateX(-50%) rotate(-14deg)"></span>
      <span class="leaf" style="transform:translateX(-50%) rotate(2deg);height:520px"></span>
      <span class="leaf" style="transform:translateX(-50%) rotate(16deg);height:430px"></span><div class="pot"></div></div>`);

const sixScene = (imgs, fw, fh) =>
  scene(`
    <div class="frames" style="top:42%; display:grid; grid-template-columns:repeat(3,${px(fw)}); gap:56px 64px;">
      ${imgs.map((i) => frame(i, fw, fh)).join("")}</div>
    <div class="shelf"><div class="bench" style="width:1500px"><div class="vase"></div></div></div>`);

const bedScene = (img, fw, fh) =>
  scene(`
    <div class="frames" style="top:26%;">${frame(img, fw, fh)}</div>
    <div class="bed">
      <div class="headboard"></div>
      <div class="mattress">
        <div class="pillow" style="left:120px"></div>
        <div class="pillow" style="left:600px"></div>
        <div class="throw"></div>
      </div>
    </div>`);

const singleScene = (img, fw, fh) =>
  scene(`
    <div class="frames" style="top:45%">${frame(img, fw, fh)}</div>
    <div class="plant" style="right:auto; left:190px;">
      <span class="leaf" style="transform:translateX(-50%) rotate(-16deg)"></span>
      <span class="leaf" style="transform:translateX(-50%) rotate(0deg);height:540px"></span>
      <span class="leaf" style="transform:translateX(-50%) rotate(13deg);height:440px"></span><div class="pot"></div></div>
    <div class="shelf" style="left:72%;"><div class="bench" style="width:700px"><div class="vase" style="left:30%"></div></div></div>`);

const p = (n) => path.resolve(__dirname, `previews-png/${n}__preview.png`);
const out = path.join(__dirname, "mockup-html");
fs.mkdirSync(out, { recursive: true });

const scenes = {
  "listing1-arch-trio": trioScene([p("01-arc-and-sun"), p("02-layered-arches"), p("03-arch-botanical")], 620, 775),
  "listing2-wabi-trio": trioScene([p("04-enso-sun"), p("05-balance"), p("06-brushfield")], 620, 775),
  "listing3-sumi-trio": trioScene([p("07-ridge"), p("08-still-lake"), p("09-heron")], 620, 775),
  "listing4-gallery-six": sixScene(
    [p("01-arc-and-sun"), p("04-enso-sun"), p("07-ridge"), p("05-balance"), p("02-layered-arches"), p("08-still-lake")], 470, 585),
  "listing5-above-bed": bedScene(p("10-above-the-ridge"), 1280, 855),
  "single-04": singleScene(p("04-enso-sun"), 900, 1125),
  "single-07": singleScene(p("07-ridge"), 900, 1125),
  "single-09": singleScene(p("09-heron"), 900, 1125),
};
for (const [name, html] of Object.entries(scenes)) {
  fs.writeFileSync(path.join(out, `${name}.html`), html);
  console.log("wrote", name);
}
