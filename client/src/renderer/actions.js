// App logic that ties store, network, voice, packs and anti-cheat together.
import { S, emit, toast, go, errorText, openModal, closeModal, DEFAULT_SETTINGS, isMod } from './store.js';
import { initStorage, load, save } from './storage.js';
import * as net from './net.js';
import * as rtc from './rtc.js';
import { sfx } from './sfx.js';
import { allPacks, packStats, generateBoard, boardForServer, markPlayed } from './packs.js';

const merge = (base, extra) => {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
};

export const RULE_KEYS = ['mode', 'teamsLocked', 'maxPlayers', 'rounds', 'cols', 'dailyDoubles', 'final', 'negative', 'buzzMode', 'buzzTime', 'answerTime', 'finalTime', 'teamLockout', 'rebuzz', 'anticheat'];

/** The moderator's local lobby draft: which packs are selected and the generated board. */
export const draft = { selection: {}, board: null };

export async function init() {
  await initStorage();
  S.profile = load('profile', { name: '' });
  S.settings = merge(DEFAULT_SETTINGS, load('settings', {}));
  S.servers = load('servers', []);
  if (!S.desktop && location.protocol.startsWith('http') && !S.servers.length) {
    // opened in a browser from the game server itself
    S.servers = [{ id: 'origin', name: 'Dieser Server', url: location.origin, password: '' }];
  }
  const savedDraft = load('lobbyDraft', null);
  if (savedDraft?.selection) draft.selection = savedDraft.selection;
  applyTheme();
  S.ready = true;
  emit();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', () => rtc.setPtt(false));
  if (S.desktop) window.brink.ac.onData((data) => net.send('ac.report', data));
}

export function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
}

export function saveSettings() {
  save('settings', S.settings);
  applyTheme();
  emit();
}

export function setProfileName(name) {
  S.profile = { ...S.profile, name: name.slice(0, 20) };
  save('profile', S.profile);
  emit();
}

// ---------- servers ----------

export function saveServers(list) {
  S.servers = list;
  save('servers', list);
  emit();
}

export async function connectTo(server) {
  if (!S.profile.name.trim()) {
    toast('Gib dir zuerst einen Namen.', 'warn');
    go('home');
    return false;
  }
  const res = await net.connect(server);
  if (!res.ok) {
    toast(res.error === 'timeout' || !res.error ? 'Der Server ist nicht erreichbar.' : errorText(res.error), 'bad');
    return false;
  }
  if (!S.lobby) go('browser');
  refreshLobbies();
  return true;
}

export function leaveServer() {
  rtc.stopVoice();
  net.disconnect();
  go('servers');
}

export async function refreshLobbies() {
  const res = await net.req('lobby.list');
  if (res.ok) {
    S.lobbyList = res.lobbies;
    emit();
  }
}

// ---------- lobby ----------

function draftSettings() {
  const saved = load('lobbyDraft', null);
  return saved?.settings ?? {};
}

export async function createLobby({ name, isPublic, password }) {
  const res = await net.req('lobby.create', { name, public: isPublic, password, settings: { ...draftSettings(), packs: packsInfo() } });
  if (!res.ok) return toast(errorText(res.error), 'bad');
  draft.board = null;
  enterRoom();
  return res;
}

export async function joinLobby(code, password = '', role = 'player') {
  const res = await net.req('lobby.join', { code, password, role });
  if (!res.ok) {
    if (res.error === 'password') return res;
    toast(errorText(res.error), 'bad');
    return res;
  }
  enterRoom();
  return res;
}

function enterRoom() {
  S.chat = [];
  S.ac = { live: {}, log: [], unseen: 0 };
  S.screen = 'room';
  emit();
  rtc.startVoice();
}

export async function leaveLobby() {
  await net.req('lobby.leave');
  rtc.stopVoice();
  S.lobby = null;
  S.game = null;
  S.you = null;
  stopAnticheat();
  go('browser');
  refreshLobbies();
}

async function call(t, data, quiet) {
  const res = await net.req(t, data);
  if (!res.ok && !quiet) toast(errorText(res.error), 'bad');
  return res;
}

export const lobby = {
  settings: (patch) => {
    const res = call('lobby.settings', { settings: patch });
    persistDraft(patch);
    return res;
  },
  role: (id, role) => call('lobby.role', { id, role }),
  transferMod: (id) => call('lobby.transferMod', { id }),
  kick: (id) => call('lobby.kick', { id }),
  mute: (id, muted) => call('lobby.mute', { id, muted }),
  teamCreate: (name) => call('team.create', { name }),
  teamJoin: (teamId) => call('team.join', { teamId }),
  teamAssign: (id, teamId) => call('team.assign', { id, teamId }),
  teamUpdate: (teamId, patch) => call('team.update', { teamId, ...patch }),
  teamDelete: (teamId) => call('team.delete', { teamId }),
  teamShuffle: (count) => call('team.shuffle', { count }),
  consent: (ok) => call('ac.consent', { ok }),
  chat: (text) => net.send('chat', { text }),
};

export function game(action, data = {}, quiet = false) {
  return call('game.do', { action, ...data }, quiet);
}

export function backToLobby() {
  return call('game.lobby');
}

// ---------- draft: packs, board, presets ----------

export function packsInfo() {
  return allPacks()
    .filter((p) => draft.selection[p.id]?.on)
    .map((p) => ({ id: p.id, name: p.name, icon: p.icon, n: packStats(p).active }));
}

function persistDraft(settingsPatch) {
  const prev = load('lobbyDraft', null) ?? {};
  const settings = { ...(prev.settings ?? {}) };
  for (const key of RULE_KEYS) {
    if (settingsPatch && key in settingsPatch) settings[key] = settingsPatch[key];
  }
  save('lobbyDraft', { selection: draft.selection, settings });
}

export function setSelection(selection) {
  draft.selection = selection;
  draft.board = null;
  persistDraft();
  if (isMod()) net.req('lobby.settings', { settings: { packs: packsInfo() } });
  emit();
}

export function togglePack(id) {
  const cur = draft.selection[id];
  setSelection({ ...draft.selection, [id]: { on: !cur?.on, cats: cur?.cats ?? null } });
}

export function setPackCats(id, cats) {
  setSelection({ ...draft.selection, [id]: { on: true, cats } });
}

export function makeBoard() {
  const s = S.lobby.settings;
  const board = generateBoard({ selection: draft.selection, rounds: s.rounds, cols: s.cols, final: s.final });
  draft.board = board;
  emit();
  return board;
}

export function setBoard(board) {
  draft.board = board;
  emit();
}

export async function startGame() {
  const s = S.lobby.settings;
  let board = draft.board;
  const fits = board && board.rounds.length === s.rounds && board.rounds.every((r) => r.cats.length === s.cols) && !!board.final === (s.final && !!board.final);
  if (!fits) board = makeBoard();
  if (!board) {
    toast('Wähle mindestens ein Paket mit spielbaren Kategorien.', 'warn');
    return false;
  }
  const res = await net.req('game.start', { board: boardForServer(board) }, 20000);
  if (!res.ok) {
    if (res.error === 'ac_pending') toast(`Anti-Cheat: Es fehlt noch die Zustimmung von ${res.names.join(', ')}.`, 'warn', 6000);
    else toast(errorText(res.error), 'bad');
    return false;
  }
  markPlayed(board);
  draft.board = null;
  closeModal();
  return true;
}

export function presets() {
  return load('presets', []);
}

export function savePreset(name) {
  const settings = {};
  for (const key of RULE_KEYS) settings[key] = S.lobby.settings[key];
  const list = presets().filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  list.push({ id: Date.now().toString(36), name, settings, selection: structuredClone(draft.selection), saved: Date.now() });
  save('presets', list);
  toast(`Voreinstellung „${name}“ gespeichert.`, 'good');
  emit();
}

export async function loadPreset(id) {
  const preset = presets().find((p) => p.id === id);
  if (!preset) return;
  // drop packs that no longer exist
  const known = new Set(allPacks().map((p) => p.id));
  draft.selection = Object.fromEntries(Object.entries(preset.selection).filter(([pid]) => known.has(pid)));
  draft.board = null;
  await lobby.settings({ ...preset.settings, packs: packsInfo() });
  persistDraft(preset.settings);
  toast(`Voreinstellung „${preset.name}“ geladen.`, 'good');
  emit();
}

export function deletePreset(id) {
  save('presets', presets().filter((p) => p.id !== id));
  emit();
}

// ---------- anti-cheat ----------

let acRunning = false;

function wantAnticheat() {
  const me = S.lobby?.members.find((m) => m.id === S.conn.id);
  return S.desktop && !!S.lobby?.settings.anticheat && !!S.game && S.game.phase !== 'ended' && me?.role === 'player' && me.ac === 'ok';
}

function syncAnticheat() {
  const want = wantAnticheat();
  if (want && !acRunning) {
    acRunning = true;
    window.brink.ac.start();
  } else if (!want && acRunning) stopAnticheat();
}

function stopAnticheat() {
  if (!acRunning) return;
  acRunning = false;
  window.brink?.ac.stop();
}

export function anticheatRunning() {
  return acRunning;
}

net.on('ac.live', (msg) => {
  S.ac.live = { ...S.ac.live, [msg.id]: msg.live };
  emit();
});

net.on('ac.log', (msg) => {
  S.ac.log = [...S.ac.log, ...msg.entries].slice(-5000);
  const hot = msg.entries.filter((e) => e.hot && ['open', 'blur', 'switch'].includes(e.kind));
  if (hot.length) {
    S.ac.unseen += hot.length;
    sfx.alert();
    const e = hot[0];
    toast(`${e.name}: ${e.text}`, 'warn', 6000);
  }
  emit();
});

export async function loadAnticheat() {
  const res = await net.req('ac.get');
  if (res.ok) {
    S.ac.live = res.live;
    S.ac.log = res.log;
    emit();
  }
}

// ---------- reactions to state changes ----------

let consentAsked = false;

net.on('state.applied', ({ prevGame }) => {
  const g = S.game;
  const me = S.lobby?.members.find((m) => m.id === S.conn.id);
  // sounds
  const before = prevGame?.phase;
  if (g && before !== g.phase) {
    if (g.phase === 'clue') sfx.pick();
    else if (g.phase === 'dd_wager') sfx.dd();
    else if (g.phase === 'buzz_open' && before !== 'answering') sfx.open();
    else if (g.phase === 'answering') sfx.buzz();
    else if (g.phase === 'reveal') {
      if (g.cur?.winnerEnt) sfx.correct();
      else if (before === 'buzz_open') sfx.timeup();
      else sfx.wrong();
    } else if (g.phase === 'final_wager') sfx.dd();
    else if (g.phase === 'ended') sfx.win();
  }
  if (g && before === 'answering' && g.phase === 'buzz_open') sfx.wrong();
  if (g?.phase === 'final_reveal' && prevGame?.fin && g.fin.idx !== prevGame.fin.idx) {
    const last = g.fin.order[g.fin.idx - 1];
    if (last && g.fin.results[last]) (g.fin.results[last].correct ? sfx.correct : sfx.wrong)();
  }
  // anti-cheat consent
  if (S.lobby?.settings.anticheat && me?.role === 'player' && me.ac === 'pending' && !consentAsked) {
    consentAsked = true;
    openModal({ type: 'consent' });
  }
  if (!S.lobby?.settings.anticheat || me?.ac !== 'pending') consentAsked = false;
  if (S.modal?.type === 'consent' && (!S.lobby?.settings.anticheat || me?.ac !== 'pending' || me?.role !== 'player')) closeModal();
  syncAnticheat();
  if (isMod() && S.game && !prevGame) loadAnticheat();
  rtc.applyVolumes();
});

net.on('conn.online', ({ resumed }) => {
  if (resumed) {
    S.screen = 'room';
    rtc.startVoice();
    if (isMod()) loadAnticheat();
  }
});

net.on('lobby.left', () => stopAnticheat());

// ---------- keyboard ----------

function typing(ev) {
  const el = ev.target;
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function canBuzz() {
  const g = S.game;
  if (!g || S.you?.role !== 'player' || g.paused) return false;
  if (g.phase !== 'buzz_open' && g.phase !== 'clue') return false;
  const ent = S.you.entity;
  return !(g.cur.lockedEnt.includes(ent) || g.cur.lockedPl.includes(S.you.id));
}

let lastBuzz = 0;
export function buzz() {
  if (!canBuzz()) return;
  const now = performance.now();
  if (now - lastBuzz < 120) return;
  lastBuzz = now;
  game('buzz', {}, true).then((res) => {
    if (res.error === 'early') {
      S.buzzEarly = Date.now();
      emit();
    }
  });
}

function onKey(ev) {
  const down = ev.type === 'keydown';
  if (S.capturingKey) return;
  const a = S.settings.audio;
  if (a.mode === 'ptt' && ev.code === a.pttKey && rtc.voiceActive() && !typing(ev)) {
    rtc.setPtt(down);
    if (ev.code === 'Space') ev.preventDefault();
  }
  if (down && !ev.repeat && ev.code === S.settings.keys.buzz && S.screen === 'room' && S.game && !typing(ev) && !S.modal) {
    if (S.you?.role === 'player') {
      ev.preventDefault();
      buzz();
    }
  }
  if (down && ev.code === 'Escape' && S.modal && S.modal.type !== 'consent') closeModal();
}
