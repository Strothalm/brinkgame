// Spielt mit einem iPhone und einem iPad (Emulation) gegen einen Moderator am PC und macht Screenshots.
//   node tools/e2e-mobile.cjs [outDir]
const path = require('node:path');
const fs = require('node:fs');
const { chromium, devices } = require('playwright');
const out = path.resolve(process.argv[2] || path.join(__dirname, '../shots/mobile'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let errors = 0;

async function open(browser, base, name, device) {
  const ctx = await browser.newContext({ ...(device || { viewport: { width: 1600, height: 900 } }), permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors++; console.log(`[${name}] FEHLER:`, e.message); });
  await page.goto(base);
  await page.fill('.home-name input', name);
  return page;
}
async function connect(page, code) {
  await page.click('text=Spielen');
  await page.click('.server-row >> text=Verbinden');
  await page.waitForSelector('.join-bar');
  if (code) {
    await page.fill('#joincode', code);
    await page.click('.join-code-row >> text=Beitreten');
    await page.waitForSelector('.room');
  }
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

(async () => {
  const { createServer } = await import('../server/src/index.js');
  const app = createServer({ webDir: path.join(__dirname, '../client/dist') });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    const mod = await open(browser, base, 'Johann');
    await connect(mod);
    await mod.click('text=Lobby erstellen');
    await mod.click('.modal-foot >> text=Erstellen');
    await mod.waitForSelector('.room');
    const code = (await mod.textContent('.code-chip b')).trim();
    const phone = await open(browser, base, 'Mira', devices['iPhone 13']);
    await shot(phone, 'iphone-01-start');
    await connect(phone, code);
    const pad = await open(browser, base, 'Tobi', devices['iPad (gen 7)']);
    await connect(pad, code);
    const other = await open(browser, base, 'Lena');
    await connect(other, code);
    await mod.click('.pack-card:has-text("Geografie")');
    await sleep(500);
    await shot(phone, 'iphone-02-lobby');
    await shot(pad, 'ipad-02-lobby');
    console.log('Querscrollen Lobby: iPhone', await overflow(phone), '| iPad', await overflow(pad));
    await mod.click('.panel-foot >> text=Spiel starten');
    await phone.waitForSelector('.board');
    await sleep(600);
    await shot(phone, 'iphone-03-board');
    await shot(pad, 'ipad-03-board');
    await mod.click('.tile:not(.used) >> nth=7');
    await sleep(300);
    await mod.keyboard.press('KeyB');
    await sleep(400);
    await shot(phone, 'iphone-04-frage');
    await shot(pad, 'ipad-04-frage');
    console.log('Querscrollen Frage: iPhone', await overflow(phone), '| iPad', await overflow(pad));
  } finally {
    await browser.close();
    await app.close();
  }
  console.log(errors ? `${errors} Fehler` : 'Keine Fehler');
  process.exit(errors ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
