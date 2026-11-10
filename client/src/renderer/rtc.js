// Voice and camera: a WebRTC mesh with one public channel. Signaling goes through the game server.
import { S, emit, toast } from './store.js';
import { save } from './storage.js';
import { on, send } from './net.js';

const epoch = Math.random().toString(36).slice(2, 10);
const peers = new Map(); // id -> peer
let active = false;
let rawMic = null; // MediaStream from getUserMedia
let micOut = null; // processed track that is sent to peers
let camStream = null;
let audioCtx = null;
let gainNode = null;
let analyser = null;
let meterTimer = null;
let speaking = false;
let speakHold = 0;
let pttDown = false;
let level = 0;
const videoListeners = new Set();

const A = () => S.settings.audio;

// ---------- local media ----------

async function openMic() {
  closeMic();
  S.voice.micError = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    S.voice.micError = 'Mikrofon wird hier nicht unterstützt (nur über HTTPS oder in der App).';
    return;
  }
  const a = A();
  const constraints = {
    audio: {
      deviceId: a.input && a.input !== 'default' ? { exact: a.input } : undefined,
      echoCancellation: a.ec,
      noiseSuppression: a.ns,
      autoGainControl: a.agc,
      channelCount: 1,
    },
  };
  try {
    rawMic = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (constraints.audio.deviceId) {
      // the saved device is gone: fall back to the system default
      try {
        delete constraints.audio.deviceId;
        rawMic = await navigator.mediaDevices.getUserMedia(constraints);
        a.input = 'default';
        save('settings', S.settings);
      } catch (e2) {
        S.voice.micError = micErrorText(e2);
        return;
      }
    } else {
      S.voice.micError = micErrorText(e);
      return;
    }
  }
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const source = audioCtx.createMediaStreamSource(rawMic);
  gainNode = audioCtx.createGain();
  gainNode.gain.value = a.inputGain / 100;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(gainNode);
  gainNode.connect(analyser);
  gainNode.connect(dest);
  micOut = dest.stream.getAudioTracks()[0];
  applyTransmit();
  for (const p of peers.values()) p.audioSender?.replaceTrack(micOut).catch(() => {});
  startMeter();
}

function micErrorText(e) {
  if (e?.name === 'NotAllowedError') return 'Kein Zugriff auf das Mikrofon. Erlaube ihn in den Windows-Datenschutzeinstellungen.';
  if (e?.name === 'NotFoundError') return 'Kein Mikrofon gefunden.';
  if (e?.name === 'NotReadableError') return 'Das Mikrofon wird von einem anderen Programm blockiert.';
  return 'Das Mikrofon konnte nicht geöffnet werden.';
}

function closeMic() {
  clearInterval(meterTimer);
  meterTimer = null;
  rawMic?.getTracks().forEach((t) => t.stop());
  rawMic = null;
  micOut?.stop();
  micOut = null;
  analyser = null;
  gainNode = null;
  level = 0;
}

function transmitting() {
  const me = S.lobby?.members.find((m) => m.id === S.conn.id);
  if (!micOut || S.voice.muted || me?.forceMuted) return false;
  return A().mode === 'open' || pttDown;
}

function applyTransmit() {
  if (micOut) micOut.enabled = transmitting();
}

function startMeter() {
  clearInterval(meterTimer);
  const buf = new Float32Array(512);
  meterTimer = setInterval(() => {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    level = Math.sqrt(sum / buf.length);
    const now = performance.now();
    if (level > 0.018) speakHold = now + 350;
    const next = transmitting() && now < speakHold;
    if (next !== speaking) {
      speaking = next;
      send('voice.speaking', { on: speaking });
      markSpeaking(S.conn.id, speaking);
    }
  }, 60);
}

/** Current microphone level 0..1 for the settings meter. */
export function micLevel() {
  return Math.min(1, level * 6);
}

export function markSpeaking(id, onOff) {
  for (const el of document.querySelectorAll(`[data-pid="${id}"]`)) el.classList.toggle('speaking', onOff);
}

function videoProfile() {
  const n = peers.size;
  if (n <= 3) return { maxBitrate: 350_000, scale: 1, fps: 20 };
  if (n <= 7) return { maxBitrate: 180_000, scale: 2, fps: 15 };
  if (n <= 12) return { maxBitrate: 100_000, scale: 2.67, fps: 12 };
  return { maxBitrate: 60_000, scale: 4, fps: 10 };
}

function tuneSender(p) {
  const sender = p.videoSender;
  if (!sender?.track) return;
  const prof = videoProfile();
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = prof.maxBitrate;
  params.encodings[0].scaleResolutionDownBy = prof.scale;
  params.encodings[0].maxFramerate = prof.fps;
  sender.setParameters(params).catch(() => {});
}

async function openCam() {
  S.voice.camError = '';
  const v = S.settings.video;
  const base = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } };
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { ...base, deviceId: v.device ? { exact: v.device } : undefined } });
  } catch (e) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: base });
    } catch (e2) {
      S.voice.camError = e2?.name === 'NotAllowedError' ? 'Kein Zugriff auf die Kamera.' : e2?.name === 'NotFoundError' ? 'Keine Kamera gefunden.' : 'Die Kamera konnte nicht geöffnet werden.';
      camStream = null;
      return false;
    }
  }
  const track = camStream.getVideoTracks()[0];
  track.onended = () => setCam(false);
  for (const p of peers.values()) {
    await p.videoSender?.replaceTrack(track).catch(() => {});
    tuneSender(p);
  }
  return true;
}

function closeCam() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  for (const p of peers.values()) p.videoSender?.replaceTrack(null).catch(() => {});
}

// ---------- peers ----------

function announce() {
  send('voice.state', { muted: S.voice.muted, deaf: S.voice.deaf, cam: S.voice.cam, epoch });
}

function signal(to, data) {
  send('rtc.signal', { to, data: { ...data, epoch } });
}

function createPeer(id, remoteEpoch, offerer) {
  const pc = new RTCPeerConnection({ iceServers: S.conn.ice });
  const audioEl = new Audio();
  audioEl.autoplay = true;
  const p = { id, pc, epoch: remoteEpoch, offerer, audioEl, video: null, audioSender: null, videoSender: null, queue: [], hasRemote: false, state: 'new' };
  peers.set(id, p);

  pc.onicecandidate = (ev) => ev.candidate && signal(id, { kind: 'ice', candidate: ev.candidate });
  pc.ontrack = (ev) => {
    if (ev.track.kind === 'audio') {
      audioEl.srcObject = new MediaStream([ev.track]);
      applyOutput(p);
      applyVolumes();
      audioEl.play().catch(() => {});
    } else {
      p.video = new MediaStream([ev.track]);
      notifyVideo();
    }
  };
  pc.onconnectionstatechange = () => {
    p.state = pc.connectionState;
    S.voice.peers = { ...S.voice.peers, [id]: p.state };
    emit();
    if (pc.connectionState === 'failed') {
      if (p.offerer) pc.restartIce();
      else signal(id, { kind: 'restart' });
    }
  };
  if (offerer) {
    const at = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const vt = pc.addTransceiver('video', { direction: 'sendrecv' });
    p.audioSender = at.sender;
    p.videoSender = vt.sender;
    if (micOut) at.sender.replaceTrack(micOut).catch(() => {});
    const camTrack = camStream?.getVideoTracks()[0];
    if (camTrack) vt.sender.replaceTrack(camTrack).then(() => tuneSender(p)).catch(() => {});
    pc.onnegotiationneeded = async () => {
      try {
        await pc.setLocalDescription(await pc.createOffer());
        signal(id, { kind: 'offer', sdp: pc.localDescription });
      } catch (e) {
        console.warn('offer failed', e);
      }
    };
  }
  retuneAll();
  return p;
}

function closePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  p.pc.onconnectionstatechange = null;
  p.pc.close();
  p.audioEl.srcObject = null;
  const next = { ...S.voice.peers };
  delete next[id];
  S.voice.peers = next;
  notifyVideo();
  retuneAll();
}

function retuneAll() {
  for (const p of peers.values()) tuneSender(p);
}

async function onSignal({ from, data }) {
  if (!active || !data) return;
  let p = peers.get(from);
  if (data.kind === 'offer') {
    if (p && (p.epoch !== data.epoch || p.offerer)) {
      closePeer(from);
      p = null;
    }
    p ??= createPeer(from, data.epoch, false);
    try {
      await p.pc.setRemoteDescription(data.sdp);
      p.hasRemote = true;
      for (const t of p.pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        t.direction = 'sendrecv';
        if (kind === 'audio') {
          p.audioSender = t.sender;
          if (micOut) await t.sender.replaceTrack(micOut);
        } else {
          p.videoSender = t.sender;
          const camTrack = camStream?.getVideoTracks()[0];
          if (camTrack) await t.sender.replaceTrack(camTrack);
        }
      }
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      signal(from, { kind: 'answer', sdp: p.pc.localDescription });
      tuneSender(p);
      for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
    } catch (e) {
      console.warn('answer failed', e);
    }
  } else if (data.kind === 'answer' && p?.offerer) {
    try {
      await p.pc.setRemoteDescription(data.sdp);
      p.hasRemote = true;
      for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
    } catch (e) {
      console.warn('set answer failed', e);
    }
  } else if (data.kind === 'ice' && p) {
    if (p.hasRemote) p.pc.addIceCandidate(data.candidate).catch(() => {});
    else p.queue.push(data.candidate);
  } else if (data.kind === 'restart' && p?.offerer) {
    p.pc.restartIce();
  }
}

/** Brings the peer connections in line with the lobby member list. */
export function syncPeers() {
  if (!active || !S.lobby) return;
  const me = S.conn.id;
  const wanted = new Map(S.lobby.members.filter((m) => m.id !== me && m.connected).map((m) => [m.id, m]));
  for (const id of [...peers.keys()]) if (!wanted.has(id)) closePeer(id);
  for (const [id, m] of wanted) {
    const remoteEpoch = m.voice?.epoch;
    if (!remoteEpoch) continue; // their voice layer is not up yet
    let p = peers.get(id);
    if (p && p.epoch !== remoteEpoch) {
      closePeer(id);
      p = null;
    }
    // the lexicographically smaller id makes the offer
    if (!p && me < id) createPeer(id, remoteEpoch, true);
  }
  applyTransmit();
  applyVolumes();
}

// ---------- volume ----------

function applyOutput(p) {
  const out = A().output;
  if (p.audioEl.setSinkId) p.audioEl.setSinkId(out && out !== 'default' ? out : '').catch(() => {});
}

/** Who has to answer right now (they stay at full volume, everybody else is turned down). */
export function answeringNow() {
  const g = S.game;
  if (!g || !g.cur) return null;
  if (g.phase === 'answering' || g.phase === 'dd_answer') return g.cur.answerers ?? [];
  return null;
}

export function applyVolumes() {
  const a = A();
  const answerers = answeringNow();
  const modId = S.lobby?.modId;
  for (const p of peers.values()) {
    const m = S.lobby?.members.find((x) => x.id === p.id);
    let v = (a.master / 100) * ((a.userVol[m?.name] ?? 100) / 100);
    if (answerers && !answerers.includes(p.id) && p.id !== modId) v *= a.duck / 100;
    if (m?.forceMuted) v = 0;
    p.audioEl.volume = Math.max(0, Math.min(1, v));
    p.audioEl.muted = S.voice.deaf;
  }
}

// ---------- public controls ----------

export async function startVoice() {
  if (active) return;
  active = true;
  S.voice.ready = false;
  emit();
  await openMic();
  if (!active) return;
  await refreshDevices();
  S.voice.ready = true;
  announce();
  syncPeers();
  emit();
}

export function stopVoice() {
  if (!active) return;
  active = false;
  for (const id of [...peers.keys()]) closePeer(id);
  closeMic();
  closeCam();
  S.voice.cam = false;
  S.voice.ready = false;
  S.voice.peers = {};
  speaking = false;
  emit();
}

export function setMuted(muted) {
  S.voice.muted = muted;
  if (!muted && S.voice.deaf) S.voice.deaf = false;
  applyTransmit();
  applyVolumes();
  announce();
  emit();
}

export function setDeaf(deaf) {
  S.voice.deaf = deaf;
  if (deaf) S.voice.muted = true;
  applyTransmit();
  applyVolumes();
  announce();
  emit();
}

export async function setCam(onOff) {
  if (onOff) {
    const okCam = await openCam();
    S.voice.cam = okCam;
    if (!okCam) toast(S.voice.camError, 'warn');
  } else {
    closeCam();
    S.voice.cam = false;
  }
  announce();
  notifyVideo();
  emit();
}

export function setPtt(down) {
  if (pttDown === down) return;
  pttDown = down;
  applyTransmit();
}

export async function refreshDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const map = (kind) => list.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Gerät ${i + 1}` }));
    S.voice.devices = { in: map('audioinput'), out: map('audiooutput'), cam: map('videoinput') };
    emit();
  } catch { /* ignore */ }
}

/** Call after audio settings changed. */
export async function applyAudioSettings(reopenMic = false) {
  if (gainNode) gainNode.gain.value = A().inputGain / 100;
  if (reopenMic && active) await openMic();
  for (const p of peers.values()) applyOutput(p);
  applyTransmit();
  applyVolumes();
  emit();
}

export async function applyCamDevice() {
  if (S.voice.cam) {
    closeCam();
    await setCam(true);
  }
}

export function localVideo() {
  return camStream;
}

export function remoteVideo(id) {
  return peers.get(id)?.video ?? null;
}

export function onVideoChange(fn) {
  videoListeners.add(fn);
  return () => videoListeners.delete(fn);
}

function notifyVideo() {
  for (const fn of videoListeners) fn();
}

/** Opens the mic only for the settings screen meter when no lobby is active. */
export async function previewMic(onOff) {
  if (active) return;
  if (onOff) {
    await openMic();
    await refreshDevices();
    if (micOut) micOut.enabled = true;
  } else closeMic();
  emit();
}

export function voiceActive() {
  return active;
}

on('rtc.signal', onSignal);
on('voice.state', (msg) => {
  const m = S.lobby?.members.find((x) => x.id === msg.id);
  if (m) {
    m.voice = msg.voice;
    syncPeers();
    emit();
  }
});
on('voice.speaking', (msg) => markSpeaking(msg.id, msg.on));
on('state.applied', () => {
  if (active) {
    syncPeers();
    applyTransmit();
  }
});
on('lobby.left', stopVoice);
on('conn.closed', stopVoice);
navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
