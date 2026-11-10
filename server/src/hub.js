import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.js';
import { cleanText, randomCode, randomId, randomToken, safeEqual, iceServers } from './util.js';

export const PROTOCOL = 1;
const SMALL_MSG_LIMIT = 64 * 1024;
const BIG_MSG_LIMIT = 24 * 1024 * 1024; // board upload with embedded images
const SESSION_TTL_MS = 10 * 60_000;
const RATE_PER_SEC = 80;

export class Hub {
  constructor(config) {
    this.config = config;
    this.sessions = new Map(); // id -> session
    this.byToken = new Map();
    this.lobbies = new Map();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: BIG_MSG_LIMIT });
    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
    this.interval = setInterval(() => this._tick(), 3000);
    this.interval.unref?.();
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }

  send(session, msg) {
    const ws = session?.ws;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  info() {
    return {
      name: this.config.name,
      protocol: PROTOCOL,
      needsPassword: !!this.config.password,
      lobbies: this.lobbies.size,
      online: [...this.sessions.values()].filter((s) => s.ws).length,
    };
  }

  // ---------- connection ----------

  _onConnection(ws, req) {
    const conn = { ws, session: null, tokens: RATE_PER_SEC, last: Date.now(), ip: req.socket.remoteAddress };
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      conn.tokens = Math.min(RATE_PER_SEC, conn.tokens + ((now - conn.last) / 1000) * RATE_PER_SEC);
      conn.last = now;
      if (conn.tokens < 1) return;
      conn.tokens -= 1;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      if (raw.length > SMALL_MSG_LIMIT && msg.t !== 'game.start') return;
      try {
        this._onMessage(conn, msg);
      } catch (e) {
        console.error('[hub] handler error', msg.t, e);
        this._reply(conn, msg, { ok: false, error: 'server_error' });
      }
    });
    ws.on('close', () => this._onClose(conn));
    ws.on('error', () => {});
    ws.on('pong', () => {
      if (conn.session && conn.pingAt) {
        conn.session.rtt = Date.now() - conn.pingAt;
        conn.pingAt = 0;
      }
    });
  }

  _reply(conn, msg, result) {
    if (msg.rid == null) return;
    if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify({ t: 'res', rid: msg.rid, ...result }));
  }

  _onClose(conn) {
    const session = conn.session;
    if (!session || session.ws !== conn.ws) return;
    session.ws = null;
    session.goneAt = Date.now();
    session.lobby?.onDisconnect(session);
  }

  _tick() {
    const now = Date.now();
    for (const [code, lobby] of this.lobbies) {
      if (!lobby.tick(now)) {
        lobby.dispose();
        this.lobbies.delete(code);
      }
    }
    for (const session of [...this.sessions.values()]) {
      if (session.ws) {
        // protocol level ping measures the round trip for buzzer fairness
        const conn = session.conn;
        if (conn && conn.ws.readyState === 1) {
          if (conn.pingAt && now - conn.pingAt > 20_000) {
            conn.ws.terminate();
            continue;
          }
          if (!conn.pingAt) {
            conn.pingAt = now;
            conn.ws.ping();
          }
        }
      } else if (!session.lobby && now - session.goneAt > 60_000) {
        this._dropSession(session);
      } else if (now - session.goneAt > SESSION_TTL_MS) {
        session.lobby?.leave(session);
        this._dropSession(session);
      }
    }
  }

  _dropSession(session) {
    this.sessions.delete(session.id);
    this.byToken.delete(session.token);
  }

  // ---------- messages ----------

  _onMessage(conn, msg) {
    if (msg.t === 'hello') return this._hello(conn, msg);
    const session = conn.session;
    if (!session) return this._reply(conn, msg, { ok: false, error: 'no_hello' });
    const lobby = session.lobby;
    const reply = (result) => this._reply(conn, msg, result);
    const needLobby = () => {
      if (!lobby) reply({ ok: false, error: 'no_lobby' });
      return !!lobby;
    };

    switch (msg.t) {
      case 'ping':
        return reply({ ok: true, now: Date.now() });

      case 'profile': {
        session.name = cleanText(msg.name, 20, session.name);
        return reply({ ok: true });
      }

      case 'lobby.list':
        return reply({
          ok: true,
          lobbies: [...this.lobbies.values()].filter((l) => l.public).map((l) => l.listInfo()).slice(0, 100),
        });

      case 'lobby.create': {
        if (lobby) lobby.leave(session);
        if (this.lobbies.size >= this.config.maxLobbies) return reply({ ok: false, error: 'server_full' });
        let code;
        do code = randomCode();
        while (this.lobbies.has(code));
        const created = new Lobby(this, {
          code,
          name: cleanText(msg.name, 40, `Lobby von ${session.name}`),
          isPublic: !!msg.public,
          password: cleanText(msg.password, 40),
        });
        this.lobbies.set(code, created);
        created.join(session, { password: created.password });
        session.lobby = created;
        if (msg.settings) created.updateSettings(session, msg.settings);
        return reply({ ok: true, code });
      }

      case 'lobby.join': {
        const code = cleanText(msg.code, 8).toUpperCase();
        const target = this.lobbies.get(code);
        if (!target) return reply({ ok: false, error: 'not_found' });
        if (lobby && lobby !== target) lobby.leave(session);
        const result = target.join(session, { password: cleanText(msg.password, 40), role: msg.role });
        if (result.ok) session.lobby = target;
        return reply(result.ok ? { ok: true, code } : result);
      }

      case 'lobby.leave':
        if (lobby) {
          lobby.leave(session);
          session.lobby = null;
        }
        return reply({ ok: true });

      case 'lobby.settings':
        return needLobby() && reply(lobby.updateSettings(session, msg.settings));
      case 'lobby.role':
        return needLobby() && reply(lobby.setRole(session, msg.id ?? session.id, msg.role));
      case 'lobby.transferMod':
        return needLobby() && reply(lobby.transferMod(session, msg.id));
      case 'lobby.kick':
        return needLobby() && reply(lobby.kick(session, msg.id));
      case 'lobby.mute':
        return needLobby() && reply(lobby.forceMute(session, msg.id, msg.muted));

      case 'team.create':
        return needLobby() && reply(lobby.teamCreate(session, msg.name));
      case 'team.join':
        return needLobby() && reply(lobby.teamJoin(session, msg.teamId));
      case 'team.assign':
        return needLobby() && reply(lobby.teamAssign(session, msg.id, msg.teamId));
      case 'team.update':
        return needLobby() && reply(lobby.teamUpdate(session, msg.teamId, msg));
      case 'team.delete':
        return needLobby() && reply(lobby.teamDelete(session, msg.teamId));
      case 'team.shuffle':
        return needLobby() && reply(lobby.teamShuffle(session, msg.count));

      case 'game.start':
        return needLobby() && reply(lobby.startGame(session, msg.board));
      case 'game.lobby':
        return needLobby() && reply(lobby.backToLobby(session));
      case 'game.do':
        return needLobby() && reply(lobby.gameAction(session, msg.action, msg));

      case 'ac.consent':
        return needLobby() && reply(lobby.acConsent(session, !!msg.ok));
      case 'ac.report':
        if (lobby) lobby.acReport(session, msg);
        return undefined;
      case 'ac.get':
        return needLobby() && reply(lobby.acSnapshot(session));

      case 'rtc.signal': {
        if (!lobby) return undefined;
        const target = lobby.members.get(msg.to);
        if (!target?.connected) return undefined;
        this.send(this.sessions.get(target.id), { t: 'rtc.signal', from: session.id, data: msg.data });
        return undefined;
      }

      case 'voice.state': {
        if (!lobby) return undefined;
        const member = lobby.members.get(session.id);
        if (!member) return undefined;
        member.voice = {
          muted: !!msg.muted,
          deaf: !!msg.deaf,
          cam: !!msg.cam,
          epoch: cleanText(msg.epoch, 24),
        };
        lobby.sendOthers(session.id, { t: 'voice.state', id: session.id, voice: member.voice });
        return undefined;
      }

      case 'voice.speaking':
        if (lobby) lobby.sendOthers(session.id, { t: 'voice.speaking', id: session.id, on: !!msg.on });
        return undefined;

      case 'chat': {
        if (!lobby) return undefined;
        const member = lobby.members.get(session.id);
        const text = cleanText(msg.text, 300);
        if (!member || !text) return undefined;
        const out = { t: 'chat', id: member.id, name: member.name, color: member.color, text, at: Date.now() };
        for (const m of lobby.members.values()) if (m.connected) this.send(this.sessions.get(m.id), out);
        return undefined;
      }

      default:
        return reply({ ok: false, error: 'unknown' });
    }
  }

  _hello(conn, msg) {
    if (this.config.password && !safeEqual(msg.password ?? '', this.config.password)) {
      this._reply(conn, msg, { ok: false, error: 'auth' });
      return;
    }
    if (msg.protocol !== PROTOCOL) {
      this._reply(conn, msg, { ok: false, error: 'version', protocol: PROTOCOL });
      return;
    }
    let session = typeof msg.token === 'string' ? this.byToken.get(msg.token) : null;
    if (session) {
      // resume: take over from the old socket
      if (session.ws && session.ws !== conn.ws) {
        const old = session.ws;
        session.ws = null;
        try {
          old.close(4000, 'replaced');
        } catch { /* ignore */ }
      }
    } else {
      session = {
        id: randomId('u'),
        token: randomToken(),
        name: 'Spieler',
        client: 'web',
        lobby: null,
        ws: null,
        rtt: 0,
        goneAt: 0,
      };
      this.sessions.set(session.id, session);
      this.byToken.set(session.token, session);
    }
    session.name = cleanText(msg.name, 20, session.name);
    session.client = msg.client === 'desktop' ? 'desktop' : 'web';
    session.ws = conn.ws;
    session.conn = conn;
    session.goneAt = 0;
    conn.session = session;
    this._reply(conn, msg, {
      ok: true,
      id: session.id,
      token: session.token,
      server: this.info(),
      ice: iceServers(process.env, session.id),
      now: Date.now(),
      lobby: session.lobby?.code ?? null,
    });
    if (session.lobby) session.lobby.join(session);
  }

  close() {
    clearInterval(this.interval);
    for (const lobby of this.lobbies.values()) lobby.dispose();
    this.wss.close();
  }
}
