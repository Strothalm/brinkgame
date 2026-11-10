import crypto from 'node:crypto';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
}

export function randomId(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('base64url');
}

export function randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Trim, collapse whitespace, strip control characters and cut to max length. */
export function cleanText(value, max = 100, fallback = '') {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, max) || fallback;
}

/** Like cleanText but keeps line breaks (for clue texts). */
export function cleanMultiline(value, max = 600) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

export function clampInt(value, min, max, fallback = min) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * ICE server list for clients. With TURN_SECRET set, short-lived credentials are
 * generated the way coturn expects them (use-auth-secret / TURN REST API).
 */
export function iceServers(env = process.env, userId = 'brink') {
  const list = [];
  const stun = (env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) list.push({ urls: stun });
  const turn = (env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turn.length) {
    if (env.TURN_SECRET) {
      const ttl = 24 * 3600;
      const username = `${Math.floor(Date.now() / 1000) + ttl}:${userId}`;
      const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      list.push({ urls: turn, username, credential });
    } else if (env.TURN_USER && env.TURN_PASS) {
      list.push({ urls: turn, username: env.TURN_USER, credential: env.TURN_PASS });
    }
  }
  return list;
}

export const PALETTE = [
  '#ff5a4e', '#ffb224', '#3ecf8e', '#3aa0ff', '#b57bff', '#ff6fb5', '#18c8c8', '#f2e24b', '#ff8a3d', '#7bd148',
  '#5b7cfa', '#e24bd0', '#27b6f5', '#c9a36b', '#9aa7b8', '#f06a8b', '#42d6a4', '#d6c21f', '#8f8cff', '#ff9f80',
];
