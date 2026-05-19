// Offline test: load app, register SW, kill network, reload, verify it still works.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

console.log('1. Loading app online…');
await page.goto(BASE, { waitUntil: 'networkidle' });
// Wait for SW registration
await page.waitForFunction(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg && reg.active;
}, { timeout: 10_000 });
console.log('   SW active');

// Wait for assets to be cached
await page.waitForTimeout(800);

const cacheInfo = await page.evaluate(async () => {
  const keys = await caches.keys();
  const out = {};
  for (const k of keys) {
    const c = await caches.open(k);
    const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
    out[k] = urls;
  }
  return out;
});
console.log('2. Cache contents:');
for (const [k, urls] of Object.entries(cacheInfo)) {
  console.log(`   ${k}:`);
  for (const u of urls) console.log(`     ${u}`);
}

console.log('3. Killing network…');
await ctx.setOffline(true);

console.log('4. Reloading offline…');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

const headerVisible = await page.$eval('header.topbar .brand', (el) => el.textContent.trim());
console.log(`   Header rendered offline: "${headerVisible}"`);

// Click through tabs to make sure JS works offline
for (const tab of ['inputs', 'proforma', 'sensitivity']) {
  await page.click(`nav.tabs button[data-tab="${tab}"]`);
  await page.waitForTimeout(80);
  const main = await page.$eval('#main', (el) => el.children.length);
  console.log(`   ${tab}: ${main} child elements rendered offline`);
}

await page.screenshot({ path: 'tests/screenshots/offline-test.png', fullPage: true });
console.log('   Screenshot: tests/screenshots/offline-test.png');

if (errors.length) {
  console.log('Errors:');
  for (const e of errors) console.log('  ' + e);
}
await browser.close();
console.log('\nOFFLINE TEST', errors.length === 0 ? 'PASSED' : 'FAILED');
process.exit(errors.length > 0 ? 1 : 0);
