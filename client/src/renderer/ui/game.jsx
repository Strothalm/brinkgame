import { useEffect, useState } from 'preact/hooks';
import { S, isMod, member, entity, entityOfPlayer, openModal } from '../store.js';
import * as act from '../actions.js';
import { imageSrc } from '../packs.js';
import { Avatar, Btn, Icon, TimerBar, fmtScore, useCountdown, Seg } from './common.jsx';
import { CamTile, keyLabel } from './cams.jsx';
import { AnticheatPanel } from './anticheat.jsx';

const entName = (id) => entity(id)?.name ?? 'Unbekannt';

function textSize(text, hasImage) {
  const n = (text ?? '').length;
  if (hasImage) return 'sz-s';
  if (n < 60) return 'sz-xl';
  if (n < 120) return 'sz-l';
  if (n < 220) return 'sz-m';
  return 'sz-s';
}

// ---------- board ----------

function Board() {
  const g = S.game;
  const mod = isMod();
  const mayPick = g.phase === 'board' && !g.paused && (mod || (S.you.role === 'player' && S.you.entity === g.chooser));
  const chooser = entity(g.chooser);
  const mine = S.you.entity === g.chooser && S.you.role === 'player';
  return (
    <div class="board-wrap">
      <div class={`turn-banner ${mine ? 'mine' : ''}`}>
        <span class="round-tag">Runde {g.round + 1}{g.roundCount > 1 ? ` von ${g.roundCount}` : ''}</span>
        {chooser ? (
          mine ? <strong>Du bist dran: Wähle ein Feld.</strong> : <span><strong style={{ color: chooser.color }}>{chooser.name}</strong> wählt das nächste Feld.</span>
        ) : (
          <span>Der Moderator wählt das nächste Feld.</span>
        )}
      </div>
      <div class={`board ${mayPick ? 'pickable' : ''}`} style={{ '--cols': g.board.length, '--rows': g.board[0].clues.length }}>
        {g.board.map((cat, ci) => (
          <div class="board-cat" key={`h${ci}`} style={{ gridColumn: ci + 1 }}>
            <span class="cat-title">{cat.title}</span>
            {cat.pack && cat.pack !== cat.title && <span class="cat-pack">{cat.pack}</span>}
          </div>
        ))}
        {g.board.map((cat, ci) => cat.clues.map((k, ri) => {
          const winner = k.used && k.result && k.result !== 'none' ? entity(k.result) : null;
          return (
            <button
              type="button"
              key={`${ci}-${ri}`}
              class={`tile ${k.used ? 'used' : ''} ${mod && k.dd && !k.used ? 'dd-hint' : ''}`}
              style={{ gridColumn: ci + 1, gridRow: ri + 2, '--i': ci + ri, '--w': winner?.color }}
              disabled={k.used || !mayPick}
              onClick={() => act.game('pick', { c: ci, r: ri })}
              aria-label={`${cat.title} für ${k.value}`}
            >
              {k.used ? (winner ? <span class="tile-won" title={winner.name} /> : <span class="tile-none" />) : <span class="tile-val">{k.value}</span>}
              {mod && k.dd && !k.used && <span class="tile-dd" title="Risiko-Feld (nur du siehst das)"><Icon name="bolt" size={13} /></span>}
            </button>
          );
        }))}
      </div>
    </div>
  );
}

// ---------- clue ----------

function BuzzArea() {
  const g = S.game;
  const cur = g.cur;
  const role = S.you.role;
  const [, force] = useState(0);
  const early = S.buzzEarly && Date.now() - S.buzzEarly < 600;
  useEffect(() => {
    if (!early) return undefined;
    const id = setTimeout(() => force((x) => x + 1), 620);
    return () => clearTimeout(id);
  }, [S.buzzEarly]);

  if (g.phase === 'answering' || g.phase === 'dd_answer') {
    const who = member(cur.answerers[0]);
    const ent = who ? entityOfPlayer(who.id) : null;
    const me = who?.id === S.conn.id;
    const mates = g.phase === 'dd_answer' ? cur.answerers.slice(1).map(member).filter(Boolean) : [];
    return (
      <div class={`answering ${me ? 'me' : ''}`}>
        {who && <CamTile m={who} big />}
        <div class="answering-text">
          <span class="label">{g.phase === 'dd_answer' ? `Risiko · Einsatz ${fmtScore(cur.wager)}` : 'Gebuzzert'}</span>
          <strong>{me ? 'Du antwortest!' : `${who?.name ?? '…'} antwortet`}</strong>
          {ent?.kind === 'team' && <span class="muted">für {ent.name}{mates.length ? ` · mit ${mates.map((m) => m.name).join(', ')}` : ''}</span>}
          <AnswerClock deadline={cur.answerDeadline} />
        </div>
      </div>
    );
  }

  if (g.phase === 'clue') {
    return (
      <div class="buzz-area">
        {role === 'player' ? (
          <button type="button" class={`buzzer closed ${early ? 'early' : ''}`} onClick={act.buzz}>
            <span class="buzzer-main">{early ? 'Zu früh!' : 'Gleich …'}</span>
            <span class="buzzer-sub">{early ? 'Kurz gesperrt' : 'Der Moderator liest vor'}</span>
          </button>
        ) : (
          <p class="stage-note">{isMod() ? 'Lies die Frage vor und gib dann die Buzzer frei.' : 'Der Moderator liest vor.'}</p>
        )}
      </div>
    );
  }

  if (g.phase === 'buzz_open') {
    const locked = role === 'player' && (cur.lockedEnt.includes(S.you.entity) || cur.lockedPl.includes(S.you.id));
    return (
      <div class="buzz-area">
        <TimerBar deadline={g.deadline} total={S.lobby.settings.buzzTime} paused={g.paused} />
        {role === 'player' ? (
          locked ? (
            <div class="buzzer locked"><span class="buzzer-main">Gesperrt</span><span class="buzzer-sub">Für diese Frage bist du raus</span></div>
          ) : (
            <button type="button" class="buzzer open" onClick={act.buzz}>
              <span class="buzzer-main">BUZZER</span>
              <span class="buzzer-sub">{keyLabel(S.settings.keys.buzz)} oder klicken</span>
            </button>
          )
        ) : (
          <p class="stage-note live"><span class="pulse" />Buzzer sind offen</p>
        )}
        {cur.attempts.length > 0 && <p class="attempts">Schon falsch: {cur.attempts.map((a) => member(a.id)?.name ?? '?').join(', ')}</p>}
      </div>
    );
  }
  return null;
}

function AnswerClock({ deadline }) {
  const { left, active } = useCountdown(deadline, S.lobby.settings.answerTime);
  if (!active) return null;
  return <span class={`answer-clock ${left < 3 ? 'low' : ''}`}>{Math.ceil(left)} s</span>;
}

function WagerBox({ max, onSubmit, min = 100, label }) {
  const [v, setV] = useState(String(Math.min(max, Math.max(min, 500))));
  const n = Math.min(max, Math.max(min, Math.round(Number(v)) || min));
  return (
    <div class="wager">
      <span class="label">{label}</span>
      <div class="wager-row">
        <input type="number" min={min} max={max} step="100" value={v} onInput={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && onSubmit(n)} autoFocus />
        <Btn kind="primary" onClick={() => onSubmit(n)}>Setzen</Btn>
      </div>
      <div class="wager-quick">
        {[...new Set([min, Math.round(max / 4 / 100) * 100, Math.round(max / 2 / 100) * 100, max])].filter((x) => x >= min && x <= max).map((x) => (
          <button type="button" key={x} onClick={() => setV(String(x))}>{x === max ? `Alles (${fmtScore(x)})` : fmtScore(x)}</button>
        ))}
      </div>
    </div>
  );
}

function DailyDouble() {
  const g = S.game;
  const cur = g.cur;
  const ent = entity(cur.ddEnt);
  const captain = ent?.captainId === S.conn.id && S.you.role === 'player';
  const mine = S.you.entity === cur.ddEnt;
  return (
    <div class="dd">
      <div class="dd-splash"><Icon name="bolt" size={34} /><span>Risiko!</span></div>
      <p class="dd-who"><strong style={{ color: ent?.color }}>{ent?.name}</strong> spielt dieses Feld allein und setzt bis zu {fmtScore(cur.wagerMax)} Punkte.</p>
      <p class="muted">{cur.category} · {cur.value}</p>
      {captain || isMod() ? (
        <WagerBox max={cur.wagerMax} label={isMod() && !captain ? `Einsatz für ${ent?.name} eintragen` : 'Dein Einsatz'} onSubmit={(amount) => act.game('wager', { amount })} />
      ) : (
        <p class="stage-note"><span class="pulse" />{mine ? `Euer Kapitän ${member(ent?.captainId)?.name ?? ''} setzt.` : 'Der Einsatz wird gewählt …'}</p>
      )}
    </div>
  );
}

function Clue() {
  const g = S.game;
  const cur = g.cur;
  if (g.phase === 'dd_wager') return <div class="clue-stage"><DailyDouble /></div>;
  const reveal = g.phase === 'reveal';
  const winner = reveal && cur.winnerEnt ? entity(cur.winnerEnt) : null;
  const winnerPlayer = cur.winner ? member(cur.winner) : null;
  const lastWrong = reveal && !winner && cur.attempts.length ? cur.attempts[cur.attempts.length - 1] : null;
  return (
    <div class={`clue-stage phase-${g.phase}`}>
      <header class="clue-head">
        <span class="clue-cat">{cur.category}</span>
        <span class="clue-val">{cur.dd ? <><Icon name="bolt" size={16} /> {fmtScore(cur.wager)}</> : cur.value}</span>
      </header>
      <div class={`clue-card ${textSize(cur.q, !!cur.img)}`}>
        {cur.img && <img class="clue-img" src={imageSrc(cur.img)} alt="" />}
        {cur.q && <p class="clue-text">{cur.q}</p>}
        {reveal && (
          <div class="clue-answer">
            <span class="label">Antwort</span>
            <strong>{cur.a}</strong>
          </div>
        )}
      </div>
      {reveal ? (
        <div class={`result ${winner ? 'good' : 'none'}`}>
          {winner ? (
            <>
              <Icon name="check" size={22} />
              <span><strong style={{ color: winner.color }}>{winnerPlayer && winner.kind === 'team' ? `${winnerPlayer.name} (${winner.name})` : winner.name}</strong> holt {fmtScore(cur.dd ? cur.wager : cur.value)} Punkte.</span>
            </>
          ) : (
            <>
              <Icon name="x" size={22} />
              <span>{lastWrong && cur.dd ? `${entName(lastWrong.ent)} verliert ${fmtScore(cur.wager)} Punkte.` : 'Niemand holt die Punkte.'}</span>
            </>
          )}
        </div>
      ) : (
        <BuzzArea />
      )}
    </div>
  );
}

// ---------- round end, final, end ----------

function Ranking({ final }) {
  const g = S.game;
  const list = S.lobby.entities.map((e) => ({ e, score: g.scores[e.id] ?? 0 })).sort((a, b) => b.score - a.score);
  let rank = 0;
  let prev = null;
  return (
    <ol class={`ranking ${final ? 'final' : ''}`}>
      {list.map(({ e, score }, i) => {
        if (score !== prev) rank = i + 1;
        prev = score;
        return (
          <li key={e.id} class={`rank-${rank} ${S.you.entity === e.id ? 'mine' : ''}`} style={{ '--c': e.color, '--i': i }}>
            <span class="rank-no">{rank}</span>
            <span class="rank-name">
              <strong>{e.name}</strong>
              {e.kind === 'team' && <small>{e.members.map((id) => member(id)?.name).filter(Boolean).join(', ')}</small>}
            </span>
            <span class={`rank-score ${score < 0 ? 'neg' : ''}`}>{fmtScore(score)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RoundEnd() {
  const g = S.game;
  const last = g.round + 1 >= g.roundCount;
  return (
    <div class="interlude">
      <span class="label">Runde {g.round + 1} ist vorbei</span>
      <h2>{last ? (g.hasFinal ? 'Gleich kommt das Finale' : 'Das war die letzte Runde') : 'Zwischenstand'}</h2>
      <Ranking />
      {!isMod() && <p class="stage-note"><span class="pulse" />Der Moderator macht gleich weiter.</p>}
    </div>
  );
}

function FinalStage() {
  const g = S.game;
  const f = g.fin;
  const mod = isMod();
  const myEnt = S.you.role === 'player' ? S.you.entity : null;
  const eligible = myEnt && f.eligible.includes(myEnt);
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState(false);

  if (g.phase === 'final_wager') {
    const done = f.myWager !== null;
    return (
      <div class="clue-stage final">
        <header class="clue-head"><span class="clue-cat">Finale</span><span class="clue-val">{f.wagered.length}/{f.eligible.length} gesetzt</span></header>
        <div class="clue-card sz-l">
          <span class="label">Kategorie</span>
          <p class="clue-text">{f.category}</p>
        </div>
        {eligible ? (
          done ? (
            <p class="stage-note">Dein Einsatz: <strong>{fmtScore(f.myWager)}</strong>. Du kannst ihn noch ändern, bis der Moderator die Frage zeigt.</p>
          ) : null
        ) : (
          <p class="stage-note"><span class="pulse" />Die Spieler setzen geheim.</p>
        )}
        {eligible && <WagerBox min={0} max={f.max[myEnt]} label={entity(myEnt)?.kind === 'team' ? 'Einsatz eures Teams (geheim)' : 'Dein geheimer Einsatz'} onSubmit={(amount) => act.game('finalWager', { amount })} />}
      </div>
    );
  }

  if (g.phase === 'final_clue') {
    const submitted = f.myAnswer !== null;
    return (
      <div class="clue-stage final">
        <header class="clue-head"><span class="clue-cat">Finale · {f.category}</span><span class="clue-val">{f.answered.length}/{f.eligible.length} abgegeben</span></header>
        <div class={`clue-card ${textSize(f.q, !!f.img)}`}>
          {f.img && <img class="clue-img" src={imageSrc(f.img)} alt="" />}
          <p class="clue-text">{f.q}</p>
        </div>
        <TimerBar deadline={g.deadline} total={S.lobby.settings.finalTime} paused={g.paused} />
        {eligible ? (
          <div class="final-answer">
            <span class="label">Antwort eintippen, nicht laut sagen!</span>
            <div class="wager-row">
              <input
                value={answer}
                maxLength={200}
                placeholder={submitted ? f.myAnswer : 'Deine Antwort'}
                onInput={(e) => {
                  setAnswer(e.currentTarget.value);
                  setSent(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && answer.trim()) {
                    act.game('finalAnswer', { text: answer.trim() });
                    setSent(true);
                  }
                }}
                autoFocus
              />
              <Btn
                kind="primary"
                disabled={!answer.trim()}
                onClick={() => {
                  act.game('finalAnswer', { text: answer.trim() });
                  setSent(true);
                }}
              >
                {submitted ? 'Ändern' : 'Abgeben'}
              </Btn>
            </div>
            {submitted && <small class="muted">{sent ? 'Abgegeben' : 'Zuletzt abgegeben'}: „{f.myAnswer}“</small>}
          </div>
        ) : (
          <p class="stage-note"><span class="pulse" />Die Spieler tippen ihre Antwort.</p>
        )}
      </div>
    );
  }

  // final_reveal
  const cur = f.current;
  const ent = cur ? entity(cur.ent) : null;
  return (
    <div class="clue-stage final">
      <header class="clue-head"><span class="clue-cat">Finale · {f.category}</span><span class="clue-val">{f.idx}/{f.order.length}</span></header>
      <div class="clue-card sz-s"><p class="clue-text">{f.q}</p></div>
      <div class="final-reveal">
        {f.order.map((id, i) => {
          const res = f.results[id];
          const e = entity(id);
          const active = i === f.idx;
          return (
            <div key={id} class={`final-row ${res ? (res.correct ? 'good' : 'bad') : ''} ${active ? 'active' : ''}`} style={{ '--c': e?.color }}>
              <strong>{e?.name ?? '?'}</strong>
              <span class="final-ans">{res ? (res.answer || 'keine Antwort') : active ? (cur.answer || 'keine Antwort') : '…'}</span>
              <span class="final-delta">{res ? `${res.correct ? '+' : '−'}${fmtScore(res.wager)}` : ''}</span>
            </div>
          );
        })}
      </div>
      {!mod && ent && <p class="stage-note"><span class="pulse" />Der Moderator bewertet die Antwort von {ent.name}.</p>}
    </div>
  );
}

function Ended() {
  const g = S.game;
  const stats = Object.entries(g.stats).map(([id, st]) => ({ m: member(id), ...st })).filter((x) => x.m);
  const best = stats.slice().sort((a, b) => b.correct - a.correct)[0];
  const fastest = stats.slice().sort((a, b) => b.buzzes - a.buzzes)[0];
  return (
    <div class="interlude ended">
      <span class="label">Endstand</span>
      <h2>{(() => {
        const top = S.lobby.entities.map((e) => ({ e, s: g.scores[e.id] ?? 0 })).sort((a, b) => b.s - a.s);
        if (!top.length) return 'Spiel beendet';
        const tie = top.filter((x) => x.s === top[0].s);
        return tie.length > 1 ? 'Unentschieden an der Spitze' : `${top[0].e.name} gewinnt`;
      })()}</h2>
      <Ranking final />
      <div class="awards">
        {best && best.correct > 0 && <div class="award"><span class="label">Meiste richtige Antworten</span><strong>{best.m.name}</strong><small>{best.correct} richtig, {best.wrong} falsch</small></div>}
        {fastest && fastest.buzzes > 0 && <div class="award"><span class="label">Schnellster Finger</span><strong>{fastest.m.name}</strong><small>{fastest.buzzes}-mal zuerst gebuzzert</small></div>}
        {g.fin?.a && <div class="award"><span class="label">Antwort im Finale</span><strong>{g.fin.a}</strong></div>}
      </div>
      {!isMod() && <p class="stage-note">Der Moderator kann eine neue Runde starten.</p>}
    </div>
  );
}

export function Stage() {
  const g = S.game;
  let content;
  if (g.phase === 'board') content = <Board />;
  else if (g.phase === 'round_end') content = <RoundEnd />;
  else if (g.phase === 'ended') content = <Ended />;
  else if (g.phase.startsWith('final')) content = <FinalStage />;
  else content = <Clue />;
  return (
    <div class="stage">
      {content}
      {g.paused && (
        <div class="paused"><Icon name="pause" size={30} /><strong>Pause</strong><span>{member(S.lobby.modId)?.connected ? 'Der Moderator hat das Spiel angehalten.' : 'Der Moderator ist getrennt. Es geht weiter, sobald er zurück ist.'}</span></div>
      )}
    </div>
  );
}

// ---------- moderator panel ----------

function Scores() {
  const g = S.game;
  const [step, setStep] = useState(100);
  return (
    <div class="mod-scores">
      <div class="toolbar">
        <span class="label">Schrittweite</span>
        <Seg value={step} onChange={setStep} options={[100, 200, 500, 1000].map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <ul>
        {S.lobby.entities.map((e) => (
          <li key={e.id} style={{ '--c': e.color }}>
            <span class="team-dot" />
            <span class="grow">{e.name}</span>
            <Btn size="sm" icon="minus" onClick={() => act.game('adjust', { ent: e.id, delta: -step })} aria-label="Punkte abziehen" />
            <span class={`mono ${(g.scores[e.id] ?? 0) < 0 ? 'neg' : ''}`}>{fmtScore(g.scores[e.id] ?? 0)}</span>
            <Btn size="sm" icon="plus" onClick={() => act.game('adjust', { ent: e.id, delta: step })} aria-label="Punkte geben" />
            <Btn size="sm" kind={g.chooser === e.id ? 'primary' : 'ghost'} onClick={() => act.game('setChooser', { ent: e.id })} title="Darf als Nächstes wählen">wählt</Btn>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModControls() {
  const g = S.game;
  const cur = g.cur;
  const f = g.fin;

  useEffect(() => {
    const onKey = (ev) => {
      const el = ev.target;
      if (ev.repeat || S.modal || (el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const p = S.game?.phase;
      if (!p) return;
      const k = ev.code;
      if ((p === 'answering' || p === 'dd_answer') && k === 'KeyR') act.game('judge', { correct: true });
      else if ((p === 'answering' || p === 'dd_answer') && k === 'KeyF') act.game('judge', { correct: false });
      else if (p === 'final_reveal' && k === 'KeyR') act.game('finalJudge', { correct: true });
      else if (p === 'final_reveal' && k === 'KeyF') act.game('finalJudge', { correct: false });
      else if (p === 'clue' && k === 'KeyB') act.game('openBuzz');
      else if ((p === 'reveal' || p === 'round_end') && (k === 'KeyN' || k === 'Enter')) act.game('next');
      else if ((p === 'clue' || p === 'buzz_open') && k === 'KeyA') act.game('reveal');
      else return;
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const answerBox = (a, note) => (
    <div class="mod-answer">
      <span class="label">Richtige Antwort</span>
      <strong>{a}</strong>
      {note && <small>{note}</small>}
    </div>
  );

  if (g.phase === 'board') {
    return (
      <div class="mod-now">
        <p class="mod-hint">Wartet auf die Auswahl. Du kannst auch selbst ein Feld anklicken.</p>
        <Btn icon="right" onClick={() => act.game('endRound')}>Runde vorzeitig beenden</Btn>
      </div>
    );
  }
  if (g.phase === 'round_end') {
    const last = g.round + 1 >= g.roundCount;
    return (
      <div class="mod-now">
        <Btn kind="primary" size="lg" icon="right" onClick={() => act.game('next')}>{last ? (g.hasFinal ? 'Finale starten' : 'Endstand zeigen') : `Runde ${g.round + 2} starten`}<kbd>N</kbd></Btn>
      </div>
    );
  }
  if (g.phase === 'ended') {
    return (
      <div class="mod-now">
        {S.lobby.settings.anticheat && <Btn icon="shield" onClick={() => openModal({ type: 'aclog' })}>Anti-Cheat-Protokoll ansehen</Btn>}
        <Btn kind="primary" size="lg" icon="refresh" onClick={act.backToLobby}>Zurück zur Lobby</Btn>
      </div>
    );
  }
  if (g.phase === 'final_wager') {
    return (
      <div class="mod-now">
        {answerBox(f.a, f.note)}
        <p class="mod-hint">Frage: {f.q}</p>
        <ul class="mod-list">
          {f.eligible.map((id) => <li key={id}><span class="grow">{entName(id)}</span><span class="mono">{id in f.wagers ? fmtScore(f.wagers[id]) : 'setzt noch …'}</span></li>)}
        </ul>
        <Btn kind="primary" size="lg" icon="right" onClick={() => act.game('finalAdvance')}>Frage zeigen</Btn>
        <small class="muted">Wer bis dahin nichts gesetzt hat, spielt mit Einsatz 0.</small>
      </div>
    );
  }
  if (g.phase === 'final_clue') {
    return (
      <div class="mod-now">
        {answerBox(f.a, f.note)}
        <ul class="mod-list">
          {f.eligible.map((id) => <li key={id}><span class="grow">{entName(id)}</span><span>{f.answers[id] ?? <em class="muted">tippt …</em>}</span></li>)}
        </ul>
        <Btn kind="primary" size="lg" icon="right" onClick={() => act.game('finalAdvance')}>Antworten auflösen</Btn>
      </div>
    );
  }
  if (g.phase === 'final_reveal') {
    const c = f.current;
    return (
      <div class="mod-now">
        {answerBox(f.a, f.note)}
        {c && (
          <>
            <div class="mod-who"><span class="label">Antwort von {entName(c.ent)} · Einsatz {fmtScore(f.wagers[c.ent] ?? 0)}</span><strong>{c.answer || 'keine Antwort'}</strong></div>
            <div class="judge">
              <Btn kind="good" size="lg" icon="check" onClick={() => act.game('finalJudge', { correct: true })}>Richtig<kbd>R</kbd></Btn>
              <Btn kind="bad" size="lg" icon="x" onClick={() => act.game('finalJudge', { correct: false })}>Falsch<kbd>F</kbd></Btn>
            </div>
          </>
        )}
      </div>
    );
  }

  // clue phases
  const who = cur.answerers?.[0] ? member(cur.answerers[0]) : null;
  return (
    <div class="mod-now">
      {answerBox(cur.a, cur.note)}
      {g.phase === 'dd_wager' && <p class="mod-hint">Risiko-Feld: {entName(cur.ddEnt)} setzt gerade. Frage: {cur.q || '(Bild)'}</p>}
      {g.phase === 'clue' && <Btn kind="primary" size="lg" icon="bolt" onClick={() => act.game('openBuzz')}>Buzzer freigeben<kbd>B</kbd></Btn>}
      {g.phase === 'buzz_open' && <p class="mod-hint live"><span class="pulse" />Buzzer offen{cur.attempts.length ? ` · schon falsch: ${cur.attempts.map((a) => member(a.id)?.name).join(', ')}` : ''}</p>}
      {(g.phase === 'answering' || g.phase === 'dd_answer') && (
        <>
          <div class="mod-who">
            <span class="label">{g.phase === 'dd_answer' ? `Risiko · Einsatz ${fmtScore(cur.wager)}` : 'Antwortet jetzt'}</span>
            <strong>{who?.name ?? entName(cur.ddEnt)}</strong>
            {cur.buzzOrder.length > 1 && <small class="muted">Danach: {cur.buzzOrder.slice(1).map((b) => `${member(b.id)?.name} +${b.d} ms`).join(', ')}</small>}
          </div>
          <div class="judge">
            <Btn kind="good" size="lg" icon="check" onClick={() => act.game('judge', { correct: true })}>Richtig<kbd>R</kbd></Btn>
            <Btn kind="bad" size="lg" icon="x" onClick={() => act.game('judge', { correct: false })}>Falsch<kbd>F</kbd></Btn>
          </div>
        </>
      )}
      {g.phase === 'reveal' && <Btn kind="primary" size="lg" icon="right" onClick={() => act.game('next')}>Weiter<kbd>N</kbd></Btn>}
      {g.phase !== 'reveal' && (
        <div class="btnrow">
          <Btn icon="eye" onClick={() => act.game('reveal')} title="Antwort zeigen, niemand bekommt Punkte">Auflösen</Btn>
          <Btn icon="undo" onClick={() => act.game('unpick')} title="Frage zurück aufs Board legen">Zurücklegen</Btn>
        </div>
      )}
    </div>
  );
}

export function ModPanel() {
  const [tab, setTab] = useState('control');
  const g = S.game;
  const ac = S.lobby.settings.anticheat;
  useEffect(() => {
    if (tab === 'ac' && S.ac.unseen) {
      S.ac.unseen = 0;
    }
  });
  const tabs = [{ value: 'control', label: 'Steuerung' }, { value: 'scores', label: 'Punkte' }];
  if (ac) tabs.push({ value: 'ac', label: `Anti-Cheat${S.ac.unseen && tab !== 'ac' ? ` (${S.ac.unseen})` : ''}` });
  return (
    <aside class="modpanel">
      <header class="panel-head tabs"><Seg value={tab} onChange={setTab} options={tabs} /></header>
      <div class="panel-body scroll">
        {tab === 'control' && <ModControls />}
        {tab === 'scores' && <Scores />}
        {tab === 'ac' && <AnticheatPanel />}
      </div>
      {g.phase !== 'ended' && (
        <footer class="panel-foot compact">
          <Btn icon="undo" disabled={!g.canUndo} onClick={() => act.game('undo')} title="Letzten Schritt zurücknehmen">Rückgängig</Btn>
          <Btn icon={g.paused ? 'play' : 'pause'} onClick={() => act.game('pause', { on: !g.paused })}>{g.paused ? 'Weiter' : 'Pause'}</Btn>
          <Btn icon="x" kind="danger ghost" onClick={() => openModal({ type: 'confirm', title: 'Spiel beenden?', text: 'Die Runde endet sofort und der aktuelle Stand wird zum Endstand.', yes: 'Beenden', action: () => act.game('end') })}>Beenden</Btn>
        </footer>
      )}
    </aside>
  );
}
