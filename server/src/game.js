import { cleanText, cleanMultiline, clampInt, shuffle } from './util.js';

/** Phases in which a clue is on screen and looking things up would be cheating. */
export const HOT_PHASES = new Set(['clue', 'buzz_open', 'answering', 'dd_wager', 'dd_answer', 'final_clue']);

const BUZZ_WINDOW_MS = 90; // collect near-simultaneous buzzes, then pick the fairest
const MAX_RTT_COMP_MS = 150;
const EARLY_LOCK_MS = 500;
const FINAL_MIN_MAX_WAGER = 500;

const ok = (data) => ({ ok: true, ...data });
const err = (error) => ({ ok: false, error });

function cleanImage(value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^flag:[a-z-]{2,8}$/.test(value)) return value;
  if (/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 1_500_000) return value;
  if (/^https:\/\/[^\s"'<>]{4,500}$/.test(value)) return value;
  return '';
}

function cleanClue(raw, value) {
  return {
    value,
    q: cleanMultiline(raw?.q, 600),
    a: cleanText(raw?.a, 300),
    note: cleanText(raw?.note, 300),
    img: cleanImage(raw?.img),
    dd: false,
    used: false,
    result: null, // entity id that scored, 'none', or null while unused
  };
}

/**
 * Validates the board a moderator uploads and brings it into the server's own shape.
 * Throws an Error with a short code when the input is unusable.
 */
export function normalizeBoard(input, settings) {
  const roundsIn = Array.isArray(input?.rounds) ? input.rounds.slice(0, 3) : [];
  if (!roundsIn.length) throw new Error('board_empty');
  const rounds = roundsIn.map((r, ri) => {
    const mult = ri + 1;
    const catsIn = Array.isArray(r?.cats) ? r.cats.slice(0, 8) : [];
    if (!catsIn.length) throw new Error('board_empty');
    const rows = clampInt(catsIn[0]?.clues?.length, 1, 6, 5);
    const cats = catsIn.map((c) => {
      const cluesIn = Array.isArray(c?.clues) ? c.clues : [];
      if (cluesIn.length !== rows) throw new Error('board_shape');
      const clues = cluesIn.map((k, i) => cleanClue(k, (i + 1) * 100 * mult));
      if (clues.some((k) => (!k.q && !k.img) || !k.a)) throw new Error('board_clue');
      return { title: cleanText(c?.title, 60, 'Kategorie'), pack: cleanText(c?.pack, 60), clues };
    });
    return { cats, rows, mult };
  });

  if (settings.dailyDoubles) {
    rounds.forEach((round, ri) => {
      const want = Math.min(ri === 0 ? 1 : 2, round.cats.length);
      const cols = shuffle(round.cats.map((_, i) => i)).slice(0, want);
      for (const c of cols) {
        // never in the cheapest row; weighted towards the bottom like on TV
        const rowPool = [];
        for (let r = 1; r < round.rows; r++) for (let w = 0; w < r; w++) rowPool.push(r);
        const r = rowPool.length ? shuffle(rowPool)[0] : 0;
        round.cats[c].clues[r].dd = true;
      }
    });
  }

  let final = null;
  if (settings.final && input?.final) {
    const f = cleanClue(input.final, 0);
    if ((f.q || f.img) && f.a) final = { category: cleanText(input.final.category, 60, 'Finale'), q: f.q, a: f.a, note: f.note, img: f.img };
  }
  return { rounds, final };
}

/**
 * Authoritative game state. The lobby passes a ctx with:
 *   entities()      -> [{ id, members: [playerId], captainId }]
 *   entityOf(pid)   -> entity id or null
 *   isConnected(pid)-> boolean
 *   rtt(pid)        -> last measured round trip in ms
 *   changed(reason) -> called after every state change
 */
export class Game {
  constructor(board, settings, ctx) {
    this.s = settings;
    this.ctx = ctx;
    this.rounds = board.rounds;
    this.final = board.final;
    this.round = 0;
    this.phase = 'board';
    this.scores = {};
    this.stats = {};
    this.cur = null;
    this.fin = null;
    this.paused = false;
    this.pausedRemaining = 0;
    this.deadline = 0;
    this.timer = null;
    this.timerKind = null;
    this.buzzWin = null;
    this.undoStack = [];
    this.startedAt = Date.now();
    const ents = ctx.entities();
    for (const e of ents) this.scores[e.id] = 0;
    this.chooser = ents.length ? shuffle(ents)[0].id : null;
  }

  // ---------- helpers ----------

  _changed(reason) {
    this.ctx.changed?.(reason);
  }

  _score(ent) {
    return this.scores[ent] ?? 0;
  }

  _add(ent, delta) {
    this.scores[ent] = this._score(ent) + delta;
  }

  _stat(pid) {
    return (this.stats[pid] ??= { buzzes: 0, correct: 0, wrong: 0, points: 0 });
  }

  _clue() {
    if (!this.cur) return null;
    return this.rounds[this.round].cats[this.cur.c].clues[this.cur.r];
  }

  _clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerKind = null;
    this.deadline = 0;
    if (this.buzzWin) {
      clearTimeout(this.buzzWin.timer);
      this.buzzWin = null;
    }
  }

  _arm(kind, ms) {
    if (this.timer) clearTimeout(this.timer);
    this.timerKind = kind;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this._timeout(kind), ms);
    this.timer.unref?.();
  }

  _timeout(kind) {
    this.timer = null;
    this.timerKind = null;
    this.deadline = 0;
    if (kind === 'buzz' && this.phase === 'buzz_open') {
      if (this.buzzWin) return; // a buzz came in at the last moment and is being resolved
      this._toReveal();
      this._changed('timeout');
    } else if (kind === 'auto_open' && this.phase === 'clue') {
      this._openBuzz();
      this._changed('buzz_open');
    } else if (kind === 'final' && this.phase === 'final_clue') {
      this._finalToReveal();
      this._changed('final_timeout');
    }
  }

  _snap() {
    this.undoStack.push({
      phase: this.phase,
      round: this.round,
      scores: { ...this.scores },
      stats: structuredClone(this.stats),
      chooser: this.chooser,
      cur: structuredClone(this.cur),
      fin: structuredClone(this.fin),
      used: this.rounds.map((r) => r.cats.map((c) => c.clues.map((k) => [k.used, k.result]))),
    });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

  _anyEligible() {
    const cur = this.cur;
    return this.ctx.entities().some((e) =>
      !cur.lockedEnt.includes(e.id) && e.members.some((pid) => !cur.lockedPl.includes(pid) && this.ctx.isConnected(pid)));
  }

  _roundDone() {
    return this.rounds[this.round].cats.every((c) => c.clues.every((k) => k.used));
  }

  _openBuzz() {
    // "Wer wählt, antwortet": the team that picked the clue answers first, without a buzzer race
    if (this.cur.turnEnt && !this.cur.turnDone) {
      this._startTeamAnswer();
      return;
    }
    this.phase = 'buzz_open';
    this.cur.buzzer = null;
    this.cur.teamAnswer = false;
    this.cur.answerers = [];
    this.cur.answerDeadline = 0;
    if (this.s.buzzTime > 0) this._arm('buzz', this.s.buzzTime * 1000);
    else this._clearTimer();
  }

  _startTeamAnswer() {
    const cur = this.cur;
    cur.turnDone = true;
    const ent = this.ctx.entities().find((e) => e.id === cur.turnEnt);
    if (!ent || !ent.members.length) {
      // nobody left in that team: fall back to the buzzer round
      this._openBuzz();
      return;
    }
    this._clearTimer();
    const lead = ent.captainId ?? ent.members[0];
    cur.buzzer = lead;
    cur.buzzerEnt = ent.id;
    cur.teamAnswer = true;
    cur.answerers = [lead, ...ent.members.filter((m) => m !== lead)];
    cur.buzzOrder = [];
    cur.answerDeadline = this.s.answerTime > 0 ? Date.now() + this.s.answerTime * 1000 : 0;
    this.phase = 'answering';
  }

  /** Next entity in line after `from`, used in "Wer wählt, antwortet" so everybody gets a turn. */
  _rotate(from) {
    const ents = this.ctx.entities();
    if (!ents.length) return;
    const idx = ents.findIndex((e) => e.id === from);
    this.chooser = ents[(idx + 1) % ents.length].id;
  }

  _toReveal(winnerEnt = null, winnerPid = null) {
    this._clearTimer();
    const clue = this._clue();
    clue.used = true;
    clue.result = winnerEnt ?? 'none';
    this.cur.winner = winnerPid;
    this.cur.winnerEnt = winnerEnt;
    this.cur.buzzer = null;
    this.cur.answerers = [];
    this.cur.answerDeadline = 0;
    this.phase = 'reveal';
  }

  _isMod(actor) {
    return actor.role === 'mod';
  }

  _canActFor(actor, ent) {
    if (this._isMod(actor)) return true;
    return actor.role === 'player' && this.ctx.entityOf(actor.id) === ent;
  }

  // ---------- board flow ----------

  pick(actor, c, r) {
    if (this.paused) return err('paused');
    if (this.phase !== 'board') return err('phase');
    if (!this._canActFor(actor, this.chooser)) return err('not_chooser');
    const round = this.rounds[this.round];
    const clue = round.cats[c]?.clues[r];
    if (!clue || clue.used) return err('clue');
    this._snap();
    this.cur = {
      c, r,
      value: clue.value,
      dd: clue.dd,
      pickedBy: actor.id,
      pickedEnt: this.chooser,
      turnEnt: null,
      turnDone: false,
      teamAnswer: false,
      buzzer: null,
      answerers: [],
      answerDeadline: 0,
      lockedEnt: [],
      lockedPl: [],
      early: {},
      attempts: [],
      buzzOrder: [],
      wager: 0,
      ddEnt: null,
      winner: null,
      winnerEnt: null,
    };
    if (clue.dd) {
      // the chooser plays it alone; if the moderator picked without a chooser there is nobody to wager
      if (!this.chooser) {
        clue.dd = false;
        this.cur.dd = false;
      } else {
        this.cur.ddEnt = this.chooser;
        this.phase = 'dd_wager';
        this._changed('dd');
        return ok();
      }
    }
    this.phase = 'clue';
    if (this.s.answerMode === 'chooser' && this.chooser && this.ctx.entities().some((e) => e.id === this.chooser)) {
      this.cur.turnEnt = this.chooser;
    }
    if (this.s.buzzMode === 'instant') this._openBuzz();
    else if (this.s.buzzMode === 'auto') {
      // rough reading time: 2s plus 55ms per character, capped
      const ms = Math.min(12000, 2000 + (clue.q?.length ?? 0) * 55);
      this._arm('auto_open', ms);
    }
    this._changed('pick');
    return ok();
  }

  openBuzz(actor) {
    if (!this._isMod(actor)) return err('role');
    if (this.paused) return err('paused');
    if (this.phase !== 'clue') return err('phase');
    this._clearTimer();
    this._openBuzz();
    this._changed('buzz_open');
    return ok();
  }

  buzz(actor) {
    if (this.paused) return err('paused');
    if (actor.role !== 'player') return err('role');
    const cur = this.cur;
    const now = Date.now();
    if (this.phase === 'clue' && cur) {
      if (cur.turnEnt) return err('not_your_turn');
      // buzzing before the buzzers are open costs a short lockout, like on TV
      cur.early[actor.id] = now + EARLY_LOCK_MS;
      return err('early');
    }
    if (this.phase !== 'buzz_open') return err('phase');
    const ent = this.ctx.entityOf(actor.id);
    if (!ent) return err('no_entity');
    if (cur.lockedEnt.includes(ent) || cur.lockedPl.includes(actor.id)) return err('locked');
    if ((cur.early[actor.id] ?? 0) > now) return err('early');
    const t = now - Math.min(MAX_RTT_COMP_MS, Math.max(0, this.ctx.rtt(actor.id) ?? 0) / 2);
    if (!this.buzzWin) {
      this.buzzWin = { cands: [], timer: setTimeout(() => this._resolveBuzz(), BUZZ_WINDOW_MS) };
    }
    if (!this.buzzWin.cands.some((x) => x.id === actor.id)) this.buzzWin.cands.push({ id: actor.id, ent, t });
    return ok();
  }

  _resolveBuzz() {
    const win = this.buzzWin;
    this.buzzWin = null;
    if (!win || this.phase !== 'buzz_open' || this.paused) return;
    win.cands.sort((a, b) => a.t - b.t);
    const first = win.cands[0];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerKind = null;
    this.deadline = 0;
    const cur = this.cur;
    cur.buzzer = first.id;
    cur.buzzerEnt = first.ent;
    cur.answerers = [first.id];
    cur.buzzOrder = win.cands.map((x) => ({ id: x.id, d: Math.round(x.t - first.t) }));
    cur.answerDeadline = this.s.answerTime > 0 ? Date.now() + this.s.answerTime * 1000 : 0;
    this._stat(first.id).buzzes++;
    this.phase = 'answering';
    this._changed('buzz');
  }

  judge(actor, correct) {
    if (!this._isMod(actor)) return err('role');
    const cur = this.cur;
    if (this.phase === 'answering') {
      this._snap();
      const pid = cur.buzzer;
      const ent = cur.buzzerEnt;
      const st = this._stat(pid);
      if (correct) {
        this._add(ent, cur.value);
        st.correct++;
        st.points += cur.value;
        cur.attempts.push({ id: pid, ent, correct: true });
        if (this.s.answerMode !== 'chooser') this.chooser = ent;
        this._toReveal(ent, pid);
      } else {
        if (this.s.negative) {
          this._add(ent, -cur.value);
          st.points -= cur.value;
        }
        st.wrong++;
        cur.attempts.push({ id: pid, ent, correct: false });
        if (this.s.teamLockout || cur.teamAnswer) cur.lockedEnt.push(ent);
        else cur.lockedPl.push(pid);
        if (this.s.rebuzz && this._anyEligible()) this._openBuzz();
        else this._toReveal();
      }
      this._changed(correct ? 'correct' : 'wrong');
      return ok();
    }
    if (this.phase === 'dd_answer') {
      this._snap();
      const ent = cur.ddEnt;
      const pid = cur.answerers[0] ?? null;
      const delta = correct ? cur.wager : -cur.wager;
      this._add(ent, delta);
      if (pid) {
        const st = this._stat(pid);
        if (correct) st.correct++;
        else st.wrong++;
        st.points += delta;
      }
      cur.attempts.push({ id: pid, ent, correct });
      this._toReveal(correct ? ent : null, correct ? pid : null);
      this._changed(correct ? 'correct' : 'wrong');
      return ok();
    }
    return err('phase');
  }

  wager(actor, amount, forEnt) {
    if (this.phase !== 'dd_wager') return err('phase');
    const cur = this.cur;
    const ent = cur.ddEnt;
    if (!this._canActFor(actor, ent)) return err('not_yours');
    // within a team only the captain sets the wager
    const entity = this.ctx.entities().find((e) => e.id === ent);
    if (!this._isMod(actor) && entity && entity.captainId !== actor.id) return err('captain_only');
    if (forEnt && forEnt !== ent) return err('not_yours');
    this._snap();
    const max = Math.max(this._score(ent), 500 * this.rounds[this.round].mult);
    cur.wager = clampInt(amount, 100, max, 100);
    // whoever belongs to the entity may answer; the captain is highlighted
    cur.answerers = entity ? [entity.captainId, ...entity.members.filter((m) => m !== entity.captainId)] : [];
    cur.answerDeadline = this.s.answerTime > 0 ? Date.now() + this.s.answerTime * 1000 : 0;
    this.phase = 'dd_answer';
    this._changed('wager');
    return ok();
  }

  /** Close the clue without a winner and show the answer. */
  reveal(actor) {
    if (!this._isMod(actor)) return err('role');
    if (!['clue', 'buzz_open', 'answering', 'dd_wager', 'dd_answer'].includes(this.phase)) return err('phase');
    this._snap();
    this._toReveal();
    this._changed('reveal');
    return ok();
  }

  /** Put the clue back on the board untouched (picked by mistake). */
  unpick(actor) {
    if (!this._isMod(actor)) return err('role');
    if (!['clue', 'buzz_open', 'answering', 'dd_wager', 'dd_answer'].includes(this.phase)) return err('phase');
    this._snap();
    this._clearTimer();
    this.cur = null;
    this.phase = 'board';
    this._changed('unpick');
    return ok();
  }

  next(actor) {
    if (!this._isMod(actor)) return err('role');
    if (this.phase === 'reveal') {
      this._snap();
      const picked = this.cur?.pickedEnt;
      this.cur = null;
      if (this.s.answerMode === 'chooser') this._rotate(picked);
      this.phase = this._roundDone() ? 'round_end' : 'board';
      this._changed('next');
      return ok();
    }
    if (this.phase === 'round_end') {
      this._snap();
      if (this.round + 1 < this.rounds.length) {
        this.round++;
        this.phase = 'board';
        // the trailing entity opens the next round
        const ents = this.ctx.entities();
        if (ents.length) this.chooser = ents.slice().sort((a, b) => this._score(a.id) - this._score(b.id))[0].id;
      } else if (this.final) {
        this._startFinal();
      } else {
        this.phase = 'ended';
      }
      this._changed('next_round');
      return ok();
    }
    return err('phase');
  }

  endRound(actor) {
    if (!this._isMod(actor)) return err('role');
    if (this.phase !== 'board') return err('phase');
    this._snap();
    this.phase = 'round_end';
    this._changed('round_end');
    return ok();
  }

  // ---------- final ----------

  _finalMax(ent) {
    return Math.max(this._score(ent), FINAL_MIN_MAX_WAGER);
  }

  _startFinal() {
    this.cur = null;
    this.phase = 'final_wager';
    this.fin = {
      eligible: this.ctx.entities().map((e) => e.id),
      wagers: {},
      answers: {},
      order: [],
      idx: 0,
      results: {},
    };
  }

  finalWager(actor, amount, forEnt) {
    if (this.phase !== 'final_wager') return err('phase');
    const ent = this._isMod(actor) ? forEnt : this.ctx.entityOf(actor.id);
    if (!ent || !this.fin.eligible.includes(ent)) return err('not_eligible');
    if (!this._canActFor(actor, ent)) return err('not_yours');
    this.fin.wagers[ent] = clampInt(amount, 0, this._finalMax(ent), 0);
    this._changed('final_wager');
    return ok();
  }

  finalAnswer(actor, text) {
    if (this.phase !== 'final_clue') return err('phase');
    if (this.paused) return err('paused');
    const ent = this.ctx.entityOf(actor.id);
    if (actor.role !== 'player' || !ent || !this.fin.eligible.includes(ent)) return err('not_eligible');
    this.fin.answers[ent] = { text: cleanText(text, 200), by: actor.id };
    this._changed('final_answer');
    return ok();
  }

  _finalToReveal() {
    this._clearTimer();
    const f = this.fin;
    f.order = f.eligible.slice().sort((a, b) => this._score(a) - this._score(b));
    f.idx = 0;
    this.phase = f.order.length ? 'final_reveal' : 'ended';
  }

  finalAdvance(actor) {
    if (!this._isMod(actor)) return err('role');
    if (this.paused) return err('paused');
    if (this.phase === 'final_wager') {
      this._snap();
      for (const ent of this.fin.eligible) this.fin.wagers[ent] ??= 0;
      this.phase = 'final_clue';
      if (this.s.finalTime > 0) this._arm('final', this.s.finalTime * 1000);
      this._changed('final_clue');
      return ok();
    }
    if (this.phase === 'final_clue') {
      this._snap();
      this._finalToReveal();
      this._changed('final_reveal');
      return ok();
    }
    return err('phase');
  }

  finalJudge(actor, correct) {
    if (!this._isMod(actor)) return err('role');
    if (this.phase !== 'final_reveal') return err('phase');
    this._snap();
    const f = this.fin;
    const ent = f.order[f.idx];
    const wager = f.wagers[ent] ?? 0;
    this._add(ent, correct ? wager : -wager);
    f.results[ent] = { correct: !!correct, wager, answer: f.answers[ent]?.text ?? '' };
    const by = f.answers[ent]?.by;
    if (by) {
      const st = this._stat(by);
      if (correct) st.correct++;
      else st.wrong++;
      st.points += correct ? wager : -wager;
    }
    f.idx++;
    if (f.idx >= f.order.length) this.phase = 'ended';
    this._changed('final_judge');
    return ok();
  }

  // ---------- moderator tools ----------

  adjust(actor, ent, delta) {
    if (!this._isMod(actor)) return err('role');
    if (!(ent in this.scores) && !this.ctx.entities().some((e) => e.id === ent)) return err('entity');
    this._snap();
    this._add(ent, clampInt(delta, -100000, 100000, 0));
    this._changed('adjust');
    return ok();
  }

  setChooser(actor, ent) {
    if (!this._isMod(actor)) return err('role');
    if (!this.ctx.entities().some((e) => e.id === ent)) return err('entity');
    this.chooser = ent;
    this._changed('chooser');
    return ok();
  }

  undo(actor) {
    if (!this._isMod(actor)) return err('role');
    const snap = this.undoStack.pop();
    if (!snap) return err('nothing');
    this._clearTimer();
    this.phase = snap.phase;
    this.round = snap.round;
    this.scores = snap.scores;
    this.stats = snap.stats;
    this.chooser = snap.chooser;
    this.cur = snap.cur;
    this.fin = snap.fin;
    this.rounds.forEach((r, ri) => r.cats.forEach((c, ci) => c.clues.forEach((k, ki) => {
      [k.used, k.result] = snap.used[ri][ci][ki];
    })));
    this.paused = false;
    if (this.phase === 'buzz_open' && this.s.buzzTime > 0) this._arm('buzz', this.s.buzzTime * 1000);
    if (this.phase === 'final_clue' && this.s.finalTime > 0) this._arm('final', this.s.finalTime * 1000);
    this._changed('undo');
    return ok();
  }

  pause(actor, on) {
    if (!this._isMod(actor)) return err('role');
    this.setPaused(!!on);
    return ok();
  }

  setPaused(on) {
    if (on === this.paused || this.phase === 'ended') return;
    if (on) {
      this.pausedRemaining = this.timer ? Math.max(500, this.deadline - Date.now()) : 0;
      this.pausedKind = this.timerKind;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.deadline = 0;
      if (this.buzzWin) {
        clearTimeout(this.buzzWin.timer);
        this.buzzWin = null;
      }
    } else if (this.pausedRemaining > 0 && this.pausedKind) {
      this._arm(this.pausedKind, this.pausedRemaining);
    }
    this.paused = on;
    this._changed('pause');
  }

  end(actor) {
    if (!this._isMod(actor)) return err('role');
    this._clearTimer();
    this.phase = 'ended';
    this.cur = null;
    this._changed('ended');
    return ok();
  }

  /** A new entity appeared mid game (late joiner promoted to player). */
  ensureEntity(ent) {
    this.scores[ent] ??= 0;
    if (!this.chooser) this.chooser = ent;
  }

  dispose() {
    this._clearTimer();
  }

  isHot() {
    return !this.paused && HOT_PHASES.has(this.phase);
  }

  /** Short label of what is on screen, used in the anti-cheat log. */
  describe() {
    if (this.cur) {
      const cat = this.rounds[this.round].cats[this.cur.c];
      return `${cat.title} ${this.cur.value}`;
    }
    if (this.phase.startsWith('final')) return 'Finale';
    return '';
  }

  // ---------- view ----------

  view(role, viewerId) {
    const mod = role === 'mod';
    const round = this.rounds[this.round];
    const board = round.cats.map((c) => ({
      title: c.title,
      pack: c.pack,
      clues: c.clues.map((k) => ({
        value: k.value,
        used: k.used,
        result: k.result,
        dd: mod || k.used ? k.dd : undefined,
      })),
    }));
    let cur = null;
    if (this.cur) {
      const clue = this._clue();
      const cat = round.cats[this.cur.c];
      const showClue = this.phase !== 'dd_wager' || mod;
      const showAnswer = mod || this.phase === 'reveal';
      cur = {
        c: this.cur.c,
        r: this.cur.r,
        category: cat.title,
        pack: cat.pack,
        value: this.cur.value,
        dd: this.cur.dd,
        ddEnt: this.cur.ddEnt,
        wager: this.cur.wager,
        wagerMax: this.cur.ddEnt ? Math.max(this._score(this.cur.ddEnt), 500 * round.mult) : 0,
        q: showClue ? clue.q : '',
        img: showClue ? clue.img : '',
        a: showAnswer ? clue.a : undefined,
        note: mod ? clue.note : undefined,
        buzzer: this.cur.buzzer,
        turnEnt: this.cur.turnEnt && !this.cur.turnDone ? this.cur.turnEnt : null,
        teamAnswer: this.cur.teamAnswer,
        answerEnt: this.cur.buzzerEnt ?? this.cur.ddEnt ?? null,
        answerers: this.cur.answerers,
        answerDeadline: this.cur.answerDeadline,
        lockedEnt: this.cur.lockedEnt,
        lockedPl: this.cur.lockedPl,
        attempts: this.cur.attempts,
        buzzOrder: this.cur.buzzOrder,
        winner: this.cur.winner,
        winnerEnt: this.cur.winnerEnt,
      };
    }
    let fin = null;
    if (this.fin && this.final) {
      const f = this.fin;
      const myEnt = this.ctx.entityOf(viewerId);
      const showClue = this.phase !== 'final_wager' || mod;
      const current = this.phase === 'final_reveal' ? f.order[f.idx] : null;
      fin = {
        category: this.final.category,
        q: showClue ? this.final.q : '',
        img: showClue ? this.final.img : '',
        a: mod || this.phase === 'ended' ? this.final.a : undefined,
        note: mod ? this.final.note : undefined,
        eligible: f.eligible,
        max: Object.fromEntries(f.eligible.map((e) => [e, this._finalMax(e)])),
        wagered: Object.keys(f.wagers),
        answered: Object.keys(f.answers),
        myWager: myEnt ? f.wagers[myEnt] ?? null : null,
        myAnswer: myEnt ? f.answers[myEnt]?.text ?? null : null,
        wagers: mod ? f.wagers : undefined,
        answers: mod ? Object.fromEntries(Object.entries(f.answers).map(([k, v]) => [k, v.text])) : undefined,
        order: f.order,
        idx: f.idx,
        current: current ? { ent: current, answer: f.answers[current]?.text ?? '' } : null,
        results: f.results,
      };
    }
    return {
      phase: this.phase,
      round: this.round,
      roundCount: this.rounds.length,
      mult: round.mult,
      hasFinal: !!this.final,
      answerMode: this.s.answerMode,
      board,
      scores: this.scores,
      stats: this.stats,
      chooser: this.chooser,
      cur,
      fin,
      deadline: this.deadline,
      timerKind: this.timerKind,
      paused: this.paused,
      canUndo: mod ? this.undoStack.length > 0 : undefined,
    };
  }
}
