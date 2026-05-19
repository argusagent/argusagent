// Test save → reload → load workflow.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8080/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

console.log('1. Loading and entering a custom MF deal');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('.mode-toggle button[data-mode="mf"]');
await page.waitForTimeout(100);
await page.click('nav.tabs button[data-tab="inputs"]');
await page.waitForTimeout(150);
// Change purchase price
await page.fill('#i_purchasePrice', '20000000');
await page.evaluate(() => document.getElementById('i_purchasePrice').blur());
await page.waitForTimeout(150);

console.log('2. Saving the deal');
await page.click('#save-deal');
await page.waitForTimeout(100);
await page.fill('#dialog-name', 'TEST PERSIST 20M');
await page.click('#dialog-save');
await page.waitForTimeout(150);

console.log('3. Reading saved deals before reload');
const before = await page.evaluate(() => {
  const raw = localStorage.getItem('underwritepro.v1');
  const s = JSON.parse(raw);
  return s.savedDeals.map((d) => ({ name: d.name, mode: d.mode, price: d.inputs.purchasePrice }));
});
console.log('   ', JSON.stringify(before));

console.log('4. Reloading page (full reload, simulating quit & relaunch)');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(200);

await page.click('nav.tabs button[data-tab="saved"]');
await page.waitForTimeout(150);
const savedItems = await page.$$eval('.saved-item .title', (els) => els.map((e) => e.textContent.trim()));
console.log(`   Saved items shown: ${JSON.stringify(savedItems)}`);

console.log('5. Loading the saved deal');
await page.click('button[data-action="load-deal"]');
await page.waitForTimeout(200);
await page.click('nav.tabs button[data-tab="inputs"]');
await page.waitForTimeout(150);
const priceVal = await page.$eval('#i_purchasePrice', (el) => el.value);
console.log(`   purchase price after load: ${priceVal}`);

const pass = savedItems.includes('TEST PERSIST 20M') && parseInt(priceVal, 10) === 20000000;
console.log('\nPERSIST TEST', pass ? 'PASSED' : 'FAILED');
if (errors.length) console.log('Errors:', errors.join('\n'));

// Clean up to not leave stale data for other tests
await page.evaluate(() => localStorage.removeItem('underwritepro.v1'));

await browser.close();
process.exit(pass ? 0 : 1);
