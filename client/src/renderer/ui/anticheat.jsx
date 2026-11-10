import { useState } from 'preact/hooks';
import { S, member, openModal } from '../store.js';
import { downloadFile } from '../packs.js';
import { Btn, Icon, Modal, Empty, Seg } from './common.jsx';

// Window titles and program names that usually mean somebody is looking things up.
const SUSPICIOUS = /(chrome|firefox|edge|msedge|opera|brave|vivaldi|safari|google|bing|duckduckgo|wikipedia|chatgpt|openai|claude|gemini|copilot|perplexity|suche|search|browser|whatsapp web|quizlet|gutefrage)/i;
const HARMLESS = /(brinkgame|discord|spotify|obs|steam|nvidia|explorer|einstellungen|settings|task-manager|taskmgr)/i;

export function isSuspicious(w) {
  const text = `${w.app ?? ''} ${w.title ?? ''}`;
  return SUSPICIOUS.test(text) && !/brinkgame/i.test(text);
}

const time = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const KIND = {
  start: ['Start', 'info'],
  initial: ['Offen', 'info'],
  open: ['Neu geöffnet', 'warn'],
  blur: ['Fenster verlassen', 'warn'],
  switch: ['Gewechselt', 'warn'],
  focus: ['Zurück', 'info'],
  displays: ['Bildschirme', 'info'],
  silent: ['Keine Daten', 'bad'],
  resume: ['Daten wieder da', 'info'],
  disconnect: ['Getrennt', 'bad'],
  reconnect: ['Verbunden', 'info'],
};

function LogLine({ e, showName = true }) {
  const [label, tone] = KIND[e.kind] ?? [e.kind, 'info'];
  const flagged = e.hot && tone !== 'info';
  return (
    <li class={`ac-line ${tone} ${flagged ? 'hot' : ''}`}>
      <time>{time(e.t)}</time>
      {showName && <strong>{e.name}</strong>}
      <span class="ac-kind">{label}</span>
      <span class="ac-text">{e.app && <em>{e.app}</em>}{e.text}</span>
      {e.hot && e.ctx && <span class="ac-ctx" title="Während dieser Frage">{e.ctx}</span>}
    </li>
  );
}

function PlayerLive({ m }) {
  const [open, setOpen] = useState(false);
  const live = S.ac.live[m.id];
  const stale = live && Date.now() - live.at > 12000;
  const flagged = live?.windows.filter(isSuspicious) ?? [];
  let status;
  if (m.ac === 'unsupported') status = ['warn', 'Browser, keine Daten'];
  else if (!m.connected) status = ['bad', 'getrennt'];
  else if (!live) status = ['warn', 'wartet auf Daten'];
  else if (stale) status = ['bad', 'keine Daten mehr'];
  else if (!live.focused) status = ['warn', 'nicht im Spielfenster'];
  else status = ['good', 'im Spiel'];
  return (
    <li class={`ac-player ${status[0]} ${flagged.length ? 'flagged' : ''}`}>
      <button type="button" class="ac-player-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={open ? 'down' : 'right'} size={14} />
        <strong>{m.name}</strong>
        <span class={`tag ${status[0]}`}>{status[1]}</span>
        {live && <span class="muted">{live.windows.length} Fenster{live.displays > 1 ? ` · ${live.displays} Bildschirme` : ''}</span>}
        {flagged.length > 0 && <span class="tag warn"><Icon name="warn" size={12} />{flagged.length} auffällig</span>}
      </button>
      {live && !live.focused && live.fg && <p class="ac-fg">Im Vordergrund: <b>{live.fg.title || live.fg.app}</b></p>}
      {(open || flagged.length > 0) && live && (
        <ul class="ac-windows">
          {(open ? live.windows : flagged).map((w, i) => (
            <li key={i} class={isSuspicious(w) ? 'sus' : HARMLESS.test(`${w.app} ${w.title}`) ? 'ok' : ''}>
              {w.app && <em>{w.app}</em>}
              <span>{w.title || '(ohne Titel)'}</span>
            </li>
          ))}
          {open && !live.windows.length && <li class="muted">Keine weiteren Fenster offen</li>}
        </ul>
      )}
    </li>
  );
}

/** Live view inside the moderator panel. */
export function AnticheatPanel() {
  const players = S.lobby.members.filter((m) => m.role === 'player');
  const recent = S.ac.log.filter((e) => !['initial', 'start'].includes(e.kind)).slice(-12).reverse();
  return (
    <div class="ac">
      <p class="muted small">Du siehst die Fenstertitel und Programme der Spieler. Klick auf einen Namen zeigt alle Fenster.</p>
      <ul class="ac-players">{players.map((m) => <PlayerLive key={m.id} m={m} />)}</ul>
      <div class="toolbar">
        <span class="label">Letzte Ereignisse</span>
        <span class="grow" />
        <Btn size="sm" icon="list" onClick={() => openModal({ type: 'aclog' })}>Protokoll</Btn>
      </div>
      {recent.length ? <ul class="ac-log">{recent.map((e, i) => <LogLine key={i} e={e} />)}</ul> : <p class="muted small">Noch nichts Auffälliges.</p>}
    </div>
  );
}

export function logToText(log) {
  const lines = ['Brinkgame Anti-Cheat-Protokoll', `Lobby: ${S.lobby?.name ?? ''}`, `Erstellt: ${new Date().toLocaleString('de-DE')}`, ''];
  for (const e of log) {
    const label = KIND[e.kind]?.[0] ?? e.kind;
    lines.push(`${time(e.t)}  ${e.name.padEnd(20)}  ${label.padEnd(18)}  ${e.app ? `[${e.app}] ` : ''}${e.text}${e.hot && e.ctx ? `   (während: ${e.ctx})` : ''}`);
  }
  return lines.join('\r\n');
}

/** Full protocol, available during and after the round. */
export function AnticheatLog() {
  const [who, setWho] = useState('all');
  const [mode, setMode] = useState('flagged');
  const names = [...new Set(S.ac.log.map((e) => e.name))];
  let log = S.ac.log;
  if (who !== 'all') log = log.filter((e) => e.name === who);
  if (mode === 'flagged') log = log.filter((e) => (e.hot && ['open', 'blur', 'switch'].includes(e.kind)) || ['silent', 'disconnect'].includes(e.kind) || (e.kind === 'initial' && isSuspicious({ app: e.app, title: e.text })));
  const perPlayer = names.map((name) => ({
    name,
    hot: S.ac.log.filter((e) => e.name === name && e.hot && ['open', 'blur', 'switch'].includes(e.kind)).length,
    blur: S.ac.log.filter((e) => e.name === name && e.kind === 'blur').length,
  }));
  return (
    <Modal
      title="Anti-Cheat-Protokoll"
      wide
      footer={
        <>
          <span class="muted">{S.ac.log.length} Einträge insgesamt</span>
          <span class="grow" />
          <Btn icon="download" onClick={() => downloadFile(`brinkgame-protokoll-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, logToText(S.ac.log), 'text/plain')}>Als Datei speichern</Btn>
        </>
      }
    >
      {S.ac.log.length === 0 ? (
        <Empty icon="shield" title="Noch kein Protokoll">Einträge entstehen, sobald eine Runde mit Anti-Cheat läuft.</Empty>
      ) : (
        <>
          <ul class="ac-summary">
            {perPlayer.map((p) => (
              <li key={p.name} class={p.hot ? 'warn' : ''}>
                <strong>{p.name}</strong>
                <span>{p.hot ? `${p.hot} auffällige Ereignisse während einer Frage` : 'nichts Auffälliges während einer Frage'}</span>
                <small class="muted">{p.blur}-mal das Spielfenster verlassen</small>
              </li>
            ))}
          </ul>
          <div class="toolbar">
            <Seg value={mode} onChange={setMode} options={[{ value: 'flagged', label: 'Nur Auffälliges' }, { value: 'all', label: 'Alles' }]} />
            <select value={who} onChange={(e) => setWho(e.currentTarget.value)} aria-label="Spieler filtern">
              <option value="all">Alle Spieler</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {log.length ? <ul class="ac-log full">{log.map((e, i) => <LogLine key={i} e={e} showName={who === 'all'} />)}</ul> : <p class="muted">Keine Einträge für diesen Filter.</p>}
          <p class="muted small">„Auffällig“ heißt nur: Es ist während einer offenen Frage passiert. Ob das Schummeln war, entscheidest du.</p>
        </>
      )}
    </Modal>
  );
}
