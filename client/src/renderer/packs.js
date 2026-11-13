// Pack library: built-in packs, local edits, custom packs, and board generation.
import builtin from './builtin-packs.json';
import { load, save } from './storage.js';

const LEVELS = [1, 2, 3, 4, 5];

/** Which question level fills which board row, per difficulty. Row 1 is worth 100, row 5 worth 500. */
export const DIFFICULTIES = [
  { id: 'mix', label: 'Gemischt' },
  { id: 'easy', label: 'Leicht' },
  { id: 'medium', label: 'Mittel' },
  { id: 'hard', label: 'Schwer' },
];
const ROWS = { mix: [1, 2, 3, 4, 5], easy: [1, 1, 2, 2, 3], medium: [2, 3, 3, 4, 4], hard: [3, 4, 4, 5, 5] };
const FINAL_MIN = { mix: 4, easy: 2, medium: 3, hard: 4 };
export const diffLabel = (id) => DIFFICULTIES.find((d) => d.id === id)?.label ?? 'Gemischt';
export const rowLevels = (diff) => ROWS[diff] ?? ROWS.mix;

/** How many questions of each level a column needs for a difficulty. */
function need(diff) {
  const n = [0, 0, 0, 0, 0];
  for (const lv of rowLevels(diff)) n[lv - 1]++;
  return n;
}
const meets = (per, diff) => need(diff).every((n, i) => per[i] >= n);
const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function local() {
  const data = load('packs', null) ?? {};
  return { custom: data.custom ?? {}, edited: data.edited ?? {} };
}

function persist(data) {
  save('packs', data);
}

// ---------- library ----------

export function allPacks() {
  const { custom, edited } = local();
  const list = builtin.map((p) => (edited[p.id] ? { ...edited[p.id], builtin: true, edited: true } : p));
  return [...list, ...Object.values(custom).sort((a, b) => (a.created ?? 0) - (b.created ?? 0))];
}

export function getPack(id) {
  return allPacks().find((p) => p.id === id) ?? null;
}

export function savePack(pack) {
  const data = local();
  const clean = { ...pack };
  delete clean.edited;
  if (builtin.some((p) => p.id === pack.id)) data.edited[pack.id] = clean;
  else data.custom[pack.id] = { ...clean, builtin: false };
  persist(data);
}

export function resetPack(id) {
  const data = local();
  delete data.edited[id];
  persist(data);
}

export function deletePack(id) {
  const data = local();
  delete data.custom[id];
  persist(data);
}

export function newPack(name = 'Neues Paket') {
  const pack = {
    id: uid('c_'),
    name,
    icon: '⭐',
    color: '#ffb224',
    desc: '',
    builtin: false,
    created: Date.now(),
    cats: [{ id: uid('k'), name: 'Kategorie 1' }],
    qs: [],
  };
  savePack(pack);
  return pack;
}

export function duplicatePack(id) {
  const src = getPack(id);
  if (!src) return null;
  const copy = structuredClone(src);
  copy.id = uid('c_');
  copy.name = `${src.name} (Kopie)`;
  copy.builtin = false;
  copy.created = Date.now();
  delete copy.edited;
  savePack(copy);
  return copy;
}

export function newQuestion(catId, level = 1) {
  return { id: uid('q'), c: catId, l: level, q: '', a: '' };
}

export function newCategory(name) {
  return { id: uid('k'), name };
}

export function packStats(pack, diff = 'mix') {
  const cats = pack.cats.map((cat) => {
    const per = LEVELS.map((l) => pack.qs.filter((q) => q.c === cat.id && q.l === l && !q.off).length);
    return { id: cat.id, name: cat.name, per, total: pack.qs.filter((q) => q.c === cat.id).length, active: per.reduce((a, b) => a + b, 0), playable: meets(per, diff) };
  });
  return {
    total: pack.qs.length,
    active: pack.qs.filter((q) => !q.off).length,
    cats,
    playable: cats.filter((c) => c.playable).length,
  };
}

// ---------- import / export ----------

function sanitizePack(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.qs) || !Array.isArray(raw.cats)) throw new Error('Die Datei ist kein Brinkgame-Paket.');
  if (raw.qs.length > 5000) throw new Error('Das Paket hat zu viele Fragen (maximal 5000).');
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const cats = raw.cats.slice(0, 200).map((c) => ({ id: str(c.id, 40) || uid('k'), name: str(c.name, 60) || 'Kategorie' }));
  const catIds = new Set(cats.map((c) => c.id));
  const qs = raw.qs
    .map((q) => ({
      id: uid('q'),
      c: catIds.has(q.c) ? q.c : cats[0]?.id,
      l: Math.min(5, Math.max(1, Math.round(Number(q.l)) || 1)),
      q: str(q.q, 600),
      a: str(q.a, 300),
      ...(q.n ? { n: str(q.n, 300) } : {}),
      ...(q.img ? { img: str(q.img, 1_400_000) } : {}),
      ...(q.off ? { off: true } : {}),
    }))
    .filter((q) => q.c && q.a && (q.q || q.img));
  return {
    id: uid('c_'),
    name: str(raw.name, 60) || 'Importiertes Paket',
    icon: str(raw.icon, 8) || '📦',
    color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#3aa0ff',
    desc: str(raw.desc, 200),
    builtin: false,
    created: Date.now(),
    cats,
    qs,
  };
}

/** Text format: "# Kategorie" headings and lines "Stufe | Frage | Antwort | Hinweis". */
export function parseTextQuestions(text, pack) {
  const cats = pack.cats.slice();
  const qs = [];
  let cat = cats[0] ?? null;
  let skipped = 0;
  for (const line of String(text).split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    if (raw.startsWith('#')) {
      const name = raw.replace(/^#+\s*/, '').slice(0, 60);
      cat = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!cat) {
        cat = newCategory(name);
        cats.push(cat);
      }
      continue;
    }
    const parts = raw.split('|').map((p) => p.trim());
    const level = Number(parts[0]);
    if (!cat || !(level >= 1 && level <= 5) || !parts[1] || !parts[2]) {
      skipped++;
      continue;
    }
    const item = { id: uid('q'), c: cat.id, l: level, q: parts[1].slice(0, 600), a: parts[2].slice(0, 300) };
    if (parts[3]) item.n = parts[3].slice(0, 300);
    qs.push(item);
  }
  return { cats, qs, skipped };
}

export function packToText(pack) {
  const lines = [];
  for (const cat of pack.cats) {
    lines.push(`# ${cat.name}`);
    for (const q of pack.qs.filter((x) => x.c === cat.id).sort((a, b) => a.l - b.l)) {
      lines.push([q.l, q.q.replace(/\|/g, '/'), q.a.replace(/\|/g, '/'), q.n ?? ''].filter((x, i) => i < 3 || x).join(' | '));
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function importPackFile(text) {
  let pack;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error('Die Datei ist beschädigt (kein gültiges JSON).');
    }
    pack = sanitizePack(raw.pack ?? raw);
  } else {
    pack = { id: uid('c_'), name: 'Importiertes Paket', icon: '📦', color: '#3aa0ff', desc: '', builtin: false, created: Date.now(), cats: [], qs: [] };
    const parsed = parseTextQuestions(trimmed, pack);
    if (!parsed.qs.length) throw new Error('In der Datei wurden keine Fragen gefunden.');
    pack.cats = parsed.cats;
    pack.qs = parsed.qs;
  }
  savePack(pack);
  return pack;
}

export function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportPack(pack) {
  const clean = structuredClone(pack);
  delete clean.edited;
  downloadFile(`${slug(pack.name) || 'paket'}.brinkpack.json`, JSON.stringify({ brinkgame: 1, pack: clean }, null, 1));
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Reads an image file and shrinks it so it fits into a pack and a network message. */
export async function imageToDataUrl(file, maxSide = 900) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function imageSrc(img) {
  if (!img) return '';
  if (img.startsWith('flag:')) return `flags/${img.slice(5)}.svg`;
  return img;
}

// ---------- played tracking ----------

export function playedSet(packId) {
  return new Set(load('played', {})[packId] ?? []);
}

export function markPlayed(board) {
  const played = { ...load('played', {}) };
  const add = (clue) => {
    if (!clue?.id || !clue.packId) return;
    const list = new Set(played[clue.packId] ?? []);
    list.add(clue.id);
    played[clue.packId] = [...list];
  };
  for (const round of board.rounds) for (const cat of round.cats) cat.clues.forEach(add);
  add(board.final);
  save('played', played);
}

export function resetPlayed(packId) {
  const played = { ...load('played', {}) };
  if (packId) delete played[packId];
  else for (const k of Object.keys(played)) delete played[k];
  save('played', played);
}

// ---------- board generation ----------

function selectedPacks(selection) {
  return allPacks().filter((p) => selection[p.id]?.on);
}

function activeQs(pack, sel) {
  return pack.qs.filter((q) => !q.off && (!sel?.cats || sel.cats.includes(q.c)));
}

/** All columns that could be built from the selection. */
function candidates(selection) {
  const out = [];
  for (const pack of selectedPacks(selection)) {
    const qs = activeQs(pack, selection[pack.id]);
    const diff = selection[pack.id]?.diff ?? 'mix';
    const rows = rowLevels(diff);
    let any = false;
    for (const cat of pack.cats) {
      const levels = LEVELS.map((l) => qs.filter((q) => q.c === cat.id && q.l === l));
      if (meets(levels.map((a) => a.length), diff)) {
        out.push({ pack, title: cat.name, catId: cat.id, levels, rows, diff });
        any = true;
      }
    }
    if (!any) {
      // no complete category: mix the whole pack into one column if every level exists
      const levels = LEVELS.map((l) => qs.filter((q) => q.l === l));
      if (meets(levels.map((a) => a.length), diff)) out.push({ pack, title: pack.name, catId: null, levels, rows, diff });
    }
  }
  return out;
}

function buildColumn(cand, usedIds) {
  const played = playedSet(cand.pack.id);
  // the same question can exist in two packs, so the text is tracked as well as the id
  const textKey = (q) => `t:${q.img ?? ''}|${q.q.toLowerCase()}`;
  const taken = (q) => usedIds.has(q.id) || usedIds.has(textKey(q));
  const clues = cand.rows.map((lv) => {
    const pool = cand.levels[lv - 1];
    const fresh = pool.filter((q) => !taken(q) && !played.has(q.id));
    const unused = pool.filter((q) => !taken(q));
    const q = pick(fresh.length ? fresh : unused.length ? unused : pool);
    usedIds.add(q.id);
    usedIds.add(textKey(q));
    return { id: q.id, packId: cand.pack.id, q: q.q, a: q.a, note: q.n ?? '', img: q.img ?? '' };
  });
  return { title: cand.title, pack: cand.pack.name, packId: cand.pack.id, catId: cand.catId, icon: cand.pack.icon, diff: cand.diff, clues };
}

function pickFinal(selection, usedIds) {
  const pool = [];
  for (const pack of selectedPacks(selection)) {
    const played = playedSet(pack.id);
    for (const q of activeQs(pack, selection[pack.id])) {
      if (q.l >= (FINAL_MIN[selection[pack.id]?.diff ?? 'mix'] ?? 4) && !usedIds.has(q.id)) pool.push({ pack, q, fresh: !played.has(q.id) });
    }
  }
  if (!pool.length) return null;
  const fresh = pool.filter((x) => x.fresh);
  const { pack, q } = pick(fresh.length ? fresh : pool);
  const cat = pack.cats.find((c) => c.id === q.c);
  usedIds.add(q.id);
  return { id: q.id, packId: pack.id, category: cat ? `${pack.name}: ${cat.name}` : pack.name, q: q.q, a: q.a, note: q.n ?? '', img: q.img ?? '' };
}

/**
 * Builds a full board. Columns are spread evenly over the selected packs; a category is only
 * repeated when the selection is too small for the requested size.
 */
export function generateBoard({ selection, rounds, cols, final }) {
  const cands = candidates(selection);
  if (!cands.length) return null;
  const need = rounds * cols;
  const byPack = new Map();
  for (const c of shuffle(cands)) {
    if (!byPack.has(c.pack.id)) byPack.set(c.pack.id, []);
    byPack.get(c.pack.id).push(c);
  }
  const queues = shuffle([...byPack.values()]);
  const chosen = [];
  let guard = 0;
  while (chosen.length < need && guard++ < 1000) {
    let took = false;
    for (const queue of queues) {
      if (chosen.length >= need) break;
      const next = queue.shift();
      if (next) {
        chosen.push(next);
        took = true;
      }
    }
    if (!took) {
      // everything used once: start over with the same candidates (different questions where possible)
      for (const c of shuffle(cands)) byPack.get(c.pack.id).push(c);
    }
  }
  const usedIds = new Set();
  // spread the columns over the rounds so that a repeated category never lands twice in one round
  const slots = Array.from({ length: rounds }, () => []);
  const keyOf = (c) => `${c.pack.id}|${c.catId}`;
  for (const c of chosen) {
    const open = slots.filter((s) => s.length < cols);
    const clean = open.filter((s) => !s.some((x) => keyOf(x) === keyOf(c)));
    const pool = clean.length ? clean : open;
    const min = Math.min(...pool.map((s) => s.length));
    pick(pool.filter((s) => s.length === min)).push(c);
  }
  const out = { rounds: [], final: null };
  for (const slot of slots) out.rounds.push({ cats: shuffle(slot).map((c) => buildColumn(c, usedIds)) });
  if (final) out.final = pickFinal(selection, usedIds);
  return out;
}

function usedIdsOf(board) {
  const ids = new Set();
  for (const round of board.rounds) for (const cat of round.cats) for (const clue of cat.clues) ids.add(clue.id);
  if (board.final) ids.add(board.final.id);
  return ids;
}

export function rerollColumn(board, ri, ci, selection) {
  const cands = candidates(selection);
  if (!cands.length) return board;
  const current = new Set(board.rounds.flatMap((r) => r.cats.map((c) => `${c.packId}|${c.catId}`)));
  const fresh = cands.filter((c) => !current.has(`${c.pack.id}|${c.catId}`));
  const next = structuredClone(board);
  next.rounds[ri].cats[ci] = buildColumn(pick(fresh.length ? fresh : cands), usedIdsOf(board));
  return next;
}

export function rerollClue(board, ri, ci, ki, selection) {
  const col = board.rounds[ri].cats[ci];
  const pack = getPack(col.packId);
  if (!pack) return board;
  const used = usedIdsOf(board);
  const level = rowLevels(selection[pack.id]?.diff)[ki];
  const pool = activeQs(pack, selection[pack.id]).filter((q) => q.l === level && (col.catId ? q.c === col.catId : true) && !used.has(q.id));
  if (!pool.length) return board;
  const q = pick(pool);
  const next = structuredClone(board);
  next.rounds[ri].cats[ci].clues[ki] = { id: q.id, packId: pack.id, q: q.q, a: q.a, note: q.n ?? '', img: q.img ?? '' };
  return next;
}

export function rerollFinal(board, selection) {
  const next = structuredClone(board);
  next.final = pickFinal(selection, usedIdsOf(board)) ?? board.final;
  return next;
}

/** How many columns the selection can fill without repeating a category. */
export function selectionCapacity(selection) {
  return candidates(selection).length;
}

/** Strips local-only fields before the board goes to the server. */
export function boardForServer(board) {
  return {
    rounds: board.rounds.map((r) => ({
      cats: r.cats.map((c) => ({ title: c.title, pack: c.pack, clues: c.clues.map((k) => ({ q: k.q, a: k.a, note: k.note, img: k.img })) })),
    })),
    final: board.final ? { category: board.final.category, q: board.final.q, a: board.final.a, note: board.final.note, img: board.final.img } : null,
  };
}
