import { S, emit, toast, go } from './store.js';
import { load, save } from './storage.js';

export const PROTOCOL = 1;
const handlers = new Map();
const pending = new Map();
let ws = null;
let rid = 0;
let want = false;
let retry = 0;
let retryTimer = null;
let pingTimer = null;

/** Turns what the user typed into ws/http URLs. */
export function parseServer(input) {
  let raw = String(input ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  let secure = null;
  const scheme = raw.match(/^(wss?|https?):\/\//i);
  if (scheme) {
    secure = /^(wss|https)$/i.test(scheme[1]);
    raw = raw.slice(scheme[0].length);
  }
  raw = raw.replace(/\/ws$/i, '').split('/')[0];
  const m = raw.match(/^(\[[0-9a-f:]+\]|[^:]+)(?::(\d{1,5}))?$/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = m[2] ?? '';
  const local = host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith('[');
  if (secure === null) secure = !port && !local;
  const hostPort = port ? `${host}:${port}` : !secure && !port ? `${host}:8787` : host;
  return {
    key: `${secure ? 's' : 'p'}|${hostPort}`,
    label: hostPort,
    ws: `${secure ? 'wss' : 'ws'}://${hostPort}/ws`,
    http: `${secure ? 'https' : 'http'}://${hostPort}`,
  };
}

export async function probeServer(server) {
  const parsed = parseServer(server.url);
  if (!parsed) return { ok: false };
  const started = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${parsed.http}/api/info`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return { ok: false };
    return { ok: true, ms: Math.round(performance.now() - started), info: await res.json() };
  } catch {
    return { ok: false };
  }
}

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type)?.delete(fn);
}

function dispatch(msg) {
  const set = handlers.get(msg.t);
  if (set) for (const fn of set) fn(msg);
}

export function send(t, data = {}) {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t, ...data }));
}

export function req(t, data = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (ws?.readyState !== 1) {
      resolve({ ok: false, error: 'offline' });
      return;
    }
    const id = ++rid;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    pending.set(id, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
    ws.send(JSON.stringify({ t, rid: id, ...data }));
  });
}

function sessions() {
  return load('sessions', {});
}

function open() {
  const server = S.conn.server;
  const parsed = parseServer(server.url);
  if (!parsed) {
    S.conn.status = 'error';
    S.conn.error = 'Die Adresse ist ungültig.';
    emit();
    return;
  }
  clearTimeout(retryTimer);
  S.conn.status = retry ? 'reconnecting' : 'connecting';
  emit();
  let socket;
  try {
    socket = new WebSocket(parsed.ws);
  } catch {
    scheduleRetry();
    return;
  }
  ws = socket;
  socket.onopen = async () => {
    const res = await req('hello', {
      protocol: PROTOCOL,
      name: S.profile.name || 'Spieler',
      client: S.desktop ? 'desktop' : 'web',
      password: server.password ?? '',
      token: sessions()[parsed.key],
    });
    if (socket !== ws) return;
    if (!res.ok) {
      want = false;
      S.conn.status = 'error';
      S.conn.error = res.error;
      socket.close();
      emit();
      dispatch({ t: 'conn.failed', error: res.error });
      return;
    }
    retry = 0;
    save('sessions', { ...sessions(), [parsed.key]: res.token });
    S.conn.status = 'online';
    S.conn.error = '';
    S.conn.id = res.id;
    S.conn.info = res.server;
    S.conn.ice = res.ice ?? [];
    S.clockOffset = res.now - Date.now();
    if (!res.lobby && S.lobby) {
      // the server no longer knows our seat (restart or timeout)
      S.lobby = null;
      S.game = null;
      S.you = null;
      if (S.screen === 'room') S.screen = 'browser';
      toast('Die Lobby gibt es nicht mehr.', 'warn');
    }
    emit();
    dispatch({ t: 'conn.online', resumed: !!res.lobby });
    startPing();
  };
  socket.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.t === 'res') {
      const fn = pending.get(msg.rid);
      pending.delete(msg.rid);
      fn?.(msg);
      return;
    }
    dispatch(msg);
  };
  socket.onclose = () => {
    if (socket !== ws) return;
    ws = null;
    stopPing();
    for (const fn of pending.values()) fn({ ok: false, error: 'offline' });
    pending.clear();
    if (want) scheduleRetry();
    else if (S.conn.status !== 'error') {
      S.conn.status = 'off';
      emit();
    }
  };
  socket.onerror = () => {};
}

function scheduleRetry() {
  retry++;
  S.conn.status = 'reconnecting';
  emit();
  dispatch({ t: 'conn.lost' });
  const delay = Math.min(8000, 600 * 2 ** Math.min(retry, 4));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => want && open(), delay);
}

function startPing() {
  stopPing();
  const tick = async () => {
    const started = performance.now();
    const res = await req('ping', {}, 5000);
    if (res.ok) {
      S.conn.ping = Math.round(performance.now() - started);
      // keep the clock offset fresh, corrected by half the round trip
      S.clockOffset = res.now + S.conn.ping / 2 - Date.now();
      emit();
    }
  };
  tick();
  pingTimer = setInterval(tick, 4000);
}

function stopPing() {
  clearInterval(pingTimer);
  pingTimer = null;
}

export function connect(server) {
  disconnect(true);
  want = true;
  retry = 0;
  S.conn = { status: 'connecting', server, info: null, ping: 0, error: '', id: null, ice: [] };
  open();
  return new Promise((resolve) => {
    const offOk = on('conn.online', () => done(true));
    const offFail = on('conn.failed', (m) => done(false, m.error));
    const timer = setTimeout(() => done(false, 'timeout'), 9000);
    function done(ok, error) {
      offOk();
      offFail();
      clearTimeout(timer);
      if (!ok && S.conn.status !== 'online') {
        want = false;
        clearTimeout(retryTimer);
        ws?.close();
        S.conn.status = 'error';
        S.conn.error = error;
        emit();
      }
      resolve({ ok, error });
    }
  });
}

export function disconnect(silent = false) {
  want = false;
  clearTimeout(retryTimer);
  stopPing();
  const socket = ws;
  ws = null;
  socket?.close();
  S.lobby = null;
  S.game = null;
  S.you = null;
  S.conn.status = 'off';
  if (!silent) {
    dispatch({ t: 'conn.closed' });
    emit();
  }
}

export function isOnline() {
  return ws?.readyState === 1 && S.conn.status === 'online';
}

// ---------- shared message handling ----------

on('state', (msg) => {
  S.clockOffset = S.conn.ping ? S.clockOffset : msg.now - Date.now();
  const prevGame = S.game;
  S.lobby = msg.lobby;
  S.game = msg.game;
  S.you = msg.you;
  if (S.screen !== 'room' && S.screen !== 'settings' && S.screen !== 'packs') S.screen = 'room';
  emit();
  dispatch({ t: 'state.applied', prevGame });
});

on('lobby.closed', (msg) => {
  S.lobby = null;
  S.game = null;
  S.you = null;
  const text = { kicked: 'Du wurdest aus der Lobby entfernt.', timeout: 'Du warst zu lange getrennt.', closed: 'Die Lobby wurde geschlossen.' }[msg.reason];
  if (text) toast(text, 'warn');
  if (S.screen === 'room') go('browser');
  else emit();
  dispatch({ t: 'lobby.left' });
});

on('notice', (msg) => {
  if (msg.code === 'you_are_mod') toast('Du bist jetzt Moderator dieser Lobby.', 'info', 6000);
});

on('chat', (msg) => {
  S.chat = [...S.chat.slice(-80), msg];
  emit();
});
