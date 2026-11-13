// Plays one clue with the rule "Wer wählt, antwortet": team answers, wrong, the solo player steals, turn rotates.
//   node tools/e2e-chooser.cjs [outDir]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const out = path.resolve(process.argv[2] || path.join(__dirname, '../shots/chooser'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let errors = 0;

async function open(browser, base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors++; console.log(`[${name}] FEHLER:`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/getUserMedia|NotFound|Permission/i.test(m.text())) { errors++; console.log(`[${name}] console:`, m.text()); } });
  await page.goto(base);
  await page.fill('.home-name input', name);
  await page.click('text=Spielen');
  await page.click('.server-row >> text=Verbinden');
  await page.waitForSelector('.join-bar');
  return page;
}
async function join(page, code) {
  await page.fill('#joincode', code);
  await page.click('.join-code-row >> text=Beitreten');
  await page.waitForSelector('.room');
}

(async () => {
  const { createServer } = await import('../server/src/index.js');
  const app = createServer({ webDir: path.join(__dirname, '../client/dist') });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch();
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    const mod = await open(browser, base, 'Johann');
    await mod.click('text=Lobby erstellen');
    await mod.click('.modal-foot >> text=Erstellen');
    await mod.waitForSelector('.room');
    const code = (await mod.textContent('.code-chip b')).trim();
    const [mira, tobi, lena] = [await open(browser, base, 'Mira'), await open(browser, base, 'Tobi'), await open(browser, base, 'Lena')];
    for (const p of [mira, tobi, lena]) await join(p, code);
    await mira.click('text=Team gründen');
    await sleep(300);
    await tobi.click('.team-card >> text=Beitreten');
    await mod.click('.pack-card:has-text("Geografie")');
    await mod.click('.panel-head.tabs >> text=Regeln');
    console.log('Standard in den Regeln:', (await mod.locator('.rules .seg button.on').allTextContents()).slice(0, 3).join(' | '));
    await sleep(300);
    await shot(mod, '01-regeln');
    await mod.click('.panel-foot >> text=Spiel starten');
    await mod.waitForSelector('.board');
    // make the team the chooser
    await mod.click('.modpanel .seg >> text=Punkte');
    await mod.click('.mod-scores li:has-text("Team") >> text=wählt');
    await mod.click('.modpanel .seg >> text=Steuerung');
    await sleep(400);
    await shot(lena, '02-brett-lena');
    await shot(mira, '03-brett-mira');
    await mira.click('.tile:not(.used) >> nth=2');
    await sleep(400);
    await shot(lena, '04-lesen-lena');
    await shot(mira, '05-lesen-team');
    await shot(mod, '06-lesen-moderator');
    // a player of the other side pressing space must not do anything
    await lena.keyboard.press('Space');
    await mod.keyboard.press('KeyB');
    await sleep(500);
    await shot(lena, '07-antwort-lena');
    await shot(mira, '08-antwort-team');
    await shot(mod, '09-antwort-moderator');
    console.log('Moderator sieht:', (await mod.locator('.mod-who').first().innerText()).replace(/\n/g, ' | '));
    await mod.keyboard.press('KeyF');
    await sleep(500);
    await shot(lena, '10-klauen-lena');
    await shot(mira, '11-klauen-team-gesperrt');
    await lena.keyboard.press('Space');
    await sleep(500);
    await mod.keyboard.press('KeyR');
    await sleep(500);
    await shot(lena, '12-aufloesung');
    await mod.keyboard.press('KeyN');
    await sleep(500);
    await shot(lena, '13-naechste-lena-dran');
    console.log('Banner bei Lena:', (await lena.locator('.turn-banner').innerText()).replace(/\n/g, ' '));
    console.log('Wertung:', (await mod.locator('.pod').allTextContents()).join(' | '));
  } finally {
    await browser.close();
    await app.close();
  }
  console.log(errors ? `${errors} Fehler in der Oberfläche` : 'Keine Fehler in der Oberfläche');
  process.exit(errors ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
