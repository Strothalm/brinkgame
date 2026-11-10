import { useEffect, useReducer } from 'preact/hooks';

export const DEFAULT_SETTINGS = {
  theme: 'neon',
  sfx: true,
  sfxVolume: 60,
  audio: {
    input: 'default',
    output: 'default',
    inputGain: 100,
    master: 100,
    duck: 20, // Lautstärke der anderen in Prozent, während jemand antworten muss
    mode: 'open', // 'open' = dauerhaft offen, 'ptt' = Push-to-talk
    pttKey: 'KeyV',
    ns: true,
    ec: true,
    agc: true,
    userVol: {}, // Name -> Prozent
  },
  video: { device: '', mirror: true },
  keys: { buzz: 'Space' },
};

/** Global app state. Mutate, then call emit(). */
export const S = {
  ready: false,
  screen: 'home', // home | servers | browser | room | packs | settings
  modal: null,
  profile: { name: '' },
  settings: structuredClone(DEFAULT_SETTINGS),
  servers: [],
  conn: { status: 'off', server: null, info: null, ping: 0, error: '', id: null, ice: [] },
  lobbyList: [],
  lobby: null,
  game: null,
  you: null,
  clockOffset: 0,
  ac: { live: {}, log: [], unseen: 0 },
  chat: [],
  toasts: [],
  voice: { ready: false, muted: false, deaf: false, cam: false, micError: '', camError: '', peers: {}, devices: { in: [], out: [], cam: [] } },
  desktop: typeof window !== 'undefined' && !!window.brink,
};

const listeners = new Set();
let scheduled = false;
let version = 0;

export function emit() {
  version++;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}

/** Re-renders the calling component on every store change. Used once at the root. */
export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  const seen = version;
  useEffect(() => {
    listeners.add(force);
    // a change may have happened between the first render and this effect
    if (seen !== version) force();
    return () => listeners.delete(force);
  }, []);
  return S;
}

let toastId = 0;
export function toast(text, kind = 'info', ms = 3800) {
  const id = ++toastId;
  S.toasts = [...S.toasts.slice(-3), { id, text, kind }];
  emit();
  setTimeout(() => {
    S.toasts = S.toasts.filter((t) => t.id !== id);
    emit();
  }, ms);
}

export function go(screen) {
  S.screen = screen;
  S.modal = null;
  emit();
}

export function openModal(modal) {
  S.modal = modal;
  emit();
}

export function closeModal() {
  S.modal = null;
  emit();
}

/** Server time in ms, corrected by the offset measured from state messages. */
export function serverNow() {
  return Date.now() + S.clockOffset;
}

// ---------- derived helpers ----------

export function member(id) {
  return S.lobby?.members.find((m) => m.id === id) ?? null;
}

export function entity(id) {
  return S.lobby?.entities.find((e) => e.id === id) ?? null;
}

export function entityOfPlayer(pid) {
  return S.lobby?.entities.find((e) => e.members.includes(pid)) ?? null;
}

export function isMod() {
  return S.you?.role === 'mod';
}

export const ERRORS = {
  auth: 'Falsches Server-Passwort.',
  version: 'Diese App-Version passt nicht zum Server. Bitte aktualisieren.',
  not_found: 'Keine Lobby mit diesem Code gefunden.',
  password: 'Falsches Lobby-Passwort.',
  full: 'Die Lobby ist voll.',
  server_full: 'Auf dem Server sind zu viele Lobbys offen.',
  forbidden: 'Das darf nur der Moderator.',
  in_game: 'Das geht nicht, während eine Runde läuft.',
  no_players: 'Es ist noch kein Spieler in der Lobby.',
  ac_pending: 'Noch nicht alle Spieler haben dem Anti-Cheat zugestimmt.',
  board_empty: 'Das Board ist leer. Wähle mindestens ein Paket.',
  board_shape: 'Das Board ist unvollständig.',
  board_clue: 'Im Board fehlt bei einer Frage Text oder Antwort.',
  board_invalid: 'Das Board konnte nicht geladen werden.',
  teams_closed: 'Teams sind gerade gesperrt.',
  too_many_teams: 'Mehr Teams gehen nicht.',
  not_chooser: 'Gerade wählt jemand anderes.',
  captain_only: 'Den Einsatz bestimmt der Teamkapitän.',
  timeout: 'Der Server antwortet nicht.',
  offline: 'Keine Verbindung zum Server.',
  nothing: 'Es gibt nichts zum Rückgängigmachen.',
  paused: 'Das Spiel ist pausiert.',
  is_mod: 'Der Moderator kann die Rolle nicht wechseln. Übergib zuerst die Moderation.',
};

export function errorText(code) {
  return ERRORS[code] ?? `Das hat nicht geklappt (${code}).`;
}
