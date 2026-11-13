// Plays one complete short game (risk field, final, end screen) and opens every other screen once.
//   node tools/e2e-full.cjs [outDir] [theme]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || path.join(__dirname, '../shots/full'));
const theme = process.argv[3] || 'studio';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
let errors = 0;

async function open(browser, base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors++; console.log(`[${name}] FEHLER:`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log(`[${name}] console:`, m.text()); } });
  await page.addInitScript((t) => { if (!localStorage.getItem('brink.settings')) localStorage.setItem('brink.settings', JSON.stringify({ theme: t })); }, theme);
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
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    const mod = await open(browser, base, 'Johann');

    // pack library and editor
    await mod.click('text=Fragenpakete');
    await mod.waitForSelector('.lib-grid');
    console.log('Pakete in der Bibliothek:', await mod.locator('.lib-card').count());
    await shot(mod, '01-bibliothek');
    await mod.click('.lib-card:has-text("Streamer") >> text=Bearbeiten');
    await mod.fill('.search.big input', 'Knossi');
    await sleep(300);
    console.log('Treffer für "Knossi":', (await mod.textContent('.q-bulk strong')).trim());
    await shot(mod, '02-editor-suche');
    await mod.click('text=Treffer ausschalten');
    await sleep(200);
    console.log('ausgeschaltet:', await mod.locator('.q-row.off').count());
    await mod.click('text=Treffer einschalten');
    await mod.fill('.search.big input', '');
    await mod.click('text=Frage hinzufügen');
    await mod.fill('.q-form textarea', 'Testfrage aus dem Testlauf?');
    await mod.fill('.q-form input[placeholder="Wolga"]', 'Testantwort');
    await mod.click('.q-form >> text=Speichern');
    await sleep(200);
    await mod.click('text=Alle Pakete');
    await mod.click('.lib-card:has-text("Streamer") [aria-label="Zurücksetzen"]');
    await mod.click('.modal-foot >> text=Zurücksetzen');
    await mod.click('text=Neues Paket');
    await mod.waitForSelector('.editor');
    await mod.click('text=Als Text einfügen');
    await mod.fill('.modal textarea', '# Test\n1 | A? | a\n2 | B? | b\n3 | C? | c\n4 | D? | d\n5 | E? | e');
    await mod.click('.modal-foot >> text=Hinzufügen');
    await sleep(200);
    console.log('eigenes Paket, Fragen:', await mod.locator('.q-row').count());
    await mod.click('text=Alle Pakete');
    await mod.click('text=Zurück');

    // settings screen
    await mod.click('text=Einstellungen');
    for (const tab of ['Sprachchat', 'Kamera', 'Tasten', 'Design']) {
      await mod.click(`.settings .seg >> text=${tab}`);
      await sleep(250);
    }
    await mod.click('.settings .seg >> text=Sprachchat');
    await sleep(600);
    await shot(mod, '03-einstellungen-sprachchat');
    await mod.click('text=Zurück');

    // lobby
    await connect(mod);
    await mod.click('text=Lobby erstellen');
    await mod.click('.modal-foot >> text=Erstellen');
    await mod.waitForSelector('.room');
    const code = (await mod.textContent('.code-chip b')).trim();
    const players = [];
    for (const n of ['Mira', 'Tobi', 'Lena']) {
      const p = await open(browser, base, n);
      await connect(p, code);
      players.push(p);
    }
    await mod.click('.pack-card:has-text("Historische")');
    await mod.click('.pack-card:has-text("Geografie")');
    await mod.click('.panel-head.tabs >> text=Regeln');
    await mod.click('.rules >> text=1 Runde');
    await mod.click('.rules .seg >> text="3"');
    await mod.click('.rules >> text=Sofort');
    await mod.click('.rules >> text=Anti-Cheat');
    await sleep(300);
    await mod.click('.panel-head.tabs >> text=Voreinstellungen');
    await mod.fill('.presets input', 'Testrunde');
    await mod.click('text=Aktuelle Einstellungen speichern');
    await sleep(300);
    await shot(mod, '04-voreinstellungen');
    await mod.click('.panel-foot >> text=Spiel starten');
    await mod.waitForSelector('.board');
    await sleep(600);

    // moderator panel tabs
    await mod.click('.modpanel .seg >> text=Punkte');
    await sleep(150);
    await mod.click('.modpanel .seg >> text=Anti-Cheat');
    await sleep(200);
    await shot(mod, '05-anticheat-panel');
    await mod.click('.modpanel >> text=Protokoll');
    await sleep(200);
    await mod.keyboard.press('Escape');
    await mod.click('.modpanel .seg >> text=Steuerung');

    // play all 15 clues
    let dd = 0;
    for (let i = 0; i < 15; i++) {
      await mod.click('.tile:not(.used) >> nth=0', { timeout: 8000 }).catch(async (e) => {
        await shot(mod, `fehler-feld-${i}`);
        console.log('Feld', i, 'Phase:', await mod.evaluate(() => document.querySelector('.modpanel')?.innerText.slice(0, 200)));
        throw e;
      });
      await sleep(250);
      if (await mod.locator('.dd').count()) {
        dd++;
        await shot(players[0], '06-risiko');
        await mod.click('.wager >> text=Setzen');
        await sleep(250);
        await mod.keyboard.press('KeyR');
      } else if (i % 3 === 0) {
        await players[i % players.length].keyboard.press('Space');
        await sleep(350);
        await mod.keyboard.press(i % 2 ? 'KeyF' : 'KeyR');
        await sleep(200);
        if (!(await mod.locator('.result').count())) await mod.keyboard.press('KeyA');
      } else {
        await mod.keyboard.press('KeyA');
      }
      await sleep(250);
      await mod.keyboard.press('KeyN');
      await sleep(200);
    }
    console.log('Risiko-Felder gespielt:', dd);
    await mod.waitForSelector('.interlude');
    await shot(players[0], '07-rundenende');
    await mod.keyboard.press('KeyN');
    await sleep(400);

    // final
    for (const p of players) {
      await p.fill('.wager input', '300');
      await p.click('.wager >> text=Setzen');
    }
    await sleep(300);
    await shot(players[0], '08-finale-einsatz');
    await mod.click('.modpanel >> text=Frage zeigen');
    await sleep(300);
    for (const p of players) {
      await p.fill('.final-answer input', 'Meine Antwort');
      await p.keyboard.press('Enter');
    }
    await sleep(300);
    await shot(players[0], '09-finale-frage');
    await mod.click('.modpanel >> text=Antworten auflösen');
    await sleep(300);
    await mod.keyboard.press('KeyR');
    await sleep(250);
    await mod.keyboard.press('KeyF');
    await sleep(250);
    await shot(mod, '10-finale-aufloesung');
    await mod.keyboard.press('KeyR');
    await mod.waitForSelector('.interlude.ended');
    await sleep(1200);
    await shot(players[0], '11-endstand');
    console.log('Endstand:', (await mod.locator('.ranking li').allTextContents()).join(' | '));
    await mod.click('.modpanel >> text=Zurück zur Lobby');
    await mod.waitForSelector('.lobby');
    console.log('Voreinstellung gespeichert:', await mod.evaluate(() => JSON.parse(localStorage.getItem('brink.presets') || '[]').length));
  } finally {
    await browser.close();
    await app.close();
  }
  console.log(errors ? `${errors} Fehler in der Oberfläche` : 'Keine Fehler in der Oberfläche');
  process.exit(errors ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
