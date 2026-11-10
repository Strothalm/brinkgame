import { useEffect, useState } from 'preact/hooks';
import { S, go, toast, emit, openModal, closeModal } from '../store.js';
import { probeServer, parseServer } from '../net.js';
import * as act from '../actions.js';
import { Btn, Icon, Logo, Field, Toggle, Modal, Empty } from './common.jsx';

export const THEMES = [
  { id: 'neon', name: 'Neon', desc: 'Dunkel, Leuchtkanten, scharfe Ecken' },
  { id: 'studio', name: 'Studio', desc: 'Abendshow in Blau und Gold' },
  { id: 'papier', name: 'Papier', desc: 'Hell, ruhig, wie gedruckt' },
  { id: 'arcade', name: 'Arcade', desc: 'Pixel, Scanlines, Spielhalle' },
];

export function ThemeSwitch({ compact }) {
  return (
    <div class={`theme-switch ${compact ? 'compact' : ''}`}>
      {THEMES.map((t) => (
        <button
          type="button"
          key={t.id}
          class={`theme-chip ${S.settings.theme === t.id ? 'on' : ''}`}
          data-preview={t.id}
          title={t.desc}
          onClick={() => {
            S.settings.theme = t.id;
            act.saveSettings();
          }}
        >
          <span class="theme-swatch" aria-hidden="true"><i /><i /><i /></span>
          <span class="theme-name">{t.name}</span>
          {!compact && <small>{t.desc}</small>}
        </button>
      ))}
    </div>
  );
}

export function Home() {
  const [name, setName] = useState(S.profile.name);
  const start = () => {
    if (!name.trim()) return toast('Gib dir zuerst einen Namen.', 'warn');
    act.setProfileName(name.trim());
    go('servers');
    return undefined;
  };
  return (
    <div class="screen home">
      <div class="home-main">
        <Logo size="xl" />
        <p class="home-tag">Die Quizshow für eure Runde. Einer moderiert, alle buzzern.</p>
        <div class="home-card">
          <label class="home-name">
            <span>Dein Name</span>
            <input
              value={name}
              maxLength={20}
              placeholder="So sehen dich die anderen"
              onInput={(e) => setName(e.currentTarget.value)}
              onBlur={() => act.setProfileName(name.trim())}
              onKeyDown={(e) => e.key === 'Enter' && start()}
              autoFocus
            />
          </label>
          <Btn kind="primary" size="lg" icon="play" onClick={start}>Spielen</Btn>
          <div class="home-row">
            <Btn icon="list" onClick={() => go('packs')}>Fragenpakete</Btn>
            <Btn icon="gear" onClick={() => go('settings')}>Einstellungen</Btn>
          </div>
        </div>
      </div>
      <footer class="home-foot">
        <div>
          <span class="label">Design</span>
          <ThemeSwitch compact />
        </div>
        <div class="home-meta">
          <span>Version {__APP_VERSION__}</span>
          {S.desktop && <button type="button" class="linkish" onClick={() => window.brink.app.quit()}>Beenden</button>}
        </div>
      </footer>
    </div>
  );
}

function ServerRow({ server, status, onConnect, onEdit, busy }) {
  const st = status ?? { state: 'wait' };
  return (
    <li class={`server-row ${st.state}`}>
      <span class={`dot ${st.state}`} />
      <div class="server-info">
        <strong>{server.name || parseServer(server.url)?.label || server.url}</strong>
        <small>
          {parseServer(server.url)?.label ?? 'ungültige Adresse'}
          {st.state === 'ok' && ` · ${st.ms} ms · ${st.info.lobbies} ${st.info.lobbies === 1 ? 'Lobby' : 'Lobbys'} · ${st.info.online} online`}
          {st.state === 'ok' && st.info.needsPassword && ' · Passwort nötig'}
          {st.state === 'bad' && ' · nicht erreichbar'}
          {st.state === 'wait' && ' · prüfe …'}
        </small>
      </div>
      <Btn icon="edit" kind="ghost" onClick={onEdit} aria-label="Bearbeiten" />
      <Btn kind="primary" disabled={busy} onClick={onConnect}>{busy ? 'Verbinde …' : 'Verbinden'}</Btn>
    </li>
  );
}

function ServerForm({ server, onSave, onDelete, onCancel }) {
  const [f, setF] = useState(server ?? { name: '', url: '', password: '' });
  const valid = !!parseServer(f.url);
  return (
    <Modal
      title={server ? 'Server bearbeiten' : 'Server hinzufügen'}
      onClose={onCancel}
      footer={
        <>
          {server && <Btn icon="trash" kind="danger ghost" onClick={onDelete}>Entfernen</Btn>}
          <span class="grow" />
          <Btn onClick={onCancel}>Abbrechen</Btn>
          <Btn kind="primary" disabled={!valid} onClick={() => onSave({ ...f, id: f.id ?? Date.now().toString(36) })}>Speichern</Btn>
        </>
      }
    >
      <Field label="Adresse" hint="Zum Beispiel brink.meinserver.de oder 203.0.113.5:8787">
        <input value={f.url} placeholder="brink.meinserver.de" onInput={(e) => setF({ ...f, url: e.currentTarget.value })} autoFocus />
      </Field>
      <Field label="Name" hint="Nur für deine Liste">
        <input value={f.name} maxLength={30} placeholder="Unser Server" onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </Field>
      <Field label="Server-Passwort" hint="Leer lassen, wenn der Server keins hat">
        <input type="password" value={f.password} onInput={(e) => setF({ ...f, password: e.currentTarget.value })} />
      </Field>
      {f.url && !valid && <p class="form-error">Diese Adresse kann ich nicht lesen.</p>}
    </Modal>
  );
}

export function Servers() {
  const [status, setStatus] = useState({});
  const [edit, setEdit] = useState(null); // null | 'new' | server
  const [busy, setBusy] = useState(null);

  const probeAll = () => {
    for (const s of S.servers) {
      probeServer(s).then((res) => setStatus((prev) => ({ ...prev, [s.id]: res.ok ? { state: 'ok', ...res } : { state: 'bad' } })));
    }
  };
  useEffect(() => {
    probeAll();
    const id = setInterval(probeAll, 10000);
    return () => clearInterval(id);
  }, [S.servers.length]);

  const connect = async (server) => {
    setBusy(server.id);
    await act.connectTo(server);
    setBusy(null);
  };

  return (
    <div class="screen narrow">
      <header class="screen-head">
        <Btn icon="left" kind="ghost" onClick={() => go('home')}>Zurück</Btn>
        <h1>Server wählen</h1>
        <Btn icon="plus" onClick={() => setEdit('new')}>Server hinzufügen</Btn>
      </header>
      {S.servers.length === 0 ? (
        <Empty icon="globe" title="Noch kein Server eingetragen">
          Trage die Adresse eures Brinkgame-Servers ein. Die App bleibt mit ihm verbunden, solange du in einer Lobby oder Runde bist.
        </Empty>
      ) : (
        <ul class="server-list">
          {S.servers.map((s) => (
            <ServerRow key={s.id} server={s} status={status[s.id]} busy={busy === s.id} onConnect={() => connect(s)} onEdit={() => setEdit(s)} />
          ))}
        </ul>
      )}
      {edit && (
        <ServerForm
          server={edit === 'new' ? null : edit}
          onCancel={() => setEdit(null)}
          onDelete={() => {
            act.saveServers(S.servers.filter((s) => s.id !== edit.id));
            setEdit(null);
          }}
          onSave={(server) => {
            const exists = S.servers.some((s) => s.id === server.id);
            act.saveServers(exists ? S.servers.map((s) => (s.id === server.id ? server : s)) : [...S.servers, server]);
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function CreateLobby({ onClose }) {
  const [f, setF] = useState({ name: `Runde von ${S.profile.name}`, isPublic: true, password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await act.createLobby(f);
    setBusy(false);
  };
  return (
    <Modal
      title="Lobby erstellen"
      onClose={onClose}
      footer={
        <>
          <span class="grow" />
          <Btn onClick={onClose}>Abbrechen</Btn>
          <Btn kind="primary" disabled={busy} onClick={submit}>Erstellen</Btn>
        </>
      }
    >
      <p class="muted">Du wirst Moderator dieser Lobby. Die Moderation kannst du später an jemand anderen abgeben.</p>
      <Field label="Name der Lobby">
        <input value={f.name} maxLength={40} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} autoFocus />
      </Field>
      <Toggle checked={f.isPublic} onChange={(v) => setF({ ...f, isPublic: v })} label="In der Lobby-Liste anzeigen" hint="Aus: Beitritt nur mit dem Code" />
      <Field label="Passwort" hint="Optional">
        <input value={f.password} maxLength={40} onInput={(e) => setF({ ...f, password: e.currentTarget.value })} />
      </Field>
    </Modal>
  );
}

function PasswordPrompt({ code, role, onClose }) {
  const [pw, setPw] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = async () => {
    const res = await act.joinLobby(code, pw, role);
    if (res?.error === 'password') setWrong(true);
    else onClose();
  };
  return (
    <Modal title="Passwort der Lobby" onClose={onClose} footer={<><span class="grow" /><Btn onClick={onClose}>Abbrechen</Btn><Btn kind="primary" onClick={submit}>Beitreten</Btn></>}>
      <Field label="Passwort">
        <input type="password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
      </Field>
      {wrong && <p class="form-error">Das Passwort stimmt nicht.</p>}
    </Modal>
  );
}

export function Browser() {
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [ask, setAsk] = useState(null);
  const [asSpectator, setAsSpectator] = useState(false);

  useEffect(() => {
    act.refreshLobbies();
    const id = setInterval(act.refreshLobbies, 4000);
    return () => clearInterval(id);
  }, []);

  const role = asSpectator ? 'spectator' : 'player';
  const join = async (c, hasPassword) => {
    if (hasPassword) return setAsk(c);
    const res = await act.joinLobby(c, '', role);
    if (res?.error === 'password') setAsk(c);
    return undefined;
  };
  const conn = S.conn;

  return (
    <div class="screen narrow">
      <header class="screen-head">
        <Btn icon="left" kind="ghost" onClick={act.leaveServer}>Server wechseln</Btn>
        <h1>{conn.info?.name ?? 'Server'}</h1>
        <span class={`conn-pill ${conn.status}`}><span class="dot ok" />{conn.status === 'online' ? `${conn.ping} ms` : 'Verbinde …'}</span>
      </header>

      <section class="join-bar">
        <div class="join-code">
          <label for="joincode">Mit Code beitreten</label>
          <div class="join-code-row">
            <input
              id="joincode"
              class="code-input"
              value={code}
              maxLength={5}
              placeholder="ABCDE"
              spellcheck={false}
              onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 5 && join(code)}
            />
            <Btn kind="primary" disabled={code.length !== 5} onClick={() => join(code)}>Beitreten</Btn>
          </div>
        </div>
        <div class="join-or">oder</div>
        <Btn kind="primary" size="lg" icon="plus" onClick={() => setCreating(true)}>Lobby erstellen</Btn>
      </section>

      <div class="list-head">
        <h2>Offene Lobbys</h2>
        <Toggle checked={asSpectator} onChange={setAsSpectator} label="Als Zuschauer beitreten" />
        <Btn icon="refresh" kind="ghost" onClick={act.refreshLobbies} aria-label="Aktualisieren" />
      </div>
      {S.lobbyList.length === 0 ? (
        <Empty icon="users" title="Gerade ist keine Lobby offen">Erstelle eine und schick den anderen den Code.</Empty>
      ) : (
        <ul class="lobby-list">
          {S.lobbyList.map((l) => (
            <li key={l.code} class="lobby-row">
              <div class="lobby-row-main">
                <strong>{l.name}</strong>
                <small>
                  Moderator: {l.mod || '—'}
                  {l.packs.length > 0 && ` · ${l.packs.join(', ')}`}
                </small>
              </div>
              {l.hasPassword && <Icon name="lock" size={16} />}
              {l.inGame && <span class="tag warn">Runde läuft</span>}
              <span class="lobby-count"><Icon name="users" size={15} />{l.players}/{l.max}</span>
              <Btn kind="primary" onClick={() => join(l.code, l.hasPassword)}>{l.inGame || asSpectator ? 'Zuschauen' : 'Beitreten'}</Btn>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateLobby onClose={() => setCreating(false)} />}
      {ask && <PasswordPrompt code={ask} role={role} onClose={() => setAsk(null)} />}
    </div>
  );
}
