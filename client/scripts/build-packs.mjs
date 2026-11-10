// Compiles the pack sources in client/packs/*.txt into src/renderer/builtin-packs.json.
//
// Source format:
//   @id geografie            @name Welt & Geografie      @icon 🌍      @color #3aa0ff
//   @desc Kurzbeschreibung   @type flags (optional: Zeilen sind dann "Stufe | Ländercode | Antwort")
//   # Kategoriename
//   Stufe | Frage | Antwort | Hinweis für den Moderator (optional)
//   Ein Bild steht vorn in der Frage: [flag:de] oder [img:https://…]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'packs');
const outFile = path.join(root, 'src/renderer/builtin-packs.json');
const strict = process.argv.includes('--strict');

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

export function parsePack(text, file = '') {
  const pack = { id: '', name: '', icon: '', color: '', desc: '', builtin: true, cats: [], qs: [] };
  let type = 'text';
  let cat = null;
  const problems = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('//')) return;
    if (raw.startsWith('@')) {
      const m = raw.match(/^@(\w+)\s+(.*)$/);
      if (!m) return;
      if (m[1] === 'type') type = m[2].trim();
      else pack[m[1]] = m[2].trim();
      return;
    }
    if (raw.startsWith('#')) {
      const name = raw.replace(/^#+\s*/, '');
      cat = { id: slug(name), name };
      pack.cats.push(cat);
      return;
    }
    const parts = raw.split('|').map((p) => p.trim());
    const level = Number(parts[0]);
    if (!cat || !(level >= 1 && level <= 5) || parts.length < 3) {
      problems.push(`${file}:${idx + 1} unlesbar: ${raw.slice(0, 60)}`);
      return;
    }
    let q = parts[1];
    let img = '';
    const a = parts[2];
    const n = parts[3] ?? '';
    if (type === 'flags') {
      img = `flag:${q.toLowerCase()}`;
      q = 'Zu welchem Land oder Gebiet gehört diese Flagge?';
      if (!fs.existsSync(path.join(root, 'node_modules/flag-icons/flags/4x3', `${img.slice(5)}.svg`))) {
        problems.push(`${file}:${idx + 1} Flagge fehlt: ${img}`);
      }
    } else {
      const im = q.match(/^\[(flag:[a-z-]+|img:[^\]]+)\]\s*/);
      if (im) {
        img = im[1].startsWith('img:') ? im[1].slice(4) : im[1];
        q = q.slice(im[0].length);
      }
    }
    if (!a || (!q && !img)) {
      problems.push(`${file}:${idx + 1} Frage oder Antwort leer`);
      return;
    }
    const item = { id: `q${hash(`${pack.id}|${q}|${a}|${img}`)}`, c: cat.id, l: level, q, a };
    if (n) item.n = n;
    if (img) item.img = img;
    pack.qs.push(item);
  });
  if (!pack.id) pack.id = slug(pack.name || path.basename(file, '.txt'));
  return { pack, problems };
}

function check(pack) {
  const notes = [];
  const seen = new Map();
  for (const q of pack.qs) {
    const key = q.img ? q.img : q.q.toLowerCase();
    if (seen.has(key)) notes.push(`doppelt: "${q.q.slice(0, 50)}" (${q.a})`);
    seen.set(key, true);
  }
  const ids = new Set(pack.qs.map((q) => q.id));
  if (ids.size !== pack.qs.length) notes.push('doppelte IDs');
  for (const cat of pack.cats) {
    const per = [1, 2, 3, 4, 5].map((l) => pack.qs.filter((q) => q.c === cat.id && q.l === l).length);
    if (per.some((n) => n === 0)) notes.push(`Kategorie "${cat.name}" nicht spielbar, Stufen: ${per.join('/')}`);
    else if (per.some((n) => n !== per[0])) notes.push(`Kategorie "${cat.name}" ungleich verteilt: ${per.join('/')}`);
  }
  return notes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.txt')).sort() : [];
  const packs = [];
  let bad = 0;
  for (const file of files) {
    const { pack, problems } = parsePack(fs.readFileSync(path.join(srcDir, file), 'utf8'), file);
    const notes = [...problems, ...check(pack)];
    bad += notes.length;
    console.log(`${pack.icon || '·'} ${pack.name.padEnd(28)} ${String(pack.qs.length).padStart(4)} Fragen, ${pack.cats.length} Kategorien${notes.length ? `  ⚠ ${notes.length}` : ''}`);
    for (const n of notes) console.log(`     - ${n}`);
    packs.push(pack);
  }
  // file names carry a number prefix to fix the order in the library
  fs.writeFileSync(outFile, JSON.stringify(packs));
  console.log(`→ ${packs.length} Pakete, ${packs.reduce((s, p) => s + p.qs.length, 0)} Fragen geschrieben.`);
  if (strict && bad) process.exit(1);
}
