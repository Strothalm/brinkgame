import { useEffect, useRef, useState } from 'preact/hooks';
import { S, go, emit } from '../store.js';
import * as act from '../actions.js';
import * as rtc from '../rtc.js';
import { sfx } from '../sfx.js';
import { Btn, Field, Toggle, Seg, Slider, Modal } from './common.jsx';
import { ThemeSwitch } from './home.jsx';
import { keyLabel } from './cams.jsx';

function MicMeter() {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const loop = () => {
      if (ref.current) ref.current.style.width = `${Math.round(rtc.micLevel() * 100)}%`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div class="meter"><div class="meter-fill" ref={ref} /></div>;
}

function KeyCapture({ value, onChange }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return undefined;
    S.capturingKey = true;
    const onKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.code !== 'Escape') onChange(ev.code);
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      S.capturingKey = false;
      window.removeEventListener('keydown', onKey, true);
    };
  }, [listening]);
  return <button type="button" class={`keycap ${listening ? 'listening' : ''}`} onClick={() => setListening(true)}>{listening ? 'Taste drücken …' : keyLabel(value)}</button>;
}

function CamPreview() {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream;
    let dead = false;
    const v = S.settings.video;
    navigator.mediaDevices
      ?.getUserMedia({ video: { deviceId: v.device ? { exact: v.device } : undefined, width: { ideal: 640 }, height: { ideal: 360 } } })
      .then((s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (ref.current) ref.current.srcObject = s;
        rtc.refreshDevices();
        return undefined;
      })
      .catch(() => setErr('Die Kamera konnte nicht geöffnet werden.'));
    return () => {
      dead = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [S.settings.video.device]);
  if (err) return <p class="form-error">{err}</p>;
  return <video class={`cam-preview ${S.settings.video.mirror ? 'mirror' : ''}`} ref={ref} autoplay muted playsInline />;
}

function DesignTab() {
  const s = S.settings;
  return (
    <>
      <Field label="Design" hint="Wechselt sofort, auch mitten in der Runde. Jeder stellt es für sich ein.">
        <ThemeSwitch />
      </Field>
      <Toggle
        checked={s.sfx}
        onChange={(v) => {
          s.sfx = v;
          act.saveSettings();
        }}
        label="Soundeffekte"
        hint="Buzzer, richtig, falsch, Risiko"
      />
      {s.sfx && (
        <Field label="Lautstärke der Effekte">
          <Slider
            value={s.sfxVolume}
            onChange={(v) => {
              s.sfxVolume = v;
              act.saveSettings();
            }}
          />
          <Btn size="sm" onClick={() => sfx.correct()}>Probe hören</Btn>
        </Field>
      )}
      {S.desktop && (
        <Field label="Fenster" row>
          <Btn icon="monitor" onClick={() => window.brink.app.toggleFullscreen()}>Vollbild umschalten (F11)</Btn>
        </Field>
      )}
    </>
  );
}

function AudioTab() {
  const a = S.settings.audio;
  const dev = S.voice.devices;
  const set = (patch, reopen = false) => {
    Object.assign(a, patch);
    act.saveSettings();
    rtc.applyAudioSettings(reopen);
  };
  useEffect(() => {
    rtc.refreshDevices();
    if (!rtc.voiceActive()) {
      rtc.previewMic(true);
      return () => rtc.previewMic(false);
    }
    return undefined;
  }, []);
  return (
    <>
      {S.voice.micError && <p class="form-error">{S.voice.micError}</p>}
      <div class="rule-group">
        <h3>Mikrofon</h3>
        <Field label="Eingabegerät">
          <select value={a.input} onChange={(e) => set({ input: e.currentTarget.value }, true)}>
            <option value="default">Standardgerät von Windows</option>
            {dev.in.filter((d) => d.id !== 'default' && d.id !== 'communications').map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Pegel" hint="Sprich etwas. Der Balken sollte deutlich ausschlagen.">
          <MicMeter />
        </Field>
        <Field label="Mikrofon-Verstärkung">
          <Slider value={a.inputGain} min={0} max={200} onChange={(v) => set({ inputGain: v })} />
        </Field>
        <Field label="Sprechen" hint={a.mode === 'open' ? 'Dein Mikrofon ist offen, solange du nicht stummschaltest.' : 'Du bist nur zu hören, solange du die Taste hältst.'}>
          <Seg value={a.mode} onChange={(mode) => set({ mode })} options={[{ value: 'open', label: 'Dauerhaft offen' }, { value: 'ptt', label: 'Push-to-talk' }]} />
        </Field>
        {a.mode === 'ptt' && <Field label="Taste für Push-to-talk" row><KeyCapture value={a.pttKey} onChange={(pttKey) => set({ pttKey })} /></Field>}
        <Toggle checked={a.ns} onChange={(v) => set({ ns: v }, true)} label="Rauschunterdrückung" />
        <Toggle checked={a.ec} onChange={(v) => set({ ec: v }, true)} label="Echo-Unterdrückung" hint="Wichtig, wenn du Lautsprecher statt Kopfhörer nutzt" />
        <Toggle checked={a.agc} onChange={(v) => set({ agc: v }, true)} label="Lautstärke automatisch ausgleichen" />
      </div>

      <div class="rule-group">
        <h3>Wiedergabe</h3>
        <Field label="Ausgabegerät">
          <select value={a.output} onChange={(e) => set({ output: e.currentTarget.value })}>
            <option value="default">Standardgerät von Windows</option>
            {dev.out.filter((d) => d.id !== 'default' && d.id !== 'communications').map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Lautstärke des Sprachchats">
          <Slider value={a.master} onChange={(v) => set({ master: v })} />
        </Field>
        <Field label="Lautstärke der anderen, während jemand antworten muss" hint="Alle dürfen weiterreden, sind aber leiser. 100 % heißt: gar nicht leiser. 0 % heißt: stumm. Der Moderator und wer antwortet bleiben immer voll hörbar.">
          <Slider value={a.duck} onChange={(v) => set({ duck: v })} />
        </Field>
        <p class="muted small">Einzelne Personen stellst du leiser, indem du in der Leiste unten auf ihr Bild klickst.</p>
      </div>
    </>
  );
}

function VideoTab() {
  const v = S.settings.video;
  const dev = S.voice.devices;
  useEffect(() => {
    rtc.refreshDevices();
  }, []);
  return (
    <>
      <Field label="Kamera">
        <select
          value={v.device}
          onChange={(e) => {
            v.device = e.currentTarget.value;
            act.saveSettings();
            rtc.applyCamDevice();
          }}
        >
          <option value="">Standardkamera</option>
          {dev.cam.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </Field>
      <Field label="Vorschau">
        <CamPreview />
      </Field>
      <Toggle
        checked={v.mirror}
        onChange={(val) => {
          v.mirror = val;
          act.saveSettings();
        }}
        label="Eigenes Bild spiegeln"
        hint="Nur für dich. Die anderen sehen dich immer richtig herum."
      />
      <p class="muted small">Die Kamera schaltest du in der Leiste unten ein und aus. Bei vielen Spielern senkt Brinkgame die Bildqualität automatisch, damit der Ton stabil bleibt.</p>
    </>
  );
}

function KeysTab() {
  const k = S.settings.keys;
  return (
    <>
      <Field label="Buzzer" hint="Zusätzlich kannst du immer auf den Buzzer klicken." row>
        <KeyCapture
          value={k.buzz}
          onChange={(buzz) => {
            k.buzz = buzz;
            act.saveSettings();
          }}
        />
      </Field>
      <div class="rule-group">
        <h3>Tasten für den Moderator</h3>
        <dl class="kv keys">
          <dt><kbd>B</kbd></dt><dd>Buzzer freigeben</dd>
          <dt><kbd>R</kbd></dt><dd>Antwort ist richtig</dd>
          <dt><kbd>F</kbd></dt><dd>Antwort ist falsch</dd>
          <dt><kbd>A</kbd></dt><dd>Auflösen, niemand bekommt Punkte</dd>
          <dt><kbd>N</kbd></dt><dd>Weiter zum Board oder zur nächsten Runde</dd>
        </dl>
      </div>
    </>
  );
}

const TABS = [
  { value: 'design', label: 'Design' },
  { value: 'audio', label: 'Sprachchat' },
  { value: 'video', label: 'Kamera' },
  { value: 'keys', label: 'Tasten' },
];

function SettingsBody({ tab, setTab }) {
  return (
    <div class="settings">
      <Seg value={tab} onChange={setTab} options={TABS} />
      <div class="settings-body">
        {tab === 'design' && <DesignTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'video' && <VideoTab />}
        {tab === 'keys' && <KeysTab />}
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const [tab, setTab] = useState('design');
  return (
    <div class="screen narrow">
      <header class="screen-head">
        <Btn icon="left" kind="ghost" onClick={() => go(S.lobby ? 'room' : 'home')}>Zurück</Btn>
        <h1>Einstellungen</h1>
        <span />
      </header>
      <SettingsBody tab={tab} setTab={setTab} />
    </div>
  );
}

export function SettingsModal({ tab: initial }) {
  const [tab, setTab] = useState(initial ?? 'design');
  return (
    <Modal title="Einstellungen" wide>
      <SettingsBody tab={tab} setTab={setTab} />
    </Modal>
  );
}
