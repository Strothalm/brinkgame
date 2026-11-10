import { useEffect, useRef, useState } from 'preact/hooks';
import { S, isMod, member, openModal, toast } from '../store.js';
import * as act from '../actions.js';
import { Btn, Icon, Logo } from './common.jsx';
import { Podium, VoiceBar } from './cams.jsx';
import { LobbyView } from './lobby.jsx';
import { Stage, ModPanel } from './game.jsx';

function Chat({ onClose }) {
  const [text, setText] = useState('');
  const end = useRef(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [S.chat.length]);
  const submit = () => {
    if (!text.trim()) return;
    act.lobby.chat(text.trim());
    setText('');
  };
  return (
    <div class="chat">
      <header><strong>Chat</strong><Btn icon="x" kind="ghost" size="sm" onClick={onClose} aria-label="Chat schließen" /></header>
      <ul>
        {S.chat.map((c, i) => <li key={i}><b style={{ color: c.color }}>{c.name}</b> {c.text}</li>)}
        {!S.chat.length && <li class="muted">Noch keine Nachrichten.</li>}
        <li ref={end} />
      </ul>
      <div class="chat-input">
        <input value={text} maxLength={300} placeholder="Nachricht" onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <Btn icon="right" kind="primary" onClick={submit} aria-label="Senden" />
      </div>
    </div>
  );
}

function TopBar({ chatOpen, setChatOpen, unread }) {
  const lobby = S.lobby;
  const conn = S.conn;
  const g = S.game;
  const me = member(conn.id);
  const inGame = g && g.phase !== 'ended';
  const copy = () => {
    navigator.clipboard?.writeText(lobby.code).then(() => toast('Code kopiert.', 'good'), () => {});
  };
  return (
    <header class="topbar">
      <Logo size="sm" />
      <div class="topbar-lobby">
        <strong>{lobby.name}</strong>
        <button type="button" class="code-chip" onClick={copy} title="Code kopieren">
          <span class="label">Code</span><b>{lobby.code}</b><Icon name="copy" size={13} />
        </button>
      </div>
      <span class="grow" />
      {S.lobby.settings.anticheat && me?.role === 'player' && me.ac === 'ok' && (
        <span class={`ac-badge ${inGame ? 'live' : ''}`} title={inGame ? 'Der Moderator sieht gerade deine offenen Fenster und Programme.' : 'Während der Runde sieht der Moderator deine offenen Fenster und Programme.'}>
          <Icon name="shield" size={14} />{inGame ? 'Anti-Cheat aktiv' : 'Anti-Cheat bereit'}
        </span>
      )}
      <span class={`conn-pill ${conn.status}`} title="Verbindung zum Server">
        <span class={`dot ${conn.status === 'online' ? (conn.ping > 180 ? 'wait' : 'ok') : 'bad'}`} />
        {conn.status === 'online' ? `${conn.ping} ms` : 'Verbinde neu …'}
      </span>
      <Btn icon="chat" kind="ghost" class={unread ? 'has-dot' : ''} onClick={() => setChatOpen(!chatOpen)} aria-label="Chat" />
      <Btn icon="gear" kind="ghost" onClick={() => openModal({ type: 'settings', tab: 'design' })} aria-label="Einstellungen" />
      <Btn
        icon="exit"
        kind="ghost"
        onClick={() => openModal({
          type: 'confirm',
          title: 'Lobby verlassen?',
          text: isMod() ? 'Du bist Moderator. Wenn du gehst, übernimmt jemand anderes und eine laufende Runde endet.' : inGame ? 'Die Runde läuft noch. Dein Platz wird frei.' : 'Du kannst mit dem Code jederzeit wieder beitreten.',
          yes: 'Verlassen',
          action: act.leaveLobby,
        })}
      >
        Verlassen
      </Btn>
    </header>
  );
}

export function Room() {
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (chatOpen) setSeen(S.chat.length);
  }, [chatOpen, S.chat.length]);
  if (!S.lobby) return <div class="screen center"><p class="stage-note"><span class="pulse" />Verbinde mit der Lobby …</p></div>;
  const g = S.game;
  const playing = !!g;
  const showLobby = !g;
  return (
    <div class={`room ${playing ? 'playing' : 'in-lobby'} ${isMod() && playing ? 'with-mod' : ''}`}>
      <TopBar chatOpen={chatOpen} setChatOpen={setChatOpen} unread={!chatOpen && S.chat.length > seen} />
      {S.conn.status !== 'online' && <div class="reconnect-bar"><span class="pulse" />Verbindung unterbrochen. Brinkgame verbindet sich gerade neu, dein Platz bleibt reserviert.</div>}
      <main class="room-main">
        {showLobby ? <LobbyView /> : <Stage />}
        {playing && isMod() && <ModPanel />}
        {chatOpen && <Chat onClose={() => setChatOpen(false)} />}
      </main>
      <footer class="room-foot">
        <VoiceBar />
        <Podium />
      </footer>
    </div>
  );
}
