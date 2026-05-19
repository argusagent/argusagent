import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.click('.mode-toggle button[data-mode="mf"]');
await page.waitForTimeout(150);
await page.click('nav.tabs button[data-tab="proforma"]');
await page.waitForTimeout(200);
// Read all reno capex values
const renoRow = await page.evaluate(() => {
  const rows = document.querySelectorAll('table.tbl tbody tr');
  for (const r of rows) {
    const cells = r.querySelectorAll('td');
    if (cells[0] && cells[0].textContent.includes('Reno CapEx')) {
      return Array.from(cells).map(c => c.textContent);
    }
  }
  return null;
});
console.log('Reno CapEx row:', JSON.stringify(renoRow));
await browser.close();
