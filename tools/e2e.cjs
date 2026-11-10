// End-to-end check: starts the server, opens one moderator and several players in real browsers
// (with fake camera and microphone), plays through a round and writes screenshots.
//   node tools/e2e.cjs [outDir] [theme]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || path.join(__dirname, '../shots'));
const theme = process.argv[3] || 'neon';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

async function join(browser, base, name, { code, theme: th } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] console:`, m.text()));
  await page.addInitScript((t) => {
    if (!localStorage.getItem('brink.settings')) localStorage.setItem('brink.settings', JSON.stringify({ theme: t }));
  }, th || theme);
  await page.goto(base);
  await page.fill('.home-name input', name);
  await page.click('text=Spielen');
  await page.click('.server-row >> text=Verbinden');
  await page.waitForSelector('.join-bar');
  if (code) {
    await page.fill('#joincode', code);
    await page.click('.join-code-row >> text=Beitreten');
    await page.waitForSelector('.room');
  }
  return page;
}

(async () => {
  const { createServer } = await import('../server/src/index.js');
  const app = createServer({ webDir: path.join(__dirname, '../client/dist') });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    const mod = await join(browser, base, 'Johann');
    await shot(mod, '01-browser');
    await mod.click('text=Lobby erstellen');
    await mod.click('.modal-foot >> text=Erstellen');
    await mod.waitForSelector('.room', { timeout: 8000 }).catch(async (e) => {
      await shot(mod, 'fail');
      throw e;
    });
    const code = (await mod.textContent('.code-chip b')).trim();
    console.log('lobby', code);

    const names = ['Mira', 'Tobi', 'Lena', 'Kaan', 'Paul'];
    const players = [];
    for (const n of names) players.push(await join(browser, base, n, { code }));
    // two players form a team, the rest stay solo
    await players[0].click('text=Team gründen');
    await sleep(300);
    await players[1].click('.team-card >> text=Beitreten');
    await players[0].click('[aria-label="Kamera"]');
    await players[2].click('[aria-label="Kamera"]');
    await mod.click('[aria-label="Kamera"]');
    await sleep(2500);

    await mod.click('.pack-card >> nth=0');
    await sleep(300);
    await shot(mod, '02-lobby-mod');
    await shot(players[3], '03-lobby-player');
    await mod.click('text=Regeln');
    await sleep(200);
    await shot(mod, '04-rules');
    await mod.click('text=Board ansehen');
    await sleep(400);
    await shot(mod, '05-preview');
    await mod.click('.modal-foot >> text=Spiel starten');
    await mod.waitForSelector('.board');
    await sleep(900);
    await shot(mod, '06-board-mod');
    await shot(players[3], '07-board-player');

    // voice check: every participant should have connected peers
    const peers = await players[3].evaluate(() => Array.from(document.querySelectorAll('.cam-video')).filter((v) => v.srcObject && v.videoWidth > 0).length);
    console.log('remote videos visible for Kaan:', peers);

    await mod.click('.tile >> nth=7');
    await mod.waitForSelector('.clue-card');
    await sleep(500);
    await shot(players[3], '08-clue-closed');
    await mod.click('text=Buzzer freigeben');
    await sleep(400);
    await shot(players[3], '09-buzz-open');
    await players[2].keyboard.press('Space');
    await sleep(600);
    await shot(players[3], '10-answering');
    await shot(mod, '11-answering-mod');
    await mod.keyboard.press('KeyF');
    await sleep(400);
    await players[0].keyboard.press('Space');
    await sleep(500);
    await mod.keyboard.press('KeyR');
    await sleep(500);
    await shot(players[3], '12-reveal');
    await mod.keyboard.press('KeyN');
    await sleep(500);
    await shot(players[0], '13-board-chooser');
    const scores = await mod.evaluate(() => Array.from(document.querySelectorAll('.pod')).map((p) => p.textContent.trim()));
    console.log('podium:', scores.join(' | '));
  } finally {
    await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
