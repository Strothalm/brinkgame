// Renders the app icon (PNG and ICO) from an inline SVG. Run once: node tools/make-icon.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const out = path.join(__dirname, '../client/build');
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="44" fill="#070910"/>
  <rect x="40" y="40" width="80" height="80" rx="10" fill="#2a3350"/>
  <rect x="136" y="40" width="80" height="80" rx="10" fill="#19e3ff"/>
  <rect x="40" y="136" width="80" height="80" rx="10" fill="#2a3350"/>
  <rect x="136" y="136" width="80" height="80" rx="10" fill="#ff2d87"/>
</svg>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const sizes = [256, 64, 48, 32, 16];
  const pngs = [];
  for (const s of sizes) {
    const page = await browser.newPage({ viewport: { width: s, height: s } });
    await page.setContent(`<body style="margin:0;background:transparent">${svg(s)}</body>`);
    pngs.push(await page.screenshot({ omitBackground: true }));
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'icon.png'), pngs[0]);
  // ICO container with embedded PNG images
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s === 256 ? 0 : s, 0);
    e.writeUInt8(s === 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  });
  fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
  console.log('icon.png und icon.ico geschrieben');
})();
