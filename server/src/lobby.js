import { Game, normalizeBoard } from './game.js';
import { cleanText, clampInt, randomId, shuffle, PALETTE } from './util.js';

export const DEFAULT_SETTINGS = {
  answerMode: 'chooser', // 'chooser' = wer das Feld wählt, antwortet; 'buzzer' = alle buzzern
  mode: 'mixed', // 'mixed' = Teams und Einzelspieler gemischt, 'solo' = jeder für sich
  teamsLocked: false, // nur der Moderator teilt Teams ein
  maxPlayers: 20,
  rounds: 2,
  cols: 6,
  dailyDoubles: true,
  final: true,
  negative: true,
  buzzMode: 'manual', // 'manual' | 'auto' | 'instant'
  buzzTime: 15,
  answerTime: 0,
  finalTime: 45,
  teamLockout: true,
  rebuzz: true,
  anticheat: false,
  duck: 20,
  packs: [],
};

const MAX_SPECTATORS = 10;
const MAX_TEAMS = 10;
const LOBBY_GRACE_MS = 45_000;
const MOD_GRACE_LOBBY_MS = 60_000;
const MOD_GRACE_GAME_MS = 5 * 60_000;
const AC_SILENT_MS = 12_000;
const AC_LOG_MAX = 5000;

const ok = (data) => ({ ok: true, ...data });
const err = (error, extra) => ({ ok: false, error, ...extra });

function sanitizeSettings(prev, patch) {
  const s = { ...prev };
  if (!patch || typeof patch !== 'object') return s;
  if (patch.mode === 'mixed' || patch.mode === 'solo') s.mode = patch.mode;
  if (patch.answerMode === 'chooser' || patch.answerMode === 'buzzer') s.answerMode = patch.answerMode;
  for (const key of ['teamsLocked', 'dailyDoubles', 'final', 'negative', 'teamLockout', 'rebuzz', 'anticheat']) {
    if (typeof patch[key] === 'boolean') s[key] = patch[key];
  }
  if ('maxPlayers' in patch) s.maxPlayers = clampInt(patch.maxPlayers, 1, 20, 20);
  if ('rounds' in patch) s.rounds = clampInt(patch.rounds, 1, 2, 2);
  if ('cols' in patch) s.cols = clampInt(patch.cols, 3, 6, 6);
  if (['manual', 'auto', 'instant'].includes(patch.buzzMode)) s.buzzMode = patch.buzzMode;
  if ('buzzTime' in patch) s.buzzTime = clampInt(patch.buzzTime, 0, 120, 15);
  if ('answerTime' in patch) s.answerTime = clampInt(patch.answerTime, 0, 120, 0);
  if ('finalTime' in patch) s.finalTime = clampInt(patch.finalTime, 0, 300, 45);
  if ('duck' in patch) s.duck = clampInt(patch.duck, 0, 100, 20);
  if (Array.isArray(patch.packs)) {
    s.packs = patch.packs.slice(0, 40).map((p) => ({
      id: cleanText(p?.id, 60),
      name: cleanText(p?.name, 60),
      icon: cleanText(p?.icon, 8),
      n: clampInt(p?.n, 0, 100000, 0),
      diff: ['mix', 'easy', 'medium', 'hard'].includes(p?.diff) ? p.diff : 'mix',
    }));
  }
  return s;
}

export class Lobby {
  constructor(hub, { code, name, isPublic, password }) {
    this.hub = hub;
    this.code = code;
    this.name = name;
    this.public = isPublic;
    this.password = password;
    this.createdAt = Date.now();
    this.members = new Map();
    this.teams = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.modId = null;
    this.game = null;
    this.ac = { log: [], live: new Map(), silent: new Set() };
    this.dirty = false;
    this.emptySince = 0;
    this.modGoneSince = 0;
    this.autoPaused = false;
  }

  // ---------- membership ----------

  get players() {
    return [...this.members.values()].filter((m) => m.role === 'player');
  }

  inGame() {
    return !!this.game && this.game.phase !== 'ended';
  }

  _uniqueName(name, selfId) {
    const taken = new Set([...this.members.values()].filter((m) => m.id !== selfId).map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 17)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  _freeColor() {
    const used = new Set([...this.members.values()].map((m) => m.color));
    return PALETTE.find((c) => !used.has(c)) ?? PALETTE[this.members.size % PALETTE.length];
  }

  join(session, { password, role } = {}) {
    const existing = this.members.get(session.id);
    if (existing) {
      existing.connected = true;
      existing.goneAt = 0;
      this._afterReconnect(existing);
      return ok();
    }
    if (this.password && password !== this.password) return err('password');
    let wanted = role === 'spectator' ? 'spectator' : 'player';
    if (this.inGame()) wanted = 'spectator';
    if (wanted === 'player' && this.players.length >= this.settings.maxPlayers) wanted = 'spectator';
    if (wanted === 'spectator' && [...this.members.values()].filter((m) => m.role === 'spectator').length >= MAX_SPECTATORS) {
      return err('full');
    }
    const member = {
      id: session.id,
      name: this._uniqueName(session.name),
      color: this._freeColor(),
      role: this.modId ? wanted : 'mod',
      teamId: null,
      connected: true,
      goneAt: 0,
      client: session.client,
      ac: session.client === 'desktop' ? 'pending' : 'unsupported',
      forceMuted: false,
      voice: { muted: false, deaf: false, cam: false, epoch: '' },
      joinedAt: Date.now(),
    };
    this.members.set(member.id, member);
    if (member.role === 'mod') this.modId = member.id;
    this.emptySince = 0;
    this.touch();
    return ok();
  }

  _afterReconnect(member) {
    if (member.id === this.modId) {
      this.modGoneSince = 0;
      if (this.autoPaused && this.game) {
        this.autoPaused = false;
        this.game.setPaused(false);
      }
    }
    if (this.inGame() && member.role === 'player') this._acLog(member, 'reconnect', 'Verbindung wiederhergestellt');
    this.emptySince = 0;
    this.touch();
  }

  onDisconnect(session) {
    const member = this.members.get(session.id);
    if (!member) return;
    member.connected = false;
    member.goneAt = Date.now();
    member.voice.cam = false;
    if (this.inGame() && member.role === 'player') this._acLog(member, 'disconnect', 'Verbindung getrennt');
    if (member.id === this.modId) {
      this.modGoneSince = Date.now();
      if (this.inGame() && !this.game.paused) {
        this.autoPaused = true;
        this.game.setPaused(true);
      }
    }
    this.touch();
  }

  leave(session, reason = 'left') {
    const member = this.members.get(session.id);
    if (!member) return;
    this._remove(member, reason);
  }

  _remove(member, reason) {
    this.members.delete(member.id);
    this.ac.live.delete(member.id);
    this._pruneTeams();
    const session = this.hub.sessions.get(member.id);
    if (session?.lobby === this) {
      session.lobby = null;
      if (reason !== 'left') this.hub.send(session, { t: 'lobby.closed', reason });
    }
    if (member.id === this.modId) {
      this.modId = null;
      this._promoteMod();
    }
    this.touch();
  }

  _promoteMod() {
    const candidates = [...this.members.values()].filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = candidates[0];
    if (!next) return;
    if (this.game) {
      // the answers were only on the old moderator's screen; a running round cannot continue fairly
      this.game.dispose();
      this.game = null;
    }
    next.role = 'mod';
    next.teamId = null;
    this.modId = next.id;
    this.modGoneSince = 0;
    this.autoPaused = false;
    this._pruneTeams();
    this.hub.send(this.hub.sessions.get(next.id), { t: 'notice', code: 'you_are_mod' });
  }

  /** Called by the hub every few seconds. Returns false when the lobby should be closed. */
  tick(now) {
    for (const member of [...this.members.values()]) {
      if (member.connected || !member.goneAt) continue;
      const isMod = member.id === this.modId;
      if (isMod) {
        const grace = this.inGame() ? MOD_GRACE_GAME_MS : MOD_GRACE_LOBBY_MS;
        if (now - member.goneAt > grace) this._remove(member, 'timeout');
      } else if (!this.inGame() && now - member.goneAt > LOBBY_GRACE_MS) {
        this._remove(member, 'timeout');
      }
    }
    if (this.inGame() && this.settings.anticheat) {
      for (const member of this.players) {
        if (member.ac !== 'ok' || !member.connected) continue;
        const live = this.ac.live.get(member.id);
        const last = live?.at ?? this.game.startedAt;
        if (now - last > AC_SILENT_MS) {
          if (!this.ac.silent.has(member.id)) {
            this.ac.silent.add(member.id);
            this._acLog(member, 'silent', 'Client sendet keine Fensterdaten mehr');
          }
        }
      }
    }
    const anyone = [...this.members.values()].some((m) => m.connected);
    if (anyone) this.emptySince = 0;
    else if (!this.emptySince) this.emptySince = now;
    return !(this.emptySince && now - this.emptySince > 120_000) && this.members.size > 0;
  }

  // ---------- roles ----------

  setRole(actor, targetId, role) {
    const target = this.members.get(targetId);
    if (!target) return err('member');
    if (!['player', 'spectator'].includes(role)) return err('role');
    const self = actor.id === targetId;
    const isMod = actor.id === this.modId;
    if (!isMod && !self) return err('forbidden');
    if (target.id === this.modId) return err('is_mod');
    if (!isMod && this.inGame()) return err('in_game');
    if (role === 'player' && target.role !== 'player' && this.players.length >= this.settings.maxPlayers) return err('full');
    target.role = role;
    if (role === 'spectator') target.teamId = null;
    this._pruneTeams();
    if (role === 'player' && this.game) this.game.ensureEntity(this._entityId(target));
    this.touch();
    return ok();
  }

  transferMod(actor, targetId) {
    if (actor.id !== this.modId) return err('forbidden');
    if (this.inGame()) return err('in_game');
    const target = this.members.get(targetId);
    if (!target || !target.connected || target.id === actor.id) return err('member');
    const old = this.members.get(actor.id);
    old.role = 'player';
    target.role = 'mod';
    target.teamId = null;
    this.modId = target.id;
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    this._pruneTeams();
    this.touch();
    return ok();
  }

  kick(actor, targetId) {
    if (actor.id !== this.modId) return err('forbidden');
    const target = this.members.get(targetId);
    if (!target || target.id === actor.id) return err('member');
    this._remove(target, 'kicked');
    return ok();
  }

  forceMute(actor, targetId, muted) {
    if (actor.id !== this.modId) return err('forbidden');
    const target = this.members.get(targetId);
    if (!target) return err('member');
    target.forceMuted = !!muted;
    this.touch();
    return ok();
  }

  updateSettings(actor, patch) {
    if (actor.id !== this.modId) return err('forbidden');
    if (this.inGame()) return err('in_game');
    this.settings = sanitizeSettings(this.settings, patch);
    if (this.settings.mode === 'solo') {
      for (const m of this.members.values()) m.teamId = null;
      this.teams.clear();
    }
    if (typeof patch?.name === 'string') this.name = cleanText(patch.name, 40, this.name);
    if (typeof patch?.public === 'boolean') this.public = patch.public;
    this.touch();
    return ok();
  }

  // ---------- teams ----------

  _teamsOpenFor(actor) {
    if (this.settings.mode !== 'mixed') return false;
    if (actor.id === this.modId) return true;
    return !this.settings.teamsLocked && !this.inGame();
  }

  _pruneTeams() {
    for (const team of [...this.teams.values()]) {
      const members = this.players.filter((m) => m.teamId === team.id);
      const scored = this.game && `t_${team.id}` in this.game.scores;
      if (!members.length && !team.keep && !scored) this.teams.delete(team.id);
      else if (members.length && !members.some((m) => m.id === team.captainId)) team.captainId = members[0].id;
    }
    for (const m of this.members.values()) if (m.teamId && !this.teams.has(m.teamId)) m.teamId = null;
  }

  _newTeam(name, keep) {
    const usedColors = new Set([...this.teams.values()].map((t) => t.color));
    const teamPalette = ['#ff5a4e', '#3aa0ff', '#3ecf8e', '#ffb224', '#b57bff', '#ff6fb5', '#18c8c8', '#f2e24b', '#ff8a3d', '#7bd148'];
    const team = {
      id: randomId(),
      name: cleanText(name, 24, `Team ${this.teams.size + 1}`),
      color: teamPalette.find((c) => !usedColors.has(c)) ?? teamPalette[this.teams.size % teamPalette.length],
      captainId: null,
      keep: !!keep,
    };
    this.teams.set(team.id, team);
    return team;
  }

  teamCreate(actor, name) {
    if (!this._teamsOpenFor(actor)) return err('teams_closed');
    if (this.teams.size >= MAX_TEAMS) return err('too_many_teams');
    const member = this.members.get(actor.id);
    const isMod = actor.id === this.modId;
    const team = this._newTeam(name, isMod);
    if (!isMod && member.role === 'player') {
      member.teamId = team.id;
      team.captainId = member.id;
    }
    this._pruneTeams();
    this.touch();
    return ok({ teamId: team.id });
  }

  teamJoin(actor, teamId) {
    if (!this._teamsOpenFor(actor)) return err('teams_closed');
    const member = this.members.get(actor.id);
    if (member.role !== 'player') return err('role');
    if (teamId && !this.teams.has(teamId)) return err('team');
    member.teamId = teamId || null;
    const team = this.teams.get(teamId);
    if (team && !team.captainId) team.captainId = member.id;
    this._pruneTeams();
    this.touch();
    return ok();
  }

  teamAssign(actor, playerId, teamId) {
    if (actor.id !== this.modId) return err('forbidden');
    if (this.settings.mode !== 'mixed') return err('teams_closed');
    const member = this.members.get(playerId);
    if (!member || member.role !== 'player') return err('member');
    if (teamId && !this.teams.has(teamId)) return err('team');
    member.teamId = teamId || null;
    const team = this.teams.get(teamId);
    if (team && !team.captainId) team.captainId = member.id;
    this._pruneTeams();
    if (this.game) this.game.ensureEntity(this._entityId(member));
    this.touch();
    return ok();
  }

  teamUpdate(actor, teamId, patch) {
    const team = this.teams.get(teamId);
    if (!team) return err('team');
    const isMod = actor.id === this.modId;
    if (!isMod && team.captainId !== actor.id) return err('forbidden');
    if (typeof patch?.name === 'string') team.name = cleanText(patch.name, 24, team.name);
    if (typeof patch?.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) team.color = patch.color;
    if (isMod && patch?.captainId && this.members.get(patch.captainId)?.teamId === teamId) team.captainId = patch.captainId;
    this.touch();
    return ok();
  }

  teamDelete(actor, teamId) {
    if (actor.id !== this.modId) return err('forbidden');
    if (this.inGame()) return err('in_game');
    this.teams.delete(teamId);
    this._pruneTeams();
    this.touch();
    return ok();
  }

  /** Randomly spread all players over `count` teams (0 = dissolve all teams). */
  teamShuffle(actor, count) {
    if (actor.id !== this.modId) return err('forbidden');
    if (this.inGame()) return err('in_game');
    if (this.settings.mode !== 'mixed') return err('teams_closed');
    const n = clampInt(count, 0, MAX_TEAMS, 2);
    for (const m of this.members.values()) m.teamId = null;
    this.teams.clear();
    if (n > 0) {
      const teams = Array.from({ length: n }, (_, i) => this._newTeam(`Team ${i + 1}`, true));
      shuffle(this.players).forEach((m, i) => {
        const team = teams[i % n];
        m.teamId = team.id;
        team.captainId ??= m.id;
      });
    }
    this.touch();
    return ok();
  }

  // ---------- entities ----------

  _entityId(member) {
    return member.teamId ? `t_${member.teamId}` : `p_${member.id}`;
  }

  entityOf(playerId) {
    const member = this.members.get(playerId);
    if (!member || member.role !== 'player') return null;
    return this._entityId(member);
  }

  entities() {
    const list = [];
    const players = this.players.sort((a, b) => a.joinedAt - b.joinedAt);
    for (const team of this.teams.values()) {
      const members = players.filter((m) => m.teamId === team.id).map((m) => m.id);
      const scored = this.game && `t_${team.id}` in this.game.scores;
      if (!members.length && !scored) continue;
      list.push({
        id: `t_${team.id}`,
        kind: 'team',
        name: team.name,
        color: team.color,
        members,
        captainId: members.includes(team.captainId) ? team.captainId : members[0] ?? null,
      });
    }
    for (const m of players) {
      if (m.teamId) continue;
      list.push({ id: `p_${m.id}`, kind: 'solo', name: m.name, color: m.color, members: [m.id], captainId: m.id });
    }
    return list;
  }

  // ---------- game ----------

  startGame(actor, boardInput) {
    if (actor.id !== this.modId) return err('forbidden');
    if (this.inGame()) return err('in_game');
    if (!this.players.length) return err('no_players');
    if (this.settings.anticheat) {
      const open = this.players.filter((m) => m.ac === 'pending' || m.ac === 'declined');
      if (open.length) return err('ac_pending', { names: open.map((m) => m.name) });
    }
    let board;
    try {
      board = normalizeBoard(boardInput, this.settings);
    } catch (e) {
      return err(e.message.startsWith('board_') ? e.message : 'board_invalid');
    }
    this.game?.dispose();
    this._pruneTeams();
    this.ac = { log: [], live: new Map(), silent: new Set() };
    this.autoPaused = false;
    this.game = new Game(board, { ...this.settings }, {
      entities: () => this.entities(),
      entityOf: (pid) => this.entityOf(pid),
      isConnected: (pid) => !!this.members.get(pid)?.connected,
      rtt: (pid) => this.hub.sessions.get(pid)?.rtt ?? 0,
      changed: () => this.touch(),
    });
    this.touch();
    return ok();
  }

  backToLobby(actor) {
    if (actor.id !== this.modId) return err('forbidden');
    this.game?.dispose();
    this.game = null;
    this.autoPaused = false;
    for (const m of [...this.members.values()]) if (!m.connected && m.id !== this.modId) this._remove(m, 'timeout');
    this._pruneTeams();
    this.touch();
    return ok();
  }

  gameAction(actor, action, args = {}) {
    const game = this.game;
    if (!game) return err('no_game');
    const member = this.members.get(actor.id);
    const a = { id: member.id, role: member.role };
    switch (action) {
      case 'pick': return game.pick(a, clampInt(args.c, 0, 7, 0), clampInt(args.r, 0, 5, 0));
      case 'openBuzz': return game.openBuzz(a);
      case 'buzz': return game.buzz(a);
      case 'judge': return game.judge(a, !!args.correct);
      case 'wager': return game.wager(a, args.amount, args.ent);
      case 'reveal': return game.reveal(a);
      case 'unpick': return game.unpick(a);
      case 'next': return game.next(a);
      case 'endRound': return game.endRound(a);
      case 'finalWager': return game.finalWager(a, args.amount, args.ent);
      case 'finalAnswer': return game.finalAnswer(a, args.text);
      case 'finalAdvance': return game.finalAdvance(a);
      case 'finalJudge': return game.finalJudge(a, !!args.correct);
      case 'adjust': return game.adjust(a, String(args.ent ?? ''), args.delta);
      case 'setChooser': return game.setChooser(a, String(args.ent ?? ''));
      case 'undo': return game.undo(a);
      case 'pause': this.autoPaused = false; return game.pause(a, !!args.on);
      case 'end': return game.end(a);
      default: return err('unknown_action');
    }
  }

  // ---------- anti-cheat ----------

  acConsent(actor, accepted) {
    const member = this.members.get(actor.id);
    if (!member) return err('member');
    if (member.client !== 'desktop') return err('unsupported');
    member.ac = accepted ? 'ok' : 'declined';
    if (!accepted && member.role === 'player' && this.settings.anticheat && !this.inGame()) {
      member.role = 'spectator';
      member.teamId = null;
      this._pruneTeams();
    }
    this.touch();
    return ok();
  }

  _acLog(member, kind, text, app = '') {
    const game = this.game;
    const entry = {
      t: Date.now(),
      id: member.id,
      name: member.name,
      kind,
      text,
      app,
      hot: !!game?.isHot(),
      ctx: game?.describe() ?? '',
    };
    this.ac.log.push(entry);
    if (this.ac.log.length > AC_LOG_MAX) this.ac.log.splice(0, this.ac.log.length - AC_LOG_MAX);
    const mod = this.hub.sessions.get(this.modId);
    if (mod) this.hub.send(mod, { t: 'ac.log', entries: [entry] });
  }

  acReport(actor, data) {
    const member = this.members.get(actor.id);
    if (!member || member.role !== 'player' || member.ac !== 'ok') return;
    if (!this.settings.anticheat || !this.inGame()) return;
    const clean = (w) => ({ title: cleanText(w?.title, 160), app: cleanText(w?.app, 60) });
    const windows = (Array.isArray(data?.windows) ? data.windows.slice(0, 80) : []).map(clean).filter((w) => w.title || w.app);
    const live = {
      windows,
      fg: data?.fg ? clean(data.fg) : null,
      focused: data?.focused !== false,
      displays: clampInt(data?.displays, 1, 16, 1),
      source: cleanText(data?.source, 20),
      at: Date.now(),
    };
    const prev = this.ac.live.get(member.id);
    this.ac.live.set(member.id, live);
    if (this.ac.silent.delete(member.id)) this._acLog(member, 'resume', 'Fensterdaten kommen wieder an');
    const key = (w) => `${w.app}|${w.title}`;
    if (!prev) {
      this._acLog(member, 'start', `${windows.length} Fenster offen bei Rundenbeginn, ${live.displays} Bildschirm(e)`);
      for (const w of windows) this._acLog(member, 'initial', w.title, w.app);
    } else {
      const before = new Set(prev.windows.map(key));
      for (const w of windows) if (!before.has(key(w))) this._acLog(member, 'open', w.title, w.app);
      if (prev.focused && !live.focused) {
        this._acLog(member, 'blur', live.fg?.title ? `Spielfenster verlassen → ${live.fg.title}` : 'Spielfenster verlassen', live.fg?.app ?? '');
      } else if (!prev.focused && live.focused) {
        this._acLog(member, 'focus', 'Zurück im Spielfenster');
      } else if (!live.focused && live.fg && key(live.fg) !== key(prev.fg ?? {})) {
        this._acLog(member, 'switch', `Wechsel zu ${live.fg.title}`, live.fg.app);
      }
      if (prev.displays !== live.displays) this._acLog(member, 'displays', `Anzahl Bildschirme: ${prev.displays} → ${live.displays}`);
    }
    const mod = this.hub.sessions.get(this.modId);
    if (mod) this.hub.send(mod, { t: 'ac.live', id: member.id, live });
  }

  acSnapshot(actor) {
    if (actor.id !== this.modId) return err('forbidden');
    return ok({ live: Object.fromEntries(this.ac.live), log: this.ac.log });
  }

  // ---------- state ----------

  listInfo() {
    return {
      code: this.code,
      name: this.name,
      players: this.players.length,
      max: this.settings.maxPlayers,
      hasPassword: !!this.password,
      inGame: this.inGame(),
      mod: this.members.get(this.modId)?.name ?? '',
      packs: this.settings.packs.map((p) => p.name).slice(0, 8),
    };
  }

  touch() {
    if (this.dirty) return;
    this.dirty = true;
    setImmediate(() => {
      this.dirty = false;
      this.broadcast();
    });
  }

  broadcast() {
    const now = Date.now();
    const lobby = {
      code: this.code,
      name: this.name,
      public: this.public,
      hasPassword: !!this.password,
      modId: this.modId,
      settings: this.settings,
      members: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        role: m.role,
        teamId: m.teamId,
        connected: m.connected,
        client: m.client,
        ac: m.ac,
        forceMuted: m.forceMuted,
        voice: m.voice,
        ping: this.hub.sessions.get(m.id)?.rtt ?? 0,
      })),
      teams: [...this.teams.values()].map((t) => ({ id: t.id, name: t.name, color: t.color, captainId: t.captainId })),
      entities: this.entities(),
    };
    for (const member of this.members.values()) {
      if (!member.connected) continue;
      const session = this.hub.sessions.get(member.id);
      if (!session) continue;
      this.hub.send(session, {
        t: 'state',
        now,
        you: { id: member.id, role: member.role, teamId: member.teamId, entity: this.entityOf(member.id) },
        lobby,
        game: this.game ? this.game.view(member.role, member.id) : null,
      });
    }
  }

  sendOthers(fromId, msg) {
    for (const member of this.members.values()) {
      if (member.id === fromId || !member.connected) continue;
      const session = this.hub.sessions.get(member.id);
      if (session) this.hub.send(session, msg);
    }
  }

  dispose() {
    this.game?.dispose();
    for (const member of this.members.values()) {
      const session = this.hub.sessions.get(member.id);
      if (session?.lobby === this) {
        session.lobby = null;
        this.hub.send(session, { t: 'lobby.closed', reason: 'closed' });
      }
    }
    this.members.clear();
  }
}
