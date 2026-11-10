// Small synthesized sound effects, no audio files needed.
import { S } from './store.js';

let ctx = null;

function ac() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq, to, type = 'sine', at = 0, dur = 0.15, gain = 0.2 }) {
  if (!S.settings.sfx) return;
  const c = ac();
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  // the arcade theme sounds like an old cabinet
  osc.type = S.settings.theme === 'arcade' && type === 'sine' ? 'square' : type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const vol = gain * (S.settings.sfxVolume / 100) * (osc.type === 'square' || osc.type === 'sawtooth' ? 0.5 : 1);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  pick: () => tone({ freq: 520, to: 780, dur: 0.12, gain: 0.18 }),
  open: () => {
    tone({ freq: 880, dur: 0.09, gain: 0.16 });
    tone({ freq: 1320, at: 0.09, dur: 0.14, gain: 0.16 });
  },
  buzz: () => {
    tone({ freq: 180, type: 'sawtooth', dur: 0.32, gain: 0.3 });
    tone({ freq: 184, type: 'square', dur: 0.32, gain: 0.18 });
  },
  correct: () => {
    tone({ freq: 660, dur: 0.12 });
    tone({ freq: 880, at: 0.11, dur: 0.12 });
    tone({ freq: 1320, at: 0.22, dur: 0.28 });
  },
  wrong: () => {
    tone({ freq: 220, to: 110, type: 'sawtooth', dur: 0.45, gain: 0.26 });
  },
  timeup: () => {
    for (let i = 0; i < 3; i++) tone({ freq: 440, at: i * 0.16, dur: 0.1, gain: 0.2 });
  },
  dd: () => {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone({ freq: f, at: i * 0.1, dur: 0.16, type: 'triangle', gain: 0.22 }));
  },
  reveal: () => tone({ freq: 392, to: 523, dur: 0.22, type: 'triangle', gain: 0.16 }),
  tick: () => tone({ freq: 1000, dur: 0.035, gain: 0.08 }),
  join: () => tone({ freq: 587, to: 880, dur: 0.14, gain: 0.12 }),
  leave: () => tone({ freq: 587, to: 392, dur: 0.16, gain: 0.12 }),
  alert: () => {
    tone({ freq: 740, type: 'square', dur: 0.08, gain: 0.12 });
    tone({ freq: 740, type: 'square', at: 0.14, dur: 0.08, gain: 0.12 });
  },
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, at: i * 0.13, dur: 0.3, type: 'triangle', gain: 0.22 }));
  },
};
