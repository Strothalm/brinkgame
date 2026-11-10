// Takes screenshots of the default look and of several background and theme combinations.
//   node tools/e2e-look.cjs [outDir]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || path.join(__dirname, '../shots/look'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let errors = 0;

async function open(browser, base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors++; console.log(`[${name}] FEHLER:`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log(`[${name}] console:`, m.text()); } });
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

(async () => {
  const { createServer } = await import('../server/src/index.js');
  const app = createServer({ webDir: path.join(__dirname, '../client/dist') });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    const mod = await open(browser, base, 'Johann');
    await sleep(500);
    await shot(mod, '01-start');
    await mod.click('text=Einstellungen');
    await sleep(500);
    await shot(mod, '02-einstellungen-hintergrund');
    await mod.click('text=Zurück');
    await connect(mod);
    await shot(mod, '03-lobbyliste');
    await mod.click('text=Lobby erstellen');
    await mod.click('.modal-foot >> text=Erstellen');
    await mod.waitForSelector('.room');
    const code = (await mod.textContent('.code-chip b')).trim();
    const players = [];
    for (const n of ['Mira', 'Tobi', 'Lena']) { const p = await open(browser, base, n); await connect(p, code); players.push(p); }
    await mod.click('.pack-card:has-text("Geografie")');
    await mod.click('.pack-card:has-text("Allgemeinwissen")');
    await sleep(500);
    await shot(mod, '04-lobby');
    await mod.click('.panel-foot >> text=Spiel starten');
    await mod.waitForSelector('.board');
    await sleep(500);
    await shot(mod, '05-board');
    await mod.click('.tile:not(.used) >> nth=7');
    await sleep(300);
    await mod.keyboard.press('KeyB');
    await sleep(300);
    await players[0].keyboard.press('Space');
    await sleep(500);
    await shot(mod, '06-frage-moderator');
    await shot(players[1], '07-frage-spieler');
    await mod.keyboard.press('KeyR');
    await sleep(300);
    await mod.keyboard.press('KeyN');
    await sleep(400);

    // other combinations, switched live in the running game
    const combos = [['berge-schnee', 'schlicht'], ['stadt-nacht', 'neon'], ['wald-nebel', 'studio'], ['strand-abend', 'papier'], ['sterne-baeume', 'arcade']];
    for (const [bg, theme] of combos) {
      await mod.evaluate(([b, t]) => {
        const s = JSON.parse(localStorage.getItem('brink.settings') || '{}');
        s.theme = t; s.bg = { id: b, dim: 45, blur: 0, custom: '' };
        localStorage.setItem('brink.settings', JSON.stringify(s));
      }, [bg, theme]);
      await mod.reload();
      await mod.waitForSelector('.room, .home-name', { timeout: 15000 });
      await sleep(1200);
      await shot(mod, `08-${theme}-${bg}`);
    }
  } finally {
    await browser.close();
    await app.close();
  }
  console.log(errors ? `${errors} Fehler` : 'Keine Fehler');
  process.exit(errors ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
