import { useEffect, useRef, useState } from 'preact/hooks';
import { S, closeModal, serverNow } from '../store.js';

const ICONS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7',
  micOff: 'M9 9v3a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M8.5 21h7M4 4l16 16',
  ear: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  earOff: 'M4 14v-2a8 8 0 0 1 2.3-5.6M9 4.6A8 8 0 0 1 20 12v2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM17 13v-1h1a2 2 0 0 1 2 2v2M4 4l16 16',
  cam: 'M4 7h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM15 10.5l6-3v9l-6-3',
  camOff: 'M10 7h4a1 1 0 0 1 1 1v3.5l6-3.5v9l-3-1.6M15 15v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2M4 4l16 16',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  exit: 'M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 8l-4 4 4 4M6 12h10',
  crown: 'M4 18h16M4 8l4 4 4-7 4 7 4-4-1.5 8h-13z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  refresh: 'M20 5v5h-5M4 19v-5h5M19.5 10A8 8 0 0 0 5.6 7.5L4 9M4.5 14a8 8 0 0 0 13.9 2.5L20 15',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2.2 2.2L15 10',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.2a3.5 3.5 0 0 1 0 6.6M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0',
  undo: 'M8 5L4 9l4 4M4 9h10a6 6 0 0 1 0 12h-4',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14',
  upload: 'M12 16V5M7.5 9L12 4.5 16.5 9M5 20h14',
  right: 'M9 5l7 7-7 7',
  left: 'M15 5l-7 7 7 7',
  down: 'M5 9l7 7 7-7',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  volume: 'M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  warn: 'M12 4l9.5 16h-19zM12 10v4.5M12 17.5h.01',
  monitor: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 21h8M12 17v4',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  save: 'M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 4v5h7V4M8 20v-6h8v6',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  flag: 'M5 21V4M5 5h11l-2 3.5 2 3.5H5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
};

export function Icon({ name, size = 18, class: cls = '' }) {
  return (
    <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function Btn({ icon, kind = '', size = '', class: cls = '', children, ...rest }) {
  return (
    <button type="button" class={`btn ${kind} ${size} ${cls} ${children ? '' : 'icon-only'}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label class={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="toggle-track"><span class="toggle-thumb" /></span>
      <span class="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Seg({ value, options, onChange, disabled }) {
  return (
    <div class={`seg ${disabled ? 'disabled' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === value} class={o.value === value ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, suffix = '%', disabled }) {
  return (
    <div class="slider">
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={{ '--p': `${((value - min) / (max - min)) * 100}%` }} onInput={(e) => onChange(Number(e.currentTarget.value))} />
      <output>{value}{suffix}</output>
    </div>
  );
}

export function Field({ label, hint, children, row }) {
  return (
    <div class={`field ${row ? 'row' : ''}`}>
      <div class="field-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div class="field-body">{children}</div>
    </div>
  );
}

export function Modal({ title, children, wide, onClose = closeModal, locked, footer }) {
  return (
    <div class="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div class={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <header class="modal-head">
          <h2>{title}</h2>
          {!locked && <Btn icon="x" kind="ghost" onClick={onClose} aria-label="Schließen" />}
        </header>
        <div class="modal-body">{children}</div>
        {footer && <footer class="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Logo({ size = 'md' }) {
  return (
    <div class={`logo ${size}`} aria-label="Brinkgame">
      <span class="logo-mark" aria-hidden="true"><i /><i /><i /><i /></span>
      <span class="logo-word">BRINK<b>GAME</b></span>
    </div>
  );
}

export function Avatar({ name, color, size = '' }) {
  const initials = String(name ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span class={`avatar ${size}`} style={{ '--c': color }}>{initials || '?'}</span>;
}

export function fmtScore(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('de-DE')}`;
}

/** Countdown towards a server timestamp. Returns remaining seconds (float) and a 0..1 fraction. */
export function useCountdown(deadline, totalSec) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => tick((x) => x + 1), 100);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return { left: 0, frac: 0, active: false };
  const left = Math.max(0, (deadline - serverNow()) / 1000);
  return { left, frac: totalSec ? Math.min(1, left / totalSec) : 0, active: true };
}

export function TimerBar({ deadline, total, paused }) {
  const { left, frac, active } = useCountdown(paused ? 0 : deadline, total);
  if (!active) return null;
  return (
    <div class={`timerbar ${left < 3 ? 'low' : ''}`}>
      <div class="timerbar-fill" style={{ width: `${frac * 100}%` }} />
      <span class="timerbar-num">{Math.ceil(left)}</span>
    </div>
  );
}

/** Text input that only commits on blur or Enter (keeps server round trips low). */
export function LazyInput({ value, onCommit, ...rest }) {
  const [v, setV] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    if (ref.current !== value) {
      ref.current = value;
      setV(value);
    }
  }, [value]);
  const commit = () => {
    if (v !== ref.current) {
      ref.current = v;
      onCommit(v);
    }
  };
  return <input value={v} onInput={(e) => setV(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} {...rest} />;
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {S.toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }) {
  return (
    <div class="empty">
      {icon && <Icon name={icon} size={28} />}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
