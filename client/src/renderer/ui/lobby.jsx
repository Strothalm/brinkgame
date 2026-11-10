import { useState } from 'preact/hooks';
import { S, emit, openModal, closeModal, isMod, member, toast, go } from '../store.js';
import * as act from '../actions.js';
import { draft } from '../actions.js';
import { allPacks, getPack, packStats, selectionCapacity, rerollColumn, rerollClue, rerollFinal, imageSrc } from '../packs.js';
import { Avatar, Btn, Icon, Toggle, Seg, Field, Modal, LazyInput, Empty } from './common.jsx';

// ---------- members and teams ----------

function AcBadge({ m }) {
  if (!S.lobby.settings.anticheat || m.role !== 'player') return null;
  const map = {
    ok: ['good', 'Anti-Cheat aktiv'],
    pending: ['warn', 'Zustimmung fehlt'],
    declined: ['bad', 'Abgelehnt'],
    unsupported: ['warn', 'Browser: keine Überwachung'],
  };
  const [kind, text] = map[m.ac] ?? map.pending;
  return <span class={`tag ${kind}`} title={text}><Icon name="shield" size={12} />{text}</span>;
}

function MemberRow({ m }) {
  const self = m.id === S.conn.id;
  return (
    <li class={`member ${m.connected ? '' : 'gone'}`}>
      <button type="button" class="member-main" onClick={() => openModal({ type: 'user', id: m.id })}>
        <Avatar name={m.name} color={m.color} />
        <span class="member-name">{m.name}{self && <em> (du)</em>}</span>
      </button>
      {m.role === 'mod' && <span class="tag accent"><Icon name="crown" size={12} />Moderator</span>}
      <AcBadge m={m} />
      {!m.connected && <span class="tag warn">getrennt</span>}
      {m.client === 'web' && <span class="tag" title="Spielt im Browser">Browser</span>}
    </li>
  );
}

function TeamCard({ team }) {
  const me = member(S.conn.id);
  const members = S.lobby.members.filter((m) => m.role === 'player' && m.teamId === team.id);
  const mod = isMod();
  const mine = me?.teamId === team.id;
  const canEdit = mod || team.captainId === S.conn.id;
  const open = S.lobby.settings.mode === 'mixed' && (mod || !S.lobby.settings.teamsLocked);
  return (
    <div class={`team-card ${mine ? 'mine' : ''}`} style={{ '--c': team.color }}>
      <header>
        <span class="team-dot" />
        {canEdit ? <LazyInput class="team-name" value={team.name} maxLength={24} onCommit={(name) => act.lobby.teamUpdate(team.id, { name })} /> : <strong class="team-name">{team.name}</strong>}
        <span class="muted">{members.length}</span>
        {me?.role === 'player' && open && !mod && (mine ? <Btn size="sm" onClick={() => act.lobby.teamJoin(null)}>Verlassen</Btn> : <Btn size="sm" kind="primary" onClick={() => act.lobby.teamJoin(team.id)}>Beitreten</Btn>)}
        {mod && <Btn size="sm" icon="trash" kind="ghost" onClick={() => act.lobby.teamDelete(team.id)} aria-label="Team löschen" />}
      </header>
      <ul class="member-list">
        {members.map((m) => <MemberRow key={m.id} m={m} />)}
        {!members.length && <li class="muted pad">Noch niemand im Team</li>}
      </ul>
    </div>
  );
}

function People() {
  const lobby = S.lobby;
  const me = member(S.conn.id);
  const mod = isMod();
  const players = lobby.members.filter((m) => m.role === 'player');
  const solo = players.filter((m) => !m.teamId);
  const spectators = lobby.members.filter((m) => m.role === 'spectator');
  const modMember = member(lobby.modId);
  const mixed = lobby.settings.mode === 'mixed';
  const teamsOpen = mixed && (mod || !lobby.settings.teamsLocked);
  const [shuffleN, setShuffleN] = useState(2);

  return (
    <section class="panel people">
      <header class="panel-head">
        <h2>Spieler <span class="muted">{players.length}/{lobby.settings.maxPlayers}</span></h2>
        {me?.role === 'player' && <Btn size="sm" icon="eye" onClick={() => act.lobby.role(me.id, 'spectator')}>Nur zuschauen</Btn>}
        {me?.role === 'spectator' && <Btn size="sm" kind="primary" icon="user" onClick={() => act.lobby.role(me.id, 'player')}>Mitspielen</Btn>}
      </header>
      <div class="panel-body scroll">
        {modMember && <ul class="member-list"><MemberRow m={modMember} /></ul>}

        {mixed && (
          <div class="team-tools">
            <span class="label">{lobby.teams.length ? 'Teams' : 'Teams sind freiwillig'}</span>
            {teamsOpen && (mod || me?.role === 'player') && <Btn size="sm" icon="plus" onClick={() => act.lobby.teamCreate('')}>Team gründen</Btn>}
            {mod && (
              <span class="shuffle">
                <select value={shuffleN} onChange={(e) => setShuffleN(Number(e.currentTarget.value))} aria-label="Anzahl Teams">
                  {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} Teams</option>)}
                </select>
                <Btn size="sm" icon="dice" onClick={() => act.lobby.teamShuffle(shuffleN)}>Zufällig verteilen</Btn>
                {lobby.teams.length > 0 && <Btn size="sm" kind="ghost" onClick={() => act.lobby.teamShuffle(0)}>Auflösen</Btn>}
              </span>
            )}
          </div>
        )}
        {!mixed && <p class="muted pad">Modus „Jeder für sich“: Es gibt keine Teams.</p>}

        {lobby.teams.map((t) => <TeamCard key={t.id} team={t} />)}

        {(solo.length > 0 || !lobby.teams.length) && (
          <>
            {lobby.teams.length > 0 && <div class="label sub">Allein</div>}
            <ul class="member-list">
              {solo.map((m) => <MemberRow key={m.id} m={m} />)}
              {!players.length && <li class="muted pad">Noch kein Spieler da. Schick den Code herum.</li>}
            </ul>
          </>
        )}

        {spectators.length > 0 && (
          <>
            <div class="label sub">Zuschauer</div>
            <ul class="member-list">{spectators.map((m) => <MemberRow key={m.id} m={m} />)}</ul>
          </>
        )}
      </div>
    </section>
  );
}

// ---------- moderator: packs ----------

function CatsModal({ packId }) {
  const pack = getPack(packId);
  const sel = draft.selection[packId];
  const stats = packStats(pack);
  const all = stats.cats.filter((c) => c.playable).map((c) => c.id);
  const chosen = new Set(sel?.cats ?? all);
  const set = (next) => act.setPackCats(packId, next.size === all.length ? null : [...next]);
  return (
    <Modal title={`${pack.icon} ${pack.name}: Kategorien`} footer={<><Btn onClick={() => set(new Set(all))}>Alle</Btn><Btn onClick={() => set(new Set())}>Keine</Btn><span class="grow" /><Btn kind="primary" onClick={closeModal}>Fertig</Btn></>}>
      <p class="muted">Nur angehakte Kategorien landen auf dem Board.</p>
      <ul class="check-list">
        {stats.cats.map((c) => (
          <li key={c.id}>
            <label class={c.playable ? '' : 'disabled'}>
              <input
                type="checkbox"
                disabled={!c.playable}
                checked={c.playable && chosen.has(c.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.currentTarget.checked) next.add(c.id);
                  else next.delete(c.id);
                  set(next);
                }}
              />
              <span>{c.name}</span>
              <small class="muted">{c.playable ? `${c.active} Fragen` : 'nicht spielbar: braucht je eine Frage für 100 bis 500'}</small>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PackPicker() {
  const [q, setQ] = useState('');
  const packs = allPacks().filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.desc?.toLowerCase().includes(q.toLowerCase()));
  const s = S.lobby.settings;
  const need = s.rounds * s.cols;
  const capacity = selectionCapacity(draft.selection);
  const chosen = Object.values(draft.selection).filter((x) => x.on).length;
  return (
    <div class="packpicker">
      <div class="toolbar">
        <label class="search">
          <Icon name="search" size={16} />
          <input value={q} placeholder="Paket suchen" onInput={(e) => setQ(e.currentTarget.value)} />
        </label>
        <Btn size="sm" icon="edit" onClick={() => go('packs')}>Pakete bearbeiten</Btn>
      </div>
      <div class="pack-grid">
        {packs.map((p) => {
          const sel = draft.selection[p.id];
          const st = packStats(p);
          const on = !!sel?.on;
          const partial = on && sel.cats;
          return (
            <div key={p.id} class={`pack-card ${on ? 'on' : ''}`} style={{ '--c': p.color }}>
              <button type="button" class="pack-main" onClick={() => act.togglePack(p.id)} aria-pressed={on}>
                <span class="pack-icon">{p.icon}</span>
                <span class="pack-text">
                  <strong>{p.name}</strong>
                  <small>{st.active} Fragen · {partial ? `${sel.cats.length} von ${st.playable}` : st.playable} Kategorien{p.builtin ? '' : ' · eigenes Paket'}</small>
                </span>
                <span class="pack-check">{on && <Icon name="check" size={16} />}</span>
              </button>
              {on && <button type="button" class="pack-cats" onClick={() => openModal({ type: 'cats', packId: p.id })}>Kategorien wählen</button>}
            </div>
          );
        })}
      </div>
      <p class={`capacity ${chosen && capacity < need ? 'warn' : ''}`}>
        {chosen === 0
          ? 'Wähle die Themen für diese Runde.'
          : capacity >= need
            ? `${chosen} ${chosen === 1 ? 'Paket' : 'Pakete'} gewählt. Das reicht für ${capacity} verschiedene Spalten, gebraucht werden ${need}.`
            : `Die Auswahl hat nur ${capacity} spielbare Kategorien, gebraucht werden ${need}. Kategorien wiederholen sich dann mit anderen Fragen.`}
      </p>
    </div>
  );
}

// ---------- moderator: rules ----------

function Rules({ readOnly }) {
  const s = S.lobby.settings;
  const set = (patch) => act.lobby.settings(patch);
  const num = (key, min, max) => (e) => {
    const n = Math.min(max, Math.max(min, Math.round(Number(e.currentTarget.value)) || 0));
    set({ [key]: n });
  };
  return (
    <div class="rules">
      <div class="rule-group">
        <h3>Wer spielt wie</h3>
        <Field label="Spielmodus" hint={s.mode === 'mixed' ? 'Teams sind freiwillig. Wer in keinem Team ist, spielt allein gegen die anderen.' : 'Alle spielen allein, Teams gibt es nicht.'}>
          <Seg value={s.mode} disabled={readOnly} onChange={(mode) => set({ mode })} options={[{ value: 'mixed', label: 'Teams und Einzelspieler' }, { value: 'solo', label: 'Jeder für sich' }]} />
        </Field>
        {s.mode === 'mixed' && <Toggle checked={s.teamsLocked} disabled={readOnly} onChange={(v) => set({ teamsLocked: v })} label="Nur der Moderator teilt Teams ein" />}
        <Field label="Maximale Spielerzahl" row>
          <input type="number" min="1" max="20" value={s.maxPlayers} disabled={readOnly} onChange={num('maxPlayers', 1, 20)} />
        </Field>
      </div>

      <div class="rule-group">
        <h3>Board</h3>
        <Field label="Runden" row>
          <Seg value={s.rounds} disabled={readOnly} onChange={(rounds) => set({ rounds })} options={[{ value: 1, label: '1 Runde' }, { value: 2, label: '2 Runden' }]} />
        </Field>
        <Field label="Kategorien pro Runde" row>
          <Seg value={s.cols} disabled={readOnly} onChange={(cols) => set({ cols })} options={[3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
        <Toggle checked={s.dailyDoubles} disabled={readOnly} onChange={(v) => set({ dailyDoubles: v })} label="Risiko-Felder" hint="Versteckte Felder, bei denen man allein antwortet und selbst setzt (Daily Double)" />
        <Toggle checked={s.final} disabled={readOnly} onChange={(v) => set({ final: v })} label="Finale" hint="Letzte Frage mit geheimem Einsatz und getippter Antwort" />
      </div>

      <div class="rule-group">
        <h3>Buzzer und Wertung</h3>
        <Field label="Buzzer werden frei" hint={{ manual: 'Der Moderator gibt sie frei, wenn er fertig vorgelesen hat.', auto: 'Automatisch nach einer Lesezeit, die sich nach der Textlänge richtet.', instant: 'Sofort, sobald die Frage erscheint.' }[s.buzzMode]}>
          <Seg value={s.buzzMode} disabled={readOnly} onChange={(buzzMode) => set({ buzzMode })} options={[{ value: 'manual', label: 'Durch Moderator' }, { value: 'auto', label: 'Nach Lesezeit' }, { value: 'instant', label: 'Sofort' }]} />
        </Field>
        <Field label="Zeit zum Buzzern" hint="0 = kein Limit, der Moderator löst auf" row>
          <span class="unit"><input type="number" min="0" max="120" value={s.buzzTime} disabled={readOnly} onChange={num('buzzTime', 0, 120)} /> s</span>
        </Field>
        <Field label="Zeit zum Antworten" hint="Nur eine Anzeige. Der Moderator entscheidet." row>
          <span class="unit"><input type="number" min="0" max="120" value={s.answerTime} disabled={readOnly} onChange={num('answerTime', 0, 120)} /> s</span>
        </Field>
        {s.final && (
          <Field label="Zeit im Finale" row>
            <span class="unit"><input type="number" min="0" max="300" value={s.finalTime} disabled={readOnly} onChange={num('finalTime', 0, 300)} /> s</span>
          </Field>
        )}
        <Toggle checked={s.negative} disabled={readOnly} onChange={(v) => set({ negative: v })} label="Falsche Antworten kosten Punkte" />
        <Toggle checked={s.rebuzz} disabled={readOnly} onChange={(v) => set({ rebuzz: v })} label="Nach einer falschen Antwort dürfen andere buzzern" />
        {s.mode === 'mixed' && <Toggle checked={s.teamLockout} disabled={readOnly} onChange={(v) => set({ teamLockout: v })} label="Falsche Antwort sperrt das ganze Team für diese Frage" />}
      </div>

      <div class="rule-group">
        <h3>Fairness</h3>
        <Toggle
          checked={s.anticheat}
          disabled={readOnly}
          onChange={(v) => set({ anticheat: v })}
          label="Anti-Cheat"
          hint="Der Moderator sieht während der Runde live, welche Fenster und Programme bei jedem Spieler offen sind, und bekommt danach ein Protokoll. Jeder Spieler muss vorher zustimmen."
        />
      </div>
    </div>
  );
}

// ---------- moderator: presets ----------

function Presets() {
  const [name, setName] = useState('');
  const list = act.presets();
  return (
    <div class="presets">
      <p class="muted">Eine Voreinstellung merkt sich alle Regeln und die gewählten Pakete samt Kategorien.</p>
      <div class="toolbar">
        <input value={name} maxLength={30} placeholder="Name, z. B. Freitagsrunde" onInput={(e) => setName(e.currentTarget.value)} />
        <Btn
          kind="primary"
          icon="save"
          disabled={!name.trim()}
          onClick={() => {
            act.savePreset(name.trim());
            setName('');
          }}
        >
          Aktuelle Einstellungen speichern
        </Btn>
      </div>
      {list.length === 0 ? (
        <Empty icon="save" title="Noch nichts gespeichert" />
      ) : (
        <ul class="preset-list">
          {list.map((p) => {
            const packs = allPacks().filter((x) => p.selection[x.id]?.on);
            return (
              <li key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small class="muted">
                    {p.settings.rounds} {p.settings.rounds === 1 ? 'Runde' : 'Runden'} · {p.settings.cols} Kategorien · {p.settings.mode === 'solo' ? 'jeder für sich' : 'Teams möglich'}
                    {p.settings.anticheat ? ' · Anti-Cheat' : ''} · {packs.map((x) => x.name).join(', ') || 'keine Pakete'}
                  </small>
                </div>
                <Btn onClick={() => act.loadPreset(p.id)}>Laden</Btn>
                <Btn icon="trash" kind="ghost" onClick={() => act.deletePreset(p.id)} aria-label="Löschen" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- board preview ----------

export function BoardPreview() {
  const [ri, setRi] = useState(0);
  const board = draft.board ?? act.makeBoard();
  if (!board) {
    return (
      <Modal title="Board">
        <Empty icon="warn" title="Kein Board möglich">Wähle mindestens ein Paket mit einer spielbaren Kategorie.</Empty>
      </Modal>
    );
  }
  const round = board.rounds[Math.min(ri, board.rounds.length - 1)];
  const sel = draft.selection;
  return (
    <Modal
      title="Board für diese Runde"
      wide
      footer={
        <>
          <Btn icon="dice" onClick={() => act.makeBoard()}>Alles neu würfeln</Btn>
          <span class="muted">Nur du siehst diese Vorschau. Klick auf eine Frage tauscht sie aus.</span>
          <span class="grow" />
          <Btn onClick={closeModal}>Schließen</Btn>
          <Btn kind="primary" icon="play" onClick={act.startGame}>Spiel starten</Btn>
        </>
      }
    >
      {board.rounds.length > 1 && <Seg value={ri} onChange={setRi} options={board.rounds.map((_, i) => ({ value: i, label: `Runde ${i + 1}` }))} />}
      <div class="preview-grid" style={{ '--cols': round.cats.length }}>
        {round.cats.map((cat, ci) => (
          <div class="preview-col" key={ci}>
            <header>
              <strong>{cat.title}</strong>
              <small>{cat.icon} {cat.pack}</small>
              <Btn size="sm" icon="dice" kind="ghost" onClick={() => act.setBoard(rerollColumn(board, ri, ci, sel))} title="Andere Kategorie" aria-label="Andere Kategorie" />
            </header>
            {cat.clues.map((k, ki) => (
              <button type="button" class="preview-clue" key={ki} onClick={() => act.setBoard(rerollClue(board, ri, ci, ki, sel))} title="Klicken für eine andere Frage">
                <span class="pv-val">{(ki + 1) * 100 * (ri + 1)}</span>
                {k.img && <img src={imageSrc(k.img)} alt="" />}
                <span class="pv-q">{k.q}</span>
                <span class="pv-a">{k.a}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {board.final && (
        <div class="preview-final">
          <span class="label">Finale</span>
          <strong>{board.final.category}</strong>
          <span class="pv-q">{board.final.q}</span>
          <span class="pv-a">{board.final.a}</span>
          <Btn size="sm" icon="dice" kind="ghost" onClick={() => act.setBoard(rerollFinal(board, sel))} aria-label="Andere Finalfrage" />
        </div>
      )}
    </Modal>
  );
}

// ---------- anti-cheat consent ----------

export function ConsentModal() {
  return (
    <Modal
      title="Anti-Cheat in dieser Lobby"
      locked
      footer={
        <>
          <Btn onClick={() => act.lobby.consent(false)}>Ablehnen und zuschauen</Btn>
          <span class="grow" />
          <Btn kind="primary" icon="shield" onClick={() => act.lobby.consent(true)}>Zustimmen und mitspielen</Btn>
        </>
      }
    >
      <p>Der Moderator hat Anti-Cheat eingeschaltet, damit niemand während einer Frage nachschlägt.</p>
      <ul class="plain-list">
        <li><Icon name="monitor" size={16} /><span><b>Was übertragen wird:</b> die Titel deiner offenen Fenster, die Namen der Programme dazu, ob du das Spielfenster verlässt und wie viele Bildschirme angeschlossen sind.</span></li>
        <li><Icon name="clock" size={16} /><span><b>Wann:</b> nur während einer laufenden Runde. In der Lobby und nach dem Spiel wird nichts gesendet.</span></li>
        <li><Icon name="eye" size={16} /><span><b>Wer es sieht:</b> nur der Moderator dieser Lobby, live und als Protokoll nach der Runde.</span></li>
        <li><Icon name="x" size={16} /><span><b>Was nicht übertragen wird:</b> Bildschirminhalte, Tastatureingaben, Dateien oder dein Verlauf.</span></li>
      </ul>
      <p class="muted">Tipp: Schließe vorher private Fenster. Auch deren Titel wären sichtbar.</p>
    </Modal>
  );
}

// ---------- lobby screen ----------

function Summary() {
  const s = S.lobby.settings;
  const rows = [
    ['Modus', s.mode === 'mixed' ? 'Teams und Einzelspieler gemischt' : 'Jeder für sich'],
    ['Board', `${s.rounds} ${s.rounds === 1 ? 'Runde' : 'Runden'} mit ${s.cols} Kategorien`],
    ['Risiko-Felder', s.dailyDoubles ? 'an' : 'aus'],
    ['Finale', s.final ? 'an' : 'aus'],
    ['Falsche Antwort', s.negative ? 'kostet Punkte' : 'kostet nichts'],
    ['Buzzer', { manual: 'gibt der Moderator frei', auto: 'öffnen nach Lesezeit', instant: 'sofort offen' }[s.buzzMode]],
    ['Anti-Cheat', s.anticheat ? 'an' : 'aus'],
  ];
  return (
    <div class="summary">
      <h3>Themen dieser Runde</h3>
      {s.packs.length ? (
        <ul class="chip-list">{s.packs.map((p) => <li key={p.id} class="chip">{p.icon} {p.name}</li>)}</ul>
      ) : (
        <p class="muted">Der Moderator hat noch keine Pakete gewählt.</p>
      )}
      <h3>Regeln</h3>
      <dl class="kv">{rows.map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl>
      <p class="waiting"><span class="pulse" />Warte auf den Moderator …</p>
    </div>
  );
}

export function LobbyView() {
  const [tab, setTab] = useState('packs');
  const mod = isMod();
  const lobby = S.lobby;
  const players = lobby.members.filter((m) => m.role === 'player');
  const chosen = Object.values(draft.selection).filter((x) => x.on).length;
  const acOpen = lobby.settings.anticheat ? players.filter((m) => m.ac === 'pending' || m.ac === 'declined') : [];
  const ended = S.game?.phase === 'ended';
  return (
    <div class="lobby">
      <People />
      <section class="panel config">
        {mod ? (
          <>
            <header class="panel-head tabs">
              <Seg value={tab} onChange={setTab} options={[{ value: 'packs', label: `Pakete${chosen ? ` (${chosen})` : ''}` }, { value: 'rules', label: 'Regeln' }, { value: 'presets', label: 'Voreinstellungen' }]} />
            </header>
            <div class="panel-body scroll">
              {tab === 'packs' && <PackPicker />}
              {tab === 'rules' && <Rules />}
              {tab === 'presets' && <Presets />}
            </div>
            <footer class="panel-foot">
              <div class="start-note">
                {!players.length ? 'Es fehlt noch mindestens ein Spieler.' : !chosen ? 'Wähle mindestens ein Paket.' : acOpen.length ? `Anti-Cheat: Zustimmung fehlt von ${acOpen.map((m) => m.name).join(', ')}.` : `${players.length} Spieler, ${lobby.entities.length} ${lobby.entities.length === 1 ? 'Wertung' : 'Wertungen'} auf dem Board.`}
              </div>
              <Btn icon="eye" disabled={!chosen} onClick={() => openModal({ type: 'preview' })}>Board ansehen</Btn>
              <Btn kind="primary" size="lg" icon="play" disabled={!players.length || !chosen || acOpen.length > 0} onClick={act.startGame}>{ended ? 'Neue Runde starten' : 'Spiel starten'}</Btn>
            </footer>
          </>
        ) : (
          <>
            <header class="panel-head"><h2>Diese Runde</h2></header>
            <div class="panel-body scroll"><Summary /></div>
          </>
        )}
      </section>
    </div>
  );
}

export { CatsModal };
