import { useEffect, useRef } from 'preact/hooks';
import { S, emit, openModal, isMod, member } from '../store.js';
import * as rtc from '../rtc.js';
import * as act from '../actions.js';
import { Avatar, Btn, Icon, Modal, Slider, fmtScore, Field } from './common.jsx';

function CamVideo({ id, on }) {
  const ref = useRef(null);
  const self = id === S.conn.id;
  useEffect(() => {
    const apply = () => {
      const el = ref.current;
      if (!el) return;
      const stream = on ? (self ? rtc.localVideo() : rtc.remoteVideo(id)) : null;
      if (el.srcObject !== stream) el.srcObject = stream;
    };
    apply();
    return rtc.onVideoChange(apply);
  }, [id, on, self]);
  if (!on) return null;
  return <video ref={ref} class={`cam-video ${self && S.settings.video.mirror ? 'mirror' : ''}`} autoplay muted playsInline />;
}

export function CamTile({ m, big }) {
  const g = S.game;
  const self = m.id === S.conn.id;
  const camOn = self ? S.voice.cam : !!m.voice?.cam && m.connected;
  const muted = self ? S.voice.muted : m.voice?.muted;
  const deaf = self ? S.voice.deaf : m.voice?.deaf;
  const answering = g?.cur?.answerers?.[0] === m.id && (g.phase === 'answering' || g.phase === 'dd_answer');
  const locked = g?.cur && m.role === 'player' && ['buzz_open', 'answering'].includes(g.phase) && (g.cur.lockedPl.includes(m.id) || g.cur.lockedEnt.includes(S.lobby.entities.find((e) => e.members.includes(m.id))?.id));
  const cls = ['cam', big ? 'big' : '', self ? 'self' : '', m.connected ? '' : 'gone', answering ? 'answering' : '', locked ? 'locked' : '', m.role === 'mod' ? 'is-mod' : ''].join(' ');
  return (
    <button type="button" class={cls} data-pid={m.id} style={{ '--c': m.color }} onClick={() => openModal({ type: 'user', id: m.id })} title={`${m.name}${self ? ' (du)' : ''}`}>
      <span class="cam-view">
        <CamVideo id={m.id} on={camOn} />
        {!camOn && <Avatar name={m.name} color={m.color} size={big ? 'xl' : 'lg'} />}
        <span class="cam-flags">
          {m.role === 'mod' && <span class="flag-mod" title="Moderator"><Icon name="crown" size={13} /></span>}
          {(muted || m.forceMuted) && <span class="flag-bad" title="Stumm"><Icon name="micOff" size={13} /></span>}
          {deaf && <span class="flag-bad" title="Hört nichts"><Icon name="earOff" size={13} /></span>}
          {!m.connected && <span class="flag-bad" title="Getrennt"><Icon name="warn" size={13} /></span>}
        </span>
      </span>
      <span class="cam-name">{m.name}</span>
    </button>
  );
}

function EntityPod({ e }) {
  const g = S.game;
  const members = e.members.map((id) => member(id)).filter(Boolean);
  const chooser = g?.chooser === e.id && g.phase === 'board';
  const score = g ? g.scores[e.id] ?? 0 : null;
  const mine = S.you?.entity === e.id;
  return (
    <div class={`pod ${e.kind} ${chooser ? 'chooser' : ''} ${mine ? 'mine' : ''} ${g?.cur?.winnerEnt === e.id && g.phase === 'reveal' ? 'won' : ''}`} style={{ '--c': e.color }}>
      {e.kind === 'team' && <div class="pod-team">{e.name}</div>}
      <div class="pod-cams">
        {members.map((m) => <CamTile key={m.id} m={m} />)}
        {!members.length && <span class="pod-empty">leer</span>}
      </div>
      {score !== null && <div class={`pod-score ${score < 0 ? 'neg' : ''}`}>{fmtScore(score)}</div>}
      {chooser && <div class="pod-turn">wählt</div>}
    </div>
  );
}

export function Podium() {
  const lobby = S.lobby;
  const mod = member(lobby.modId);
  const spectators = lobby.members.filter((m) => m.role === 'spectator');
  const players = lobby.members.filter((m) => m.role === 'player').length;
  const size = players <= 6 ? 'n-s' : players <= 10 ? 'n-m' : 'n-l';
  return (
    <div class={`podium ${size}`}>
      {mod && (
        <div class="pod mod-pod">
          <div class="pod-cams"><CamTile m={mod} /></div>
          <div class="pod-score label">Moderator</div>
        </div>
      )}
      <div class="pod-list">
        {lobby.entities.map((e) => <EntityPod key={e.id} e={e} />)}
        {!lobby.entities.length && <span class="pod-hint">Noch keine Spieler</span>}
      </div>
      {spectators.length > 0 && (
        <div class="pod-spec" title={spectators.map((m) => m.name).join(', ')}>
          <Icon name="eye" size={15} />
          <span>{spectators.length}</span>
        </div>
      )}
    </div>
  );
}

export function VoiceBar() {
  const v = S.voice;
  const me = member(S.conn.id);
  const ptt = S.settings.audio.mode === 'ptt';
  return (
    <div class="voicebar">
      <Btn
        icon={v.muted || v.micError ? 'micOff' : 'mic'}
        class={`round ${v.muted ? 'off' : ''} ${v.micError ? 'err' : ''}`}
        onClick={() => (v.micError ? openModal({ type: 'settings', tab: 'audio' }) : rtc.setMuted(!v.muted))}
        title={v.micError || (v.muted ? 'Mikrofon einschalten' : 'Mikrofon stummschalten')}
        aria-label="Mikrofon"
      />
      <Btn icon={v.deaf ? 'earOff' : 'ear'} class={`round ${v.deaf ? 'off' : ''}`} onClick={() => rtc.setDeaf(!v.deaf)} title={v.deaf ? 'Ton wieder an' : 'Alle stummschalten'} aria-label="Ton" />
      <Btn icon={v.cam ? 'cam' : 'camOff'} class={`round ${v.cam ? 'on' : ''}`} onClick={() => rtc.setCam(!v.cam)} title={v.cam ? 'Kamera ausschalten' : 'Kamera einschalten'} aria-label="Kamera" />
      <Btn icon="gear" class="round" onClick={() => openModal({ type: 'settings', tab: 'audio' })} title="Sprach- und Kamera-Einstellungen" aria-label="Einstellungen" />
      <div class="voicebar-note">
        {v.micError ? <span class="bad">Kein Mikrofon</span> : me?.forceMuted ? <span class="bad">Vom Moderator stummgeschaltet</span> : ptt ? <span>Push-to-talk: {keyLabel(S.settings.audio.pttKey)}</span> : <span>Sprachkanal: alle</span>}
      </div>
    </div>
  );
}

export function keyLabel(code) {
  if (!code) return '—';
  if (code === 'Space') return 'Leertaste';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { ControlLeft: 'Strg links', ControlRight: 'Strg rechts', ShiftLeft: 'Umschalt links', ShiftRight: 'Umschalt rechts', AltLeft: 'Alt links', AltRight: 'Alt Gr', Enter: 'Eingabe', Backquote: '^', CapsLock: 'Feststelltaste', Tab: 'Tab' };
  return map[code] ?? code;
}

/** Per-user popup: own volume for this person, and moderator actions. */
export function UserModal({ id }) {
  const m = member(id);
  if (!m) return null;
  const self = id === S.conn.id;
  const a = S.settings.audio;
  const vol = a.userVol[m.name] ?? 100;
  const mod = isMod();
  const inGame = !!S.game && S.game.phase !== 'ended';
  const teams = S.lobby.teams;
  return (
    <Modal title={m.name}>
      <div class="user-head">
        <Avatar name={m.name} color={m.color} size="xl" />
        <div>
          <div class="tagrow">
            <span class="tag">{m.role === 'mod' ? 'Moderator' : m.role === 'player' ? 'Spieler' : 'Zuschauer'}</span>
            <span class="tag">{m.client === 'desktop' ? 'App' : 'Browser'}</span>
            {m.connected ? <span class="tag">{m.ping} ms</span> : <span class="tag warn">getrennt</span>}
          </div>
          {S.voice.peers[id] && !self && <small class="muted">Sprachverbindung: {{ connected: 'steht', connecting: 'wird aufgebaut', new: 'wird aufgebaut', failed: 'fehlgeschlagen', disconnected: 'unterbrochen' }[S.voice.peers[id]] ?? S.voice.peers[id]}</small>}
        </div>
      </div>
      {!self && (
        <Field label="Lautstärke für dich" hint="Nur du hörst diese Person leiser oder lauter">
          <Slider
            value={vol}
            onChange={(v) => {
              a.userVol = { ...a.userVol, [m.name]: v };
              act.saveSettings();
              rtc.applyVolumes();
            }}
          />
        </Field>
      )}
      {mod && !self && (
        <div class="btnrow wrap">
          <Btn icon={m.forceMuted ? 'mic' : 'micOff'} onClick={() => act.lobby.mute(id, !m.forceMuted)}>{m.forceMuted ? 'Stummschaltung aufheben' : 'Für alle stummschalten'}</Btn>
          {m.role === 'player' && <Btn icon="eye" onClick={() => act.lobby.role(id, 'spectator')}>Zum Zuschauer machen</Btn>}
          {m.role === 'spectator' && <Btn icon="user" onClick={() => act.lobby.role(id, 'player')}>Zum Spieler machen</Btn>}
          {!inGame && <Btn icon="crown" onClick={() => act.lobby.transferMod(id)}>Moderation übergeben</Btn>}
          <Btn icon="exit" kind="danger" onClick={() => act.lobby.kick(id)}>Entfernen</Btn>
        </div>
      )}
      {mod && m.role === 'player' && S.lobby.settings.mode === 'mixed' && teams.length > 0 && (
        <Field label="Team">
          <select value={m.teamId ?? ''} onChange={(e) => act.lobby.teamAssign(id, e.currentTarget.value || null)}>
            <option value="">Kein Team (spielt allein)</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}
