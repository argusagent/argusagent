// Browser smoke test: navigate the app, click through tabs, capture screenshots,
// and report console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = 'tests/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 };

async function run(label, deviceOpts) {
  const ctx = await browser.newContext(deviceOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('[' + m.type() + '] ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  console.log(`\n--- ${label} ---`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  // Test SF dashboard
  await page.screenshot({ path: `${OUT}/${label}-01-sf-dashboard.png`, fullPage: true });
  console.log(`  shot: SF dashboard`);

  // Inputs
  await page.click('nav.tabs button[data-tab="inputs"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${label}-02-sf-inputs.png`, fullPage: true });
  console.log(`  shot: SF inputs`);

  // Pro Forma
  await page.click('nav.tabs button[data-tab="proforma"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${label}-03-sf-proforma.png`, fullPage: true });
  console.log(`  shot: SF pro forma`);

  // Toggle after-tax (input is display:none — click its visible label wrapper)
  await page.evaluate(() => {
    const cb = document.getElementById('proforma-toggle');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${label}-04-sf-proforma-aftertax.png`, fullPage: true });
  console.log(`  shot: SF pro forma (after-tax)`);

  // Sensitivity
  await page.click('nav.tabs button[data-tab="sensitivity"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${label}-05-sf-sensitivity.png`, fullPage: true });
  console.log(`  shot: SF sensitivity`);

  // Switch to MF
  await page.click('.mode-toggle button[data-mode="mf"]');
  await page.waitForTimeout(200);
  await page.click('nav.tabs button[data-tab="dashboard"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${label}-06-mf-dashboard.png`, fullPage: true });
  console.log(`  shot: MF dashboard`);

  await page.click('nav.tabs button[data-tab="inputs"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${label}-07-mf-inputs.png`, fullPage: true });
  console.log(`  shot: MF inputs`);

  await page.click('nav.tabs button[data-tab="proforma"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${label}-08-mf-proforma.png`, fullPage: true });
  console.log(`  shot: MF pro forma`);

  await page.click('nav.tabs button[data-tab="waterfall"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${label}-09-mf-waterfall.png`, fullPage: true });
  console.log(`  shot: MF waterfall`);

  await page.click('nav.tabs button[data-tab="sensitivity"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/${label}-10-mf-sensitivity.png`, fullPage: true });
  console.log(`  shot: MF sensitivity`);

  // Save deal
  await page.click('#save-deal');
  await page.waitForTimeout(100);
  await page.click('#dialog-save');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${label}-11-saved.png`, fullPage: true });
  console.log(`  shot: Saved`);

  if (errors.length) {
    console.log(`  console errors (${errors.length}):`);
    for (const e of errors) console.log('    ' + e);
  } else {
    console.log(`  no console errors`);
  }
  await ctx.close();
  return errors;
}

const phoneErrors = await run('phone', phone);
const desktopErrors = await run('desktop', desktop);

await browser.close();

console.log(`\nTotal errors: phone=${phoneErrors.length}, desktop=${desktopErrors.length}`);
process.exit((phoneErrors.length + desktopErrors.length) > 0 ? 1 : 0);
