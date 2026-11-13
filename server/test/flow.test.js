import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../src/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(port, name, client = 'desktop') {
    this.port = port;
    this.name = name;
    this.kind = client;
    this.rid = 0;
    this.pending = new Map();
    this.state = null;
    this.inbox = [];
  }

  async connect(token) {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
    await new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === 'res') {
        this.pending.get(msg.rid)?.(msg);
        this.pending.delete(msg.rid);
      } else if (msg.t === 'state') this.state = msg;
      else this.inbox.push(msg);
    });
    const hello = await this.req('hello', { name: this.name, client: this.kind, protocol: 1, token });
    assert.equal(hello.ok, true);
    this.id = hello.id;
    this.token = hello.token;
    return hello;
  }

  req(t, data = {}) {
    const rid = ++this.rid;
    return new Promise((resolve) => {
      this.pending.set(rid, resolve);
      this.ws.send(JSON.stringify({ t, rid, ...data }));
    });
  }

  do(action, data = {}) {
    return this.req('game.do', { action, ...data });
  }

  get game() {
    return this.state?.game;
  }

  close() {
    this.ws.close();
  }
}

function makeBoard(rounds = 1, cols = 3) {
  return {
    rounds: Array.from({ length: rounds }, (_, ri) => ({
      cats: Array.from({ length: cols }, (_, ci) => ({
        title: `Kat ${ci + 1}`,
        pack: 'Test',
        clues: Array.from({ length: 5 }, (_, ki) => ({ q: `Frage R${ri} C${ci} K${ki}`, a: `Antwort ${ci}-${ki}` })),
      })),
    })),
    final: { category: 'Finale', q: 'Letzte Frage', a: 'Letzte Antwort' },
  };
}

async function setup(t, settings = {}) {
  const app = createServer({ webDir: '/nonexistent' });
  const addr = await app.listen(0, '127.0.0.1');
  const mod = new Client(addr.port, 'Mod');
  const a = new Client(addr.port, 'Anna');
  const b = new Client(addr.port, 'Ben');
  const c = new Client(addr.port, 'Cem');
  for (const cl of [mod, a, b, c]) await cl.connect();
  t.after(async () => {
    for (const cl of [mod, a, b, c]) cl.close();
    await app.close();
  });
  const created = await mod.req('lobby.create', { name: 'Testlobby', public: true, settings });
  assert.equal(created.ok, true);
  for (const cl of [a, b, c]) assert.equal((await cl.req('lobby.join', { code: created.code })).ok, true);
  await sleep(30);
  return { app, mod, a, b, c, code: created.code };
}

test('lobby: roles, mixed teams and solo players', async (t) => {
  const { mod, a, b, c } = await setup(t);
  assert.equal(mod.state.you.role, 'mod');
  assert.equal(a.state.you.role, 'player');
  assert.equal(mod.state.lobby.entities.length, 3);

  const team = await a.req('team.create', { name: 'Die Füchse' });
  assert.equal(team.ok, true);
  assert.equal((await b.req('team.join', { teamId: team.teamId })).ok, true);
  await sleep(30);
  const ents = mod.state.lobby.entities;
  assert.equal(ents.length, 2, 'one team of two plus one solo player');
  assert.deepEqual(ents.map((e) => e.kind).sort(), ['solo', 'team']);
  assert.equal(ents.find((e) => e.kind === 'team').members.length, 2);
  assert.equal(c.state.you.entity, `p_${c.id}`);

  // "jeder für sich" dissolves all teams
  assert.equal((await mod.req('lobby.settings', { settings: { mode: 'solo' } })).ok, true);
  await sleep(30);
  assert.equal(mod.state.lobby.entities.length, 3);
  assert.equal((await a.req('team.create', { name: 'X' })).error, 'teams_closed');

  // players may not change settings
  assert.equal((await a.req('lobby.settings', { settings: { rounds: 1 } })).error, 'forbidden');

  const list = await c.req('lobby.list');
  assert.equal(list.lobbies.length, 1);
  assert.equal(list.lobbies[0].players, 3);
});

test('game: pick, buzz, judge, rebuzz and scores for team and solo', async (t) => {
  const { mod, a, b, c } = await setup(t, { answerMode: 'buzzer', rounds: 1, cols: 3, dailyDoubles: false, final: false, buzzTime: 0 });
  const team = await a.req('team.create', { name: 'Team A' });
  await b.req('team.join', { teamId: team.teamId });
  assert.equal((await a.req('game.start', { board: makeBoard() })).error, 'forbidden');
  assert.equal((await mod.req('game.start', { board: makeBoard() })).ok, true);
  await sleep(30);
  const teamEnt = `t_${team.teamId}`;
  const soloEnt = `p_${c.id}`;
  assert.equal(mod.game.phase, 'board');
  assert.deepEqual(Object.keys(mod.game.scores).sort(), [teamEnt, soloEnt].sort());

  // moderator may always pick; players only see the answer after the reveal
  assert.equal((await mod.do('pick', { c: 0, r: 1 })).ok, true);
  await sleep(30);
  assert.equal(a.game.phase, 'clue');
  assert.equal(a.game.cur.q, 'Frage R0 C0 K1');
  assert.equal(a.game.cur.a, undefined);
  assert.equal(mod.game.cur.a, 'Antwort 0-1');
  assert.equal(a.game.cur.value, 200);

  // too early
  assert.equal((await a.do('buzz')).error, 'early');
  await sleep(550);
  assert.equal((await mod.do('openBuzz')).ok, true);
  assert.equal((await a.do('buzz')).ok, true);
  await sleep(150);
  assert.equal(mod.game.phase, 'answering');
  assert.equal(mod.game.cur.buzzer, a.id);

  // wrong: team loses points and is locked as a whole, solo may still buzz
  assert.equal((await mod.do('judge', { correct: false })).ok, true);
  await sleep(30);
  assert.equal(mod.game.scores[teamEnt], -200);
  assert.equal(mod.game.phase, 'buzz_open');
  assert.equal((await b.do('buzz')).error, 'locked');
  assert.equal((await c.do('buzz')).ok, true);
  await sleep(150);
  assert.equal(mod.game.cur.buzzer, c.id);
  assert.equal((await mod.do('judge', { correct: true })).ok, true);
  await sleep(30);
  assert.equal(mod.game.phase, 'reveal');
  assert.equal(c.game.cur.a, 'Antwort 0-1');
  assert.equal(mod.game.scores[soloEnt], 200);
  assert.equal(mod.game.chooser, soloEnt);

  // undo the judgement, then judge again
  assert.equal((await mod.do('undo')).ok, true);
  await sleep(30);
  assert.equal(mod.game.phase, 'answering');
  assert.equal(mod.game.scores[soloEnt], 0);
  await mod.do('judge', { correct: true });
  await mod.do('next');
  await sleep(30);
  assert.equal(mod.game.phase, 'board');
  assert.equal(mod.game.board[0].clues[1].used, true);

  // only the chooser (or moderator) may pick
  assert.equal((await a.do('pick', { c: 1, r: 0 })).error, 'not_chooser');
  assert.equal((await c.do('pick', { c: 1, r: 0 })).ok, true);
  assert.equal((await c.do('pick', { c: 1, r: 1 })).error, 'phase');
  // nobody knows it
  await mod.do('openBuzz');
  await mod.do('reveal');
  await sleep(30);
  assert.equal(mod.game.phase, 'reveal');
  assert.equal(mod.game.cur.winnerEnt, null);
  await mod.do('next');

  // manual score correction
  await mod.do('adjust', { ent: teamEnt, delta: 500 });
  await sleep(30);
  assert.equal(mod.game.scores[teamEnt], 300);
});

test('game: simultaneous buzzes resolve to exactly one winner', async (t) => {
  const { mod, a, b, c } = await setup(t, { answerMode: 'buzzer', rounds: 1, cols: 3, dailyDoubles: false, final: false, buzzMode: 'instant' });
  await mod.req('game.start', { board: makeBoard() });
  await mod.do('pick', { c: 0, r: 0 });
  const results = await Promise.all([a.do('buzz'), b.do('buzz'), c.do('buzz')]);
  assert.ok(results.every((r) => r.ok));
  await sleep(150);
  assert.equal(mod.game.phase, 'answering');
  assert.ok([a.id, b.id, c.id].includes(mod.game.cur.buzzer));
  assert.equal(mod.game.cur.buzzOrder.length, 3);
  assert.equal(mod.game.cur.answerers.length, 1);
});

test('game: buzz timer runs out', async (t) => {
  const { mod } = await setup(t, { answerMode: 'buzzer', rounds: 1, cols: 3, dailyDoubles: false, final: false, buzzMode: 'instant', buzzTime: 1 });
  await mod.req('game.start', { board: makeBoard() });
  await mod.do('pick', { c: 0, r: 0 });
  await sleep(30);
  assert.equal(mod.game.phase, 'buzz_open');
  assert.ok(mod.game.deadline > Date.now());
  await sleep(1150);
  assert.equal(mod.game.phase, 'reveal');
});

test('game: daily double, round change and final', async (t) => {
  const { mod, a, b, c } = await setup(t, { answerMode: 'buzzer', rounds: 2, cols: 3, dailyDoubles: true, final: true, buzzMode: 'instant', finalTime: 0 });
  await mod.req('game.start', { board: makeBoard(2) });
  await sleep(30);
  // find the daily double through the moderator view
  let dd = null;
  mod.game.board.forEach((cat, ci) => cat.clues.forEach((k, ki) => {
    if (k.dd) dd = { c: ci, r: ki };
  }));
  assert.ok(dd, 'round 1 has a daily double');
  assert.equal(a.game.board[dd.c].clues[dd.r].dd, undefined, 'players cannot see where it is');
  const chooser = mod.game.chooser;
  const chooserClient = [a, b, c].find((x) => `p_${x.id}` === chooser);
  const other = [a, b, c].find((x) => x !== chooserClient);
  await chooserClient.do('pick', dd);
  await sleep(30);
  assert.equal(mod.game.phase, 'dd_wager');
  assert.equal(other.game.cur.q, '', 'clue hidden until the wager is set');
  assert.equal((await other.do('wager', { amount: 300 })).error, 'not_yours');
  assert.equal((await chooserClient.do('wager', { amount: 99999 })).ok, true);
  await sleep(30);
  assert.equal(mod.game.phase, 'dd_answer');
  assert.equal(mod.game.cur.wager, 500, 'clamped to the round maximum when the score is lower');
  assert.equal((await other.do('buzz')).error, 'phase');
  await mod.do('judge', { correct: true });
  await sleep(30);
  assert.equal(mod.game.scores[chooser], 500);
  await mod.do('next');

  // skip the rest of round 1 and 2
  await mod.do('endRound');
  await sleep(30);
  assert.equal(mod.game.phase, 'round_end');
  await mod.do('next');
  await sleep(30);
  assert.equal(mod.game.round, 1);
  assert.equal(mod.game.board[0].clues[0].value, 200);
  assert.notEqual(mod.game.chooser, chooser, 'trailing entity opens round 2');
  await mod.do('endRound');
  await mod.do('next');
  await sleep(30);
  assert.equal(mod.game.phase, 'final_wager');
  assert.equal(a.game.fin.q, '');

  await chooserClient.do('finalWager', { amount: 400 });
  await other.do('finalWager', { amount: 9999 });
  await sleep(30);
  assert.equal(other.game.fin.myWager, 500);
  assert.equal(mod.game.fin.wagered.length, 2);
  await mod.do('finalAdvance');
  await sleep(30);
  assert.equal(a.game.phase, 'final_clue');
  assert.equal(a.game.fin.q, 'Letzte Frage');
  assert.equal(a.game.fin.a, undefined);
  await chooserClient.do('finalAnswer', { text: 'Letzte Antwort' });
  await other.do('finalAnswer', { text: 'keine Ahnung' });
  await sleep(30);
  assert.equal(other.game.fin.answers, undefined, 'other answers stay private');
  await mod.do('finalAdvance');
  await sleep(30);
  assert.equal(mod.game.phase, 'final_reveal');
  assert.equal(mod.game.fin.order.length, 3);
  // judge in order: only the chooser was right
  for (let i = 0; i < 3; i++) {
    const ent = mod.game.fin.current.ent;
    await mod.do('finalJudge', { correct: ent === chooser });
    await sleep(30);
  }
  assert.equal(mod.game.phase, 'ended');
  assert.equal(mod.game.scores[chooser], 900);
  assert.equal(mod.game.scores[`p_${other.id}`], -500);
  assert.equal(a.game.fin.a, 'Letzte Antwort');

  assert.equal((await mod.req('game.lobby')).ok, true);
  await sleep(30);
  assert.equal(mod.state.game, null);
});

test('anti-cheat: consent, live window list and log only reach the moderator', async (t) => {
  const { mod, a, b, c } = await setup(t, { answerMode: 'buzzer', rounds: 1, cols: 3, dailyDoubles: false, final: false, anticheat: true, buzzMode: 'instant' });
  const blocked = await mod.req('game.start', { board: makeBoard() });
  assert.equal(blocked.error, 'ac_pending');
  assert.equal(blocked.names.length, 3);
  await a.req('ac.consent', { ok: true });
  await b.req('ac.consent', { ok: true });
  await c.req('ac.consent', { ok: false });
  await sleep(30);
  assert.equal(mod.state.lobby.members.find((m) => m.id === c.id).role, 'spectator', 'declining makes you a spectator');
  assert.equal((await mod.req('game.start', { board: makeBoard() })).ok, true);

  a.ws.send(JSON.stringify({ t: 'ac.report', windows: [{ title: 'Brinkgame', app: 'Brinkgame' }], focused: true, displays: 1 }));
  await sleep(30);
  await mod.do('pick', { c: 0, r: 0 });
  a.ws.send(JSON.stringify({
    t: 'ac.report',
    windows: [{ title: 'Brinkgame', app: 'Brinkgame' }, { title: 'Hauptstadt von Peru - Google Suche', app: 'chrome' }],
    fg: { title: 'Hauptstadt von Peru - Google Suche', app: 'chrome' },
    focused: false,
    displays: 1,
  }));
  await sleep(50);
  const live = mod.inbox.filter((m) => m.t === 'ac.live');
  const log = mod.inbox.filter((m) => m.t === 'ac.log').flatMap((m) => m.entries);
  assert.equal(live.at(-1).id, a.id);
  assert.equal(live.at(-1).live.windows.length, 2);
  assert.ok(log.some((e) => e.kind === 'open' && e.app === 'chrome' && e.hot), 'new window during a clue is flagged hot');
  assert.ok(log.some((e) => e.kind === 'blur'));
  assert.equal(b.inbox.filter((m) => m.t.startsWith('ac.')).length, 0, 'players never receive anti-cheat data');
  assert.equal((await b.req('ac.get')).error, 'forbidden');
  const snap = await mod.req('ac.get');
  assert.ok(snap.log.length >= 3);
});

test('connection: reconnect with token resumes the seat, signaling is relayed', async (t) => {
  const { mod, a, b } = await setup(t);
  b.ws.send(JSON.stringify({ t: 'rtc.signal', to: a.id, data: { sdp: 'x' } }));
  await sleep(30);
  assert.deepEqual(a.inbox.find((m) => m.t === 'rtc.signal'), { t: 'rtc.signal', from: b.id, data: { sdp: 'x' } });

  const oldId = a.id;
  a.close();
  await sleep(50);
  assert.equal(mod.state.lobby.members.find((m) => m.id === oldId).connected, false);
  const hello = await a.connect(a.token);
  assert.equal(hello.id, oldId);
  assert.equal(hello.lobby, mod.state.lobby.code);
  await sleep(50);
  assert.equal(mod.state.lobby.members.find((m) => m.id === oldId).connected, true);
  assert.equal(a.state.you.role, 'player');

  // moderator can hand over and kick
  assert.equal((await mod.req('lobby.transferMod', { id: a.id })).ok, true);
  await sleep(30);
  assert.equal(a.state.you.role, 'mod');
  assert.equal(mod.state.you.role, 'player');
  assert.equal((await a.req('lobby.kick', { id: b.id })).ok, true);
  await sleep(30);
  assert.ok(b.inbox.some((m) => m.t === 'lobby.closed' && m.reason === 'kicked'));
  assert.equal(a.state.lobby.members.length, 3);
});

test('server password and protocol check', async (t) => {
  const app = createServer({ webDir: '/nonexistent', password: 'geheim' });
  const addr = await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
  await new Promise((r) => ws.once('open', r));
  const ask = (data) => new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    ws.send(JSON.stringify(data));
  });
  assert.equal((await ask({ t: 'hello', rid: 1, name: 'X', protocol: 1 })).error, 'auth');
  assert.equal((await ask({ t: 'hello', rid: 2, name: 'X', protocol: 99, password: 'geheim' })).error, 'version');
  assert.equal((await ask({ t: 'hello', rid: 3, name: 'X', protocol: 1, password: 'geheim' })).ok, true);
  ws.close();
  const info = await (await fetch(`http://127.0.0.1:${addr.port}/api/info`)).json();
  assert.equal(info.needsPassword, true);
});

test('chooser answers: the picking team answers first, then the others may steal, then it rotates', async (t) => {
  const { mod, a, b, c } = await setup(t, { rounds: 1, cols: 3, dailyDoubles: false, final: false, buzzMode: 'instant', buzzTime: 0, answerMode: 'chooser' });
  const team = await a.req('team.create', { name: 'Team A' });
  await b.req('team.join', { teamId: team.teamId });
  await mod.req('game.start', { board: makeBoard() });
  await sleep(30);
  const teamEnt = `t_${team.teamId}`;
  const soloEnt = `p_${c.id}`;
  const order = mod.state.lobby.entities.map((e) => e.id);
  assert.deepEqual(order, [teamEnt, soloEnt], 'teams come first, then solo players');
  // make the team the chooser
  await mod.do('setChooser', { ent: teamEnt });
  await sleep(30);
  assert.equal((await c.do('pick', { c: 0, r: 0 })).error, 'not_chooser');
  assert.equal((await a.do('pick', { c: 0, r: 0 })).ok, true);
  await sleep(50);

  // no buzzer race: the team answers right away, everybody in the team is an answerer
  assert.equal(mod.game.phase, 'answering');
  assert.equal(mod.game.cur.teamAnswer, true);
  assert.equal(mod.game.cur.answerEnt, teamEnt);
  assert.deepEqual([...mod.game.cur.answerers].sort(), [a.id, b.id].sort());
  assert.equal(mod.game.cur.answerers[0], a.id, 'the captain comes first');
  assert.equal((await c.do('buzz')).error, 'phase', 'the others cannot buzz during the team answer');

  // wrong: the team loses points, is locked, the others may steal
  await mod.do('judge', { correct: false });
  await sleep(30);
  assert.equal(mod.game.scores[teamEnt], -100);
  assert.equal(mod.game.phase, 'buzz_open');
  assert.equal(mod.game.cur.teamAnswer, false);
  assert.equal((await a.do('buzz')).error, 'locked');
  assert.equal((await b.do('buzz')).error, 'locked');
  assert.equal((await c.do('buzz')).ok, true);
  await sleep(150);
  assert.equal(mod.game.phase, 'answering');
  assert.equal(mod.game.cur.buzzer, c.id);
  await mod.do('judge', { correct: true });
  await sleep(30);
  assert.equal(mod.game.scores[soloEnt], 100);
  assert.equal(mod.game.phase, 'reveal');
  assert.equal(a.game.cur.a, 'Antwort 0-0');

  // the turn goes on to the next in line, not to the one who stole
  await mod.do('next');
  await sleep(30);
  assert.equal(mod.game.phase, 'board');
  assert.equal(mod.game.chooser, soloEnt, 'after the team comes the solo player');
  assert.equal((await c.do('pick', { c: 1, r: 1 })).ok, true);
  await sleep(50);
  assert.equal(mod.game.cur.answerEnt, soloEnt);
  assert.deepEqual(mod.game.cur.answerers, [c.id]);
  await mod.do('judge', { correct: true });
  await mod.do('next');
  await sleep(30);
  assert.equal(mod.game.chooser, teamEnt, 'and then it is the team again');
  assert.equal(mod.game.scores[soloEnt], 300);
});

test('chooser answers: no stealing when rebuzz is off, and the manual release still works', async (t) => {
  const { mod, a, c } = await setup(t, { rounds: 1, cols: 3, dailyDoubles: false, final: false, buzzMode: 'manual', buzzTime: 0, rebuzz: false, answerMode: 'chooser' });
  await mod.req('game.start', { board: makeBoard() });
  await sleep(30);
  const chooser = mod.game.chooser;
  const pickerClient = [a, c].find((x) => `p_${x.id}` === chooser) ?? a;
  const picker = [a, c].find((x) => `p_${x.id}` === chooser) ? pickerClient : null;
  if (!picker) {
    // the random start chooser was somebody else: hand the turn to a player explicitly
    await mod.do('setChooser', { ent: `p_${a.id}` });
    await sleep(30);
  }
  const who = picker ?? a;
  const ent = `p_${who.id}`;
  assert.equal((await who.do('pick', { c: 0, r: 1 })).ok, true);
  await sleep(30);
  assert.equal(mod.game.phase, 'clue', 'in manual mode the moderator reads first');
  assert.equal(mod.game.cur.turnEnt, ent);
  const other = [a, c].find((x) => x !== who);
  assert.equal((await other.do('buzz')).error, 'not_your_turn');
  assert.equal((await mod.do('openBuzz')).ok, true);
  await sleep(30);
  assert.equal(mod.game.phase, 'answering');
  assert.equal(mod.game.cur.answerers[0], who.id);
  await mod.do('judge', { correct: false });
  await sleep(30);
  assert.equal(mod.game.phase, 'reveal', 'without rebuzz a wrong answer ends the clue');
  assert.equal(mod.game.scores[ent], -200);
  await mod.do('next');
  await sleep(30);
  assert.notEqual(mod.game.chooser, ent, 'the turn moved on');
});
