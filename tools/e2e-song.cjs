// Spielt eine Tonfrage aus "Musik: Wie heißt der Song?" und prüft, dass der Ton bei allen ankommt.
//   node tools/e2e-song.cjs [outDir]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const out = path.resolve(process.argv[2] || path.join(__dirname, '../shots/song'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let errors = 0;

async function open(browser, base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors++; console.log(`[${name}] FEHLER:`, e.message); });
  await page.goto(base);
  await page.fill('.home-name input', name);
  await page.click('text=Spielen');
  await page.click('.server-row >> text=Verbinden');
  await page.waitForSelector('.join-bar');
  return page;
}

(async () => {
  const { createServer } = await import('../server/src/index.js');
  const app = createServer({ webDir: path.join(__dirname, '../client/dist') });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const mod = await open(browser, base, 'Johann');
    await mod.click('text=Lobby erstellen');
    await mod.click('.modal-foot >> text=Erstellen');
    await mod.waitForSelector('.room');
    const code = (await mod.textContent('.code-chip b')).trim();
    const p1 = await open(browser, base, 'Mira');
    await p1.fill('#joincode', code); await p1.click('.join-code-row >> text=Beitreten'); await p1.waitForSelector('.room');
    const p2 = await open(browser, base, 'Tobi');
    await p2.fill('#joincode', code); await p2.click('.join-code-row >> text=Beitreten'); await p2.waitForSelector('.room');

    await mod.click('.pack-card:has-text("Musik") .pack-main');
    await mod.click('.pack-card:has-text("Musik") >> text=Kategorien wählen');
    await mod.click('.modal-foot >> text=Keine');
    await mod.click('.check-list label:has-text("Wie heißt der Song?")');
    await mod.click('.modal-foot >> text=Fertig');
    await mod.click('.panel-foot >> text=Spiel starten');
    await mod.waitForSelector('.board');
    const titles = await mod.$$eval('.board-cat', (els) => els.map((e) => e.textContent.trim()));
    console.log('Kategorien auf dem Board:', [...new Set(titles.map((t) => t.replace(/MUSIK$/i, '')))].join(' | '));

    // ein Feld wählen (wer dran ist, ist egal: alle Fenster probieren)
    let picked = false;
    for (const pg of [mod, p1, p2]) {
      const t = pg.locator('.board.pickable .tile:not(.used)').nth(1);
      if (await t.count()) { await t.click(); picked = true; break; }
    }
    await mod.waitForSelector('.clue-card', { timeout: 10000 });
    await sleep(2500);
    for (const [n, pg] of [['Moderator', mod], ['Mira', p1], ['Tobi', p2]]) {
      const info = await pg.evaluate(() => {
        const a = document.querySelector('.clue-card audio');
        return a ? { src: a.currentSrc.replace(/\?.*/, '').slice(0, 60), paused: a.paused, t: Math.round(a.currentTime * 10) / 10, dur: Math.round(a.duration), err: a.error?.code ?? null, vol: a.volume } : null;
      });
      console.log(n.padEnd(10), JSON.stringify(info));
      if (!info || info.err) errors++;
    }
    await mod.screenshot({ path: path.join(out, 'moderator.png') });
    await p1.screenshot({ path: path.join(out, 'spieler.png') });
    const antwort = await mod.textContent('.mod-answer strong').catch(() => '');
    console.log('Antwort beim Moderator:', antwort);
  } finally {
    await browser.close();
    await app.close();
  }
  console.log(errors ? `${errors} Fehler` : 'Keine Fehler');
  process.exit(errors ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
