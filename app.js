// VampFour — four-bar vamp desk.
// Rules: audio-clock lookahead scheduler, live state, OfflineAudioContext exports on the grid,
// samples pinned to a commit SHA, pitch shift never more than ±4 semitones.

const CDN = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SAMPLE_RATE = 48000;
const STEPS_PER_BAR = 16;
const CHORUS_BARS = 8, VAMP_BARS = 4, TOTAL_BARS = 12;
const MAX_SHIFT = 4;

// ---------- Instruments (each voice is the sample it is named after) ----------
const NOTE = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const nameToMidi = n => { const m = n.match(/^([A-G][b#]?)(\d)$/); return NOTE[m[1]] + 12 * (+m[2] + 1); };
const INSTRUMENTS = {
  piano:   { label: "Piano (FluidR3 acoustic grand)", dir: "piano", lo: 48, hi: 79,
             notes: "C2 E2 G2 A2 Bb2 C3 Db3 E3 Gb3 G3 Ab3 A3 Bb3 C4 Db4 E4 Gb4 G4 A4 Bb4 C5 E5 G5 C6" },
  bass:    { label: "Upright bass", dir: "bass", lo: 28, hi: 52,
             notes: "E1 G1 A1 Bb1 C2 E2 G2 A2 Bb2 C3 E3 G3 A3" },
  nylon:   { label: "Nylon guitar (FluidR3 nylon)", dir: "guitar", lo: 45, hi: 71,
             notes: "A2 B2 D3 E3 G3 A3 B3 D4 E4 G4 A4 B4" },
  trumpet: { label: "Trumpet", dir: "trumpet", lo: 60, hi: 79,
             notes: "G3 A3 C4 E4 G4 A4 C5 E5 G5" },
  violin:  { label: "Violin", dir: "violin", lo: 57, hi: 79, loop: true,
             notes: "G3 A3 C4 E4 G4 A4 C5 E5 G5" },
  kit:     { label: "Acoustic kit", dir: "drums", drums: ["kick", "snare", "hihat", "crash"] }
};
const CHAIRS = ["piano", "bass", "nylon", "trumpet", "violin", "kit"];
const DRUM_NOTE = { kick: 36, snare: 38, hihat: 42, crash: 49 };

function sampleList() {
  const out = [];
  for (const [inst, d] of Object.entries(INSTRUMENTS)) {
    if (d.drums) d.drums.forEach(n => out.push({ inst, id: `${inst}:${n}`, url: `${CDN}/${d.dir}/${n}.mp3`, midi: DRUM_NOTE[n] }));
    else d.notes.split(" ").forEach(n => out.push({ inst, id: `${inst}:${n}`, url: `${CDN}/${d.dir}/${n}.mp3`, midi: nameToMidi(n) }));
  }
  return out;
}
const SAMPLES = sampleList();

// ---------- Chords ----------
const QUAL = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6], sus4: [0, 5, 7], sus2: [0, 2, 7], "6": [0, 4, 7, 9], m6: [0, 3, 7, 9] };
const KEYS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function parseChord(sym) {
  const m = String(sym).trim().match(/^([A-G])([b#]?)(maj7|m7|m6|m|7|dim|sus4|sus2|6)?$/);
  if (!m) return null;
  return { root: NOTE[m[1] + m[2]], q: m[3] || "", minor: /^m(?!aj)/.test(m[3] || "") || m[3] === "dim" };
}
function parseChords(text) {
  const parts = String(text).trim().split(/[\s,|]+/).filter(Boolean);
  if (parts.length !== 4) return null;
  const c = parts.map(parseChord);
  return c.every(Boolean) ? c : null;
}
const spell = pc => KEYS[((pc % 12) + 12) % 12];
const chordName = c => spell(c.root) + c.q;
const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };

const grooves = [
  { id: "amber", name: "Amber Walk", bpm: 96, chords: "Am F C G" },
  { id: "porch", name: "Porch Climb", bpm: 84, chords: "E B C#m A" },
  { id: "fold", name: "Fold Radio", bpm: 108, chords: "Dm Bb F C" }
];
const recipes = [
  { id: "pedal-hold", name: "Pedal hold", blurb: "Bass pedal on the one. Kit half-time. Piano figure on the and." },
  { id: "nylon-vamp", name: "Nylon vamp", blurb: "Nylon figure loops. Hats die. Space for the vocal." },
  { id: "walk-under", name: "Walk under", blurb: "Upright walks the changes. Sparse piano." },
  { id: "string-air", name: "String air", blurb: "Violin swells and holds each bar. Kit on 2 and 4. No crash." },
  { id: "half-pocket", name: "Half pocket", blurb: "Half-time kit. Root and fifth. Then the return." },
  { id: "call-figure", name: "Call figure", blurb: "Trumpet calls once per bar. Nylon answers." },
  { id: "stop-breath", name: "Stop breath", blurb: "Two hits. Two bars of air. The song returns." },
  { id: "bass-pedal", name: "Bass pedal", blurb: "Upright holds the tonic. Everything else thins." }
];

// ---------- State (one mutable object; scheduler reads it every step) ----------
const state = {
  groove: "amber", recipe: "pedal-hold", bpm: 96, key: "A", chordText: "Am F C G",
  mutes: { piano: false, bass: false, nylon: false, trumpet: false, violin: false, kit: false },
  mode: "chorus", exportBars: 4, playing: false
};
const LS = "vampfour.v2";
function persist() {
  localStorage.setItem(LS, JSON.stringify({ groove: state.groove, recipe: state.recipe, bpm: state.bpm, key: state.key, chordText: state.chordText, mutes: state.mutes, exportBars: state.exportBars }));
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || "null");
    if (!s) return;
    if (s.bpm >= 60 && s.bpm <= 180) state.bpm = Math.round(s.bpm);
    if (KEYS.includes(s.key)) state.key = s.key;
    if (parseChords(s.chordText)) state.chordText = s.chordText;
    if (recipes.some(r => r.id === s.recipe)) state.recipe = s.recipe;
    if (s.groove) state.groove = s.groove;
    if (s.mutes) for (const c of CHAIRS) state.mutes[c] = !!s.mutes[c];
    if ([4, 8, 12].includes(s.exportBars)) state.exportBars = s.exportBars;
  } catch {}
}

// Chords as typed, transposed so the first chord's root lands on the selected key.
function currentChords(st = state) {
  const c = parseChords(st.chordText) || parseChords("Am F C G");
  const shift = NOTE[st.key] - c[0].root;
  return c.map(x => ({ ...x, root: ((x.root + shift) % 12 + 12) % 12 }));
}
const keyLabel = (st = state) => st.key + (currentChords(st)[0].minor ? "m" : "");

// ---------- Arrangement: one pure function feeds live playback, WAV and MIDI ----------
// Returns events for step s of bar b (0..11): { chair, midi, gain, beats, swell }
function eventsFor(b, s, st = state) {
  const ch = currentChords(st);
  const vamp = b >= CHORUS_BARS;
  const c = ch[b % 4];
  const next = ch[(b + 1) % 4];
  const tones = QUAL[c.q].map(i => c.root + i);
  const ev = [];
  const add = (chair, midi, gain, beats, swell = false) => ev.push({ chair, midi, gain, beats, swell });
  const bassRoot = fold(36 + c.root, 31, 45);
  const fifth = fold(bassRoot + 7, 31, 50);
  const pianoVoicing = tones.map(t => fold(48 + t, 55, 67)).sort((a, b) => a - b);
  const kit = (n, g, beats = 0.5) => add("kit", DRUM_NOTE[n], g, beats);

  if (!vamp) {
    // Chorus pocket: full band.
    if (s === 0 && b === 0) kit("crash", 0.35, 2);
    if (s === 0 || s === 10) kit("kick", 0.8);
    if (s === 4 || s === 12) kit("snare", 0.55);
    if (s % 2 === 0) kit("hihat", s % 4 === 0 ? 0.22 : 0.14, 0.25);
    if (s === 0 || s === 8) pianoVoicing.forEach(m => add("piano", m, 0.22, 1.8));
    if (s === 0) add("bass", bassRoot, 0.7, 1.9);
    if (s === 8) add("bass", fifth, 0.6, 1.9);
    if (s % 4 === 2) add("nylon", fold(48 + tones[(s >> 2) % tones.length], 52, 67), 0.2, 0.9);
    return ev;
  }
  const vb = b - CHORUS_BARS; // 0..3
  switch (st.recipe) {
    case "pedal-hold": {
      if (s === 0) add("bass", fold(36 + ch[0].root, 31, 45), 0.72, 3.9);
      if (s === 0) kit("kick", 0.7);
      if (s === 8) kit("snare", 0.5);
      if (s % 4 === 0) kit("hihat", 0.16, 0.25);
      if (s % 4 === 2) add("piano", fold(60 + tones[(s >> 2) % tones.length], 64, 76), 0.2, 0.45);
      break;
    }
    case "nylon-vamp": {
      if (s % 2 === 0) add("nylon", fold(48 + tones[(s >> 1) % tones.length] + ((s >> 1) % 4 === 3 ? 12 : 0), 50, 71), 0.24, 0.9);
      if (s === 0) { kit("kick", 0.45); add("bass", bassRoot, 0.6, 1.9); }
      break;
    }
    case "walk-under": {
      if (s % 4 === 0) {
        const q = s >> 2;
        const walk = [bassRoot, fold(bassRoot + (tones[1] - tones[0]), 31, 50), fifth, fold(36 + next.root, 31, 45) - 1];
        add("bass", fold(walk[q], 30, 50), 0.66, 0.95);
        kit("hihat", 0.12, 0.25);
      }
      if (s === 0) { kit("kick", 0.45); pianoVoicing.forEach(m => add("piano", m, 0.16, 1.8)); }
      break;
    }
    case "string-air": {
      if (s === 0) {
        add("violin", fold(60 + tones[1], 62, 74), 0.32, 4, true);
        add("bass", bassRoot, 0.6, 3.9);
        kit("kick", 0.55);
      }
      if (s === 4 || s === 12) kit("snare", 0.45);
      if (s % 4 === 0) kit("hihat", 0.12, 0.25);
      break;
    }
    case "half-pocket": {
      if (s === 0) { kit("kick", 0.75); add("bass", bassRoot, 0.7, 1.9); pianoVoicing.forEach(m => add("piano", m, 0.2, 1.9)); }
      if (s === 8) { kit("snare", 0.55); add("bass", fifth, 0.6, 1.9); }
      if (s % 4 === 0) kit("hihat", 0.12, 0.25);
      break;
    }
    case "call-figure": {
      if (s === 2) add("trumpet", fold(60 + tones[tones.length > 3 ? 3 : 2], 64, 77), 0.3, 1.4);
      if (s === 10 || s === 12) add("nylon", fold(48 + tones[s === 10 ? 2 : 1], 55, 69), 0.24, 0.9);
      if (s === 0) { add("bass", bassRoot, 0.62, 1.9); kit("kick", 0.5); }
      if (s % 4 === 0) kit("hihat", 0.12, 0.25);
      break;
    }
    case "stop-breath": {
      if (vb < 2 && s === 0) {
        kit("kick", 0.8); kit("crash", 0.3, 1);
        add("bass", bassRoot, 0.7, 0.9);
        pianoVoicing.forEach(m => add("piano", m, 0.24, 0.9));
      }
      if (vb === 3 && s >= 12 && s % 2 === 0) kit("hihat", 0.1, 0.25); // count back in
      break;
    }
    case "bass-pedal": {
      if (s === 0) { add("bass", fold(36 + ch[0].root, 31, 45), 0.72, 3.9); add("piano", fold(60 + tones[2 % tones.length], 64, 76), 0.15, 1.9); }
      if (s % 4 === 0) kit("hihat", 0.1, 0.25);
      break;
    }
  }
  return ev;
}

// ---------- Audio ----------
let ctx = null, master = null, sectionGain = null, chairGain = {}, decoded = {}, raw = {}, missing = [], active = [];
let nextStepTime = 0, step = 0, timerId = null, rafId = null, scheduled = [];
let vampMakeup = 1, liveBus = null, outComp = null, bandBus = null, userMaster = null, outLim = null, passNo = 0, session = 0;
const stepLog = [];
window.__schedLog = [];

function nearestSample(inst, midi) {
  const d = INSTRUMENTS[inst];
  if (d.drums) return { id: `${inst}:${Object.keys(DRUM_NOTE).find(k => DRUM_NOTE[k] === midi)}`, shift: 0 };
  let best = null;
  for (const s of SAMPLES) if (s.inst === inst) {
    const sh = midi - s.midi;
    if (!best || Math.abs(sh) < Math.abs(best.shift)) best = { id: s.id, shift: sh };
  }
  return best;
}

function makeBus(ac) {
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -6; comp.knee.value = 3; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.2;
  const m = ac.createGain(); m.gain.value = 0.8;
  const sec = ac.createGain();
  const chairs = {};
  for (const c of CHAIRS) { chairs[c] = ac.createGain(); chairs[c].connect(sec); }
  const live = ac.createGain(); live.connect(m); // live playing + takes: outside the section makeup gain
  if (ac instanceof OfflineAudioContext) { // exports + loudness renders: unchanged chain
    sec.connect(m); m.connect(comp); comp.connect(ac.destination);
    return { master: m, sec, chairs, live, comp };
  }
  // Live playback only: user Band / Master faders and a brickwall-style limiter after the bus compressor.
  const band = ac.createGain(), user = ac.createGain(), lim = ac.createDynamicsCompressor();
  lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
  sec.connect(band); band.connect(m); m.connect(user); user.connect(comp); comp.connect(lim); lim.connect(ac.destination);
  return { master: m, sec, chairs, live, comp, band, user, lim };
}

// Zero-crossing loop points in the sustained middle of a sample.
function loopPoints(buf, on = 0) {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const zc = t => { let i = Math.floor(t * sr); while (i < d.length - 1 && !(d[i] <= 0 && d[i + 1] > 0)) i++; return i / sr; };
  return [zc(on + Math.min(1.0, buf.duration * 0.35)), zc(Math.min(2.4, buf.duration * 0.8))];
}

// MP3 decoders add lead-in silence; start each sample at its real onset so hits land on the grid.
const onsetCache = new WeakMap();
function onsetOf(buf) {
  if (onsetCache.has(buf)) return onsetCache.get(buf);
  const d = buf.getChannelData(0); let pk = 0;
  for (let i = 0; i < Math.min(d.length, buf.sampleRate); i++) pk = Math.max(pk, Math.abs(d[i]));
  let i = 0; while (i < d.length && Math.abs(d[i]) < pk * 0.02) i++;
  const t = Math.max(0, i - 8) / buf.sampleRate;
  onsetCache.set(buf, t); return t;
}

// Schedule one note on any context (live or offline). Returns the source.
function voice(ac, bufs, dest, e, when, bpm) {
  const ns = nearestSample(e.chair, e.midi);
  const buf = ns && bufs[ns.id];
  if (!buf) return null;
  if (Math.abs(ns.shift) > MAX_SHIFT) return null; // never stretch past ±4 st
  const dur = Math.max(0.05, e.beats * 60 / bpm);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.pow(2, ns.shift / 12);
  if (INSTRUMENTS[e.chair].loop) { const [a, b] = loopPoints(buf, onsetOf(buf)); src.loop = true; src.loopStart = a; src.loopEnd = b; }
  const g = ac.createGain();
  const atk = e.swell ? Math.min(0.6, dur * 0.3) : 0.004;
  const rel = Math.min(0.08, Math.max(0.012, dur * 0.1));
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(e.gain, when + atk);
  g.gain.setValueAtTime(e.gain, when + Math.max(atk, dur - rel));
  g.gain.linearRampToValueAtTime(0, when + dur);
  src.connect(g); g.connect(dest);
  src.start(when, onsetOf(buf));
  src.stop(when + dur + 0.02);
  return src;
}

async function fetchSamples() {
  const status = document.getElementById("loadStatus");
  let done = 0; missing = [];
  await Promise.all(SAMPLES.map(async s => {
    try {
      const r = await fetch(s.url);
      if (!r.ok) throw new Error(r.status);
      raw[s.id] = await r.arrayBuffer();
    } catch { missing.push(s); }
    done++;
    status.textContent = `Loading samples ${done}/${SAMPLES.length}`;
  }));
  if (missing.length) {
    const names = [...new Set(missing.map(s => INSTRUMENTS[s.inst].label))];
    status.textContent = `Missing instruments: ${names.join(", ")} (${missing.length} files). Playback and export are off until they load — check your connection or unblock cdn.jsdelivr.net and reload.`;
    status.classList.add("bad");
    return false;
  }
  status.textContent = `All ${SAMPLES.length} samples loaded.`;
  return true;
}

async function decodeAll(ac) {
  const out = {};
  await Promise.all(Object.entries(raw).map(async ([id, ab]) => { out[id] = await ac.decodeAudioData(ab.slice(0)); }));
  return out;
}

let samplesOk = null, decodePromise = null;
async function startAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    const bus = makeBus(ctx); master = bus.master; sectionGain = bus.sec; chairGain = bus.chairs; liveBus = bus.live; outComp = bus.comp; bandBus = bus.band; userMaster = bus.user; outLim = bus.lim;
    applyLevels(); applySink();
    applyMutes();
  }
  if (ctx.state !== "running") await ctx.resume();
  document.getElementById("tapGate").hidden = ctx.state === "running";
  if (samplesOk === null) samplesOk = await samplesPromise;
  if (samplesOk && !decodePromise) decodePromise = decodeAll(ctx).then(d => { decoded = d; measureLoudness(); });
  if (decodePromise) await decodePromise;
  refreshButtons();
}

function applyMutes() {
  for (const c of CHAIRS) if (chairGain[c]) chairGain[c].gain.value = state.mutes[c] ? 0 : 1;
}

function modeRange(mode) {
  return mode === "vamp" ? [CHORUS_BARS * STEPS_PER_BAR, TOTAL_BARS * STEPS_PER_BAR]
       : mode === "form" ? [0, TOTAL_BARS * STEPS_PER_BAR]
       : [0, CHORUS_BARS * STEPS_PER_BAR];
}

function scheduleStep(st, time) {
  const b = Math.floor(st / STEPS_PER_BAR), s = st % STEPS_PER_BAR;
  // A/B loudness match: the thinner vamp gets makeup gain, applied on the clock.
  sectionGain.gain.setValueAtTime(b >= CHORUS_BARS ? vampMakeup : 1, time);
  const ev = eventsFor(b, s);
  const notes = [];
  for (const e of ev) {
    if (state.mutes[e.chair]) continue;
    const src = voice(ctx, decoded, chairGain[e.chair], e, time, state.bpm);
    if (src) { active.push(src); src.onended = () => { const i = active.indexOf(src); if (i >= 0) active.splice(i, 1); }; notes.push(`${e.chair}:${e.midi}`); }
  }
  scheduleTakes(st, time);
  stepLog.push({ time, st, pass: passNo, lo: modeRange(state.mode)[0], len: modeRange(state.mode)[1] - modeRange(state.mode)[0] });
  if (stepLog.length > 512) stepLog.splice(0, 256);
  scheduled.push({ time, bar: b });
  if (scheduled.length > 256) scheduled.splice(0, 128);
  window.__schedLog.push({ time, step: st, bar: b, bpm: state.bpm, recipe: state.recipe, mode: state.mode, mutes: { ...state.mutes }, notes });
  if (window.__schedLog.length > 4000) window.__schedLog.splice(0, 2000);
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    const [lo, hi] = modeRange(state.mode);
    if (step < lo || step >= hi) { step = lo; passNo++; } // mode change lands on the next step
    scheduleStep(step, nextStepTime);
    nextStepTime += 60 / state.bpm / 4;
    step++;
    if (step >= hi) { step = lo; passNo++; } // each loop pass = a new take while recording
  }
}

async function play(mode) {
  await startAudio();
  if (!samplesOk) return;
  if (state.playing) { // switch section live, no restart: jump at the next bar line
    if (state.mode !== mode) { closeAllRec(); state.mode = mode; step = modeRange(mode)[0]; passNo++; }
    paintTransport(); return;
  }
  state.mode = mode;
  state.playing = true; session++; passNo = 0; stepLog.length = 0;
  step = modeRange(mode)[0];
  nextStepTime = ctx.currentTime + 0.1;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  scheduler();
  rafId = requestAnimationFrame(tick);
  setStatus("Playing on the audio clock. Change anything; it lands on the next step.");
  paintTransport();
}

function stop(reason) {
  closeAllRec();
  state.playing = false;
  if (timerId) clearInterval(timerId); timerId = null;
  if (rafId) cancelAnimationFrame(rafId); rafId = null;
  const now = ctx ? ctx.currentTime : 0;
  for (const s of active) { try { s.stop(now); } catch {} }
  active = []; scheduled = [];
  setStatus(reason || "Stopped.");
  paintTransport(); paintBars(-1);
}

function tick() {
  if (!state.playing) return;
  const now = ctx.currentTime;
  let bar = -1;
  for (const e of scheduled) if (e.time <= now) bar = e.bar;
  paintBars(bar);
  rafId = requestAnimationFrame(tick);
}

// ---------- Offline render (export + loudness) ----------
// The limiter (DynamicsCompressorNode) has a fixed lookahead delay. Measure it once with an
// impulse and read the render from that offset, so the first downbeat lands at sample 0.
let busLatency = null;
async function measureBusLatency() {
  if (busLatency !== null) return busLatency;
  const off = new OfflineAudioContext(2, SAMPLE_RATE / 4, SAMPLE_RATE);
  const bus = makeBus(off);
  const b = off.createBuffer(1, 64, SAMPLE_RATE); b.getChannelData(0).fill(0.25);
  const src = off.createBufferSource(); src.buffer = b; src.connect(bus.chairs.kit); src.start(0);
  const d = (await off.startRendering()).getChannelData(0);
  let i = 0; while (i < d.length && Math.abs(d[i]) < 1e-6) i++;
  busLatency = i < d.length ? i : 0;
  return busLatency;
}

async function renderSection(st, bars, startBar, { fold: doFold = true, normalize = true, takes: tks = [] } = {}) {
  const bpm = st.bpm;
  const exact = Math.round(bars * 4 * 60 / bpm * SAMPLE_RATE);
  const tail = Math.round(2.5 * SAMPLE_RATE);
  const lat = await measureBusLatency();
  const off = new OfflineAudioContext(2, exact + tail + lat, SAMPLE_RATE);
  const bufs = await decodeAll(off); // reuse the raw ArrayBuffers; never re-download
  const bus = makeBus(off);
  for (const c of CHAIRS) bus.chairs[c].gain.value = st.mutes[c] ? 0 : 1;
  const stepDur = 60 / bpm / 4;
  for (let i = 0; i < bars * STEPS_PER_BAR; i++) {
    const b = startBar + (Math.floor(i / STEPS_PER_BAR) % (startBar >= CHORUS_BARS ? VAMP_BARS : TOTAL_BARS));
    const t = i * stepDur; // first downbeat at sample 0, no offset, no jitter
    for (const e of eventsFor(b, i % STEPS_PER_BAR, st)) if (!st.mutes[e.chair]) voice(off, bufs, bus.chairs[e.chair], e, t, bpm);
    for (const tk of tks) for (const e of takeStepEvents(tk, i)) voice(off, bufs, bus.live, e.ev, t + e.frac * stepDur, bpm);
  }
  bus.live.gain.value = liveGainLin();
  const r = await off.startRendering();
  const L = new Float32Array(exact), R = new Float32Array(exact);
  const l = r.getChannelData(0).subarray(lat), rr = r.getChannelData(1).subarray(lat);
  L.set(l.subarray(0, exact)); R.set(rr.subarray(0, exact));
  if (doFold) for (let i = 0; i < tail && i < exact; i++) { L[i] += l[exact + i]; R[i] += rr[exact + i]; }
  if (normalize) {
    let pk = 0;
    for (let i = 0; i < exact; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const g = pk > 0 ? Math.pow(10, -1.1 / 20) / pk : 1; // peak lands at −1.1 dBFS (≤ −1 after 24-bit rounding)
    for (let i = 0; i < exact; i++) { L[i] *= g; R[i] *= g; }
  }
  return { L, R, exact };
}

const rms = (L, R) => { let s = 0; for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * L.length)); };
let loudTimer = null;
function measureLoudness() {
  clearTimeout(loudTimer);
  loudTimer = setTimeout(async () => {
    if (!samplesOk) return;
    const st = { ...state, mutes: { ...state.mutes }, bpm: 120 };
    const a = await renderSection(st, 4, 0, { fold: false, normalize: false });
    const b = await renderSection(st, 4, CHORUS_BARS, { fold: false, normalize: false });
    const ra = rms(a.L, a.R), rb = rms(b.L, b.R);
    vampMakeup = rb > 1e-5 ? Math.max(0.5, Math.min(4, ra / rb)) : 1;
    window.__vampMakeup = { chorusRms: ra, vampRms: rb, makeup: vampMakeup };
  }, 250);
}

function wav24(L, R) {
  const n = L.length, ba = 6, data = n * ba, buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + data, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * ba, true); v.setUint16(32, ba, true); v.setUint16(34, 24, true); w(36, "data"); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (const ch of [L, R]) {
    let x = Math.round(Math.max(-1, Math.min(1, ch[i])) * 8388607);
    v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); o += 3;
  }
  return new Uint8Array(buf);
}

function fileBase(st, ext) { return `vampfour-${st.recipe}-${st.bpm}bpm-${keyLabel(st)}.${ext}`; }
function exportState(o = {}) {
  const st = { ...state, mutes: { ...state.mutes }, ...o };
  if (o.mutes) st.mutes = { ...state.mutes, ...o.mutes };
  return st;
}

async function exportWavBytes(o = {}) {
  const st = exportState(o);
  const bars = o.bars || state.exportBars;
  const startBar = bars === 12 ? 0 : CHORUS_BARS; // 4/8 bars = the vamp (looped); 12 = full form
  const { L, R, exact } = await renderSection(st, bars, startBar, { takes: o.noTakes ? [] : takes.filter(audible) });
  return { name: fileBase(st, "wav"), bytes: wav24(L, R), frames: exact };
}

// ---------- MIDI (format 1, tempo + 4/4, one track per chair) ----------
const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
const str = s => [...s].map(c => c.charCodeAt(0));
function track(evts, name) {
  evts.sort((a, b) => a.t - b.t || a.order - b.order);
  const d = [0, 0xff, 0x03, ...vlq(name.length), ...str(name)];
  let last = 0;
  for (const e of evts) { d.push(...vlq(e.t - last), ...e.data); last = e.t; }
  d.push(0, 0xff, 0x2f, 0);
  return [...str("MTrk"), (d.length >>> 24) & 255, (d.length >>> 16) & 255, (d.length >>> 8) & 255, d.length & 255, ...d];
}
function exportMidBytes(o = {}) {
  const st = exportState(o);
  const bars = o.bars || state.exportBars, startBar = bars === 12 ? 0 : CHORUS_BARS;
  const TPQ = 480, tps = TPQ / 4, total = bars * 4 * TPQ;
  const us = Math.round(60000000 / st.bpm);
  const tempo = [{ t: 0, order: 0, data: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
                 { t: 0, order: 0, data: [0xff, 0x58, 4, 4, 2, 24, 8] },
                 { t: total, order: 0, data: [0xff, 0x01, 3, ...str("end")] }];
  const per = {}; CHAIRS.forEach(c => per[c] = []);
  const chan = { piano: 0, bass: 1, nylon: 2, trumpet: 3, violin: 4, kit: 9 };
  for (let i = 0; i < bars * STEPS_PER_BAR; i++) {
    const b = startBar + (Math.floor(i / STEPS_PER_BAR) % (startBar >= CHORUS_BARS ? VAMP_BARS : TOTAL_BARS));
    for (const e of eventsFor(b, i % STEPS_PER_BAR, st)) {
      if (st.mutes[e.chair]) continue;
      const t = i * tps, len = Math.max(1, Math.min(Math.round(e.beats * TPQ), total - t));
      const ch = chan[e.chair], vel = Math.max(1, Math.min(127, Math.round(e.gain * 150)));
      per[e.chair].push({ t, order: 1, data: [0x90 | ch, e.midi, vel] }, { t: t + len, order: 0, data: [0x80 | ch, e.midi, 0] });
    }
  }
  const names = { piano: "Piano", bass: "Upright bass", nylon: "Nylon guitar", trumpet: "Trumpet", violin: "Violin", kit: "Kit" };
  const used = CHAIRS.filter(c => per[c].length);
  const tracks = [track(tempo, "VampFour tempo"), ...used.map(c => { per[c].push({ t: total, order: 2, data: [0xff, 0x01, 3, ...str("end")] }); return track(per[c], names[c]); })];
  // one MIDI track per take (every take with notes, tiled from bar 1 across the export length)
  takes.filter(t => t.notes.length).forEach((tk, k) => {
    const ch = tk.inst === "kit" ? 9 : 10 + (k % 5), ev = [];
    for (const x of tk.notes) for (let o0 = 0; o0 < bars * 16; o0 += tk.bars * 16) {
      const p = x.pos + o0; if (p >= bars * 16) continue;
      const t = Math.round(p * tps), len = Math.max(1, Math.min(Math.round(x.dur * tps), total - t)), n = takeNote(tk.inst, x.note);
      ev.push({ t, order: 1, data: [0x90 | ch, n, Math.max(1, Math.min(127, Math.round(x.vel * 127)))] }, { t: t + len, order: 0, data: [0x80 | ch, n, 0] });
    }
    ev.push({ t: total, order: 2, data: [0xff, 0x01, 3, ...str("end")] });
    tracks.push(track(ev, `${tk.name} (${INSTRUMENTS[tk.inst].label}${tk.mode === "silent" || tk.muted ? ", silent" : ""})`));
  });
  const hdr = [...str("MThd"), 0, 0, 0, 6, 0, 1, 0, tracks.length, (TPQ >> 8) & 255, TPQ & 255];
  return { name: fileBase(st, "mid"), bytes: new Uint8Array([...hdr, ...tracks.flat()]) };
}

function download(bytes, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function doExportWav() {
  await startAudio(); if (!samplesOk) return;
  setStatus("Rendering WAV…");
  const r = await exportWavBytes();
  download(r.bytes, r.name, "audio/wav");
  setStatus(`Exported ${r.name} · ${r.frames.toLocaleString()} samples · 48 kHz 24-bit stereo · downbeat at sample 0 · tail folded.`);
}
async function doExportMid() {
  const r = exportMidBytes();
  download(r.bytes, r.name, "audio/midi");
  setStatus(`Exported ${r.name} · one track per chair · tempo ${state.bpm} · 4/4.`);
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
function setStatus(t) { $("status").textContent = t; }
function refreshButtons() {
  const ok = !!samplesOk && Object.keys(decoded).length > 0;
  for (const id of ["playA", "playB", "playForm", "exportWav"]) $(id).disabled = samplesOk === false;
  $("exportWav").title = ok ? "" : "Loads after the first tap";
}
function paintTransport() {
  for (const [id, m] of [["playA", "chorus"], ["playB", "vamp"], ["playForm", "form"]]) $(id).classList.toggle("on", state.playing && state.mode === m);
}
function paintCards() {
  const g = $("grooves"); g.innerHTML = "";
  grooves.forEach(x => {
    const b = document.createElement("button");
    b.className = "card" + (state.chordText === x.chords && state.groove === x.id ? " on" : "");
    b.innerHTML = `<b>${x.name}</b><span>${x.chords} · ${x.bpm} BPM</span>`;
    b.onclick = () => { state.groove = x.id; state.chordText = x.chords; state.bpm = x.bpm; state.key = spell(parseChords(x.chords)[0].root); syncInputs(); changed(); };
    g.appendChild(b);
  });
  const r = $("recipes"); r.innerHTML = "";
  recipes.forEach(x => {
    const b = document.createElement("button");
    b.className = "card" + (state.recipe === x.id ? " on" : "");
    b.dataset.recipe = x.id;
    b.innerHTML = `<b>${x.name}</b><span>${x.blurb}</span>`;
    b.onclick = () => { state.recipe = x.id; changed(); };
    r.appendChild(b);
  });
}
function paintBars(active = -1) {
  const el = $("bars"), ch = currentChords();
  if (el.children.length !== TOTAL_BARS) { el.innerHTML = ""; for (let i = 0; i < TOTAL_BARS; i++) el.appendChild(document.createElement("div")); }
  [...el.children].forEach((d, i) => {
    d.className = "bar" + (i >= CHORUS_BARS ? " vamp" : "") + (i === active ? " active" : "");
    d.innerHTML = `<div class="n">${i + 1} · ${i >= CHORUS_BARS ? "Vamp" : "Chorus"}</div><div class="c">${chordName(ch[i % 4])}</div>`;
  });
}
function punch() {
  const r = recipes.find(x => x.id === state.recipe), ch = currentChords().map(chordName);
  return `VampFour punch list\n${state.bpm} BPM · key ${keyLabel()} · chords ${ch.join(" ")} · ${r.name}\n\nThe move: ${r.blurb}\nChorus bars 1–8: ${ch.join(" ")} ×2\nVamp bars 9–12: ${ch.join(" ")} — ${r.name}\n\nDrop the WAV on bar 9 of your session. Do not fade. The next section returns on 13.`;
}
function syncInputs() { $("bpm").value = state.bpm; $("key").value = state.key; $("chords").value = state.chordText; $("exportBars").value = state.exportBars; document.querySelectorAll("[data-mute]").forEach(e => e.checked = !state.mutes[e.dataset.mute]); }
function changed() { persist(); applyMutes(); paintCards(); paintBars(); $("punch").textContent = punch(); measureLoudness(); }

function buildUI() {
  $("key").innerHTML = KEYS.map(k => `<option>${k}</option>`).join("");
  $("mutes").innerHTML = CHAIRS.map(c => `<label><input type="checkbox" data-mute="${c}" checked> ${c === "kit" ? "Kit" : c[0].toUpperCase() + c.slice(1)}</label>`).join("");
  syncInputs();
  $("bpm").addEventListener("change", e => { const v = Math.round(+e.target.value); if (v >= 60 && v <= 180) { state.bpm = v; changed(); } else e.target.value = state.bpm; });
  $("key").addEventListener("change", e => { state.key = e.target.value; changed(); });
  $("chords").addEventListener("change", e => {
    if (parseChords(e.target.value)) { state.chordText = e.target.value.trim().split(/[\s,|]+/).join(" "); state.groove = "custom"; $("chordErr").textContent = ""; changed(); }
    else $("chordErr").textContent = "Enter exactly 4 chords, like Am F C G (m, 7, m7, maj7, sus2, sus4, dim, 6).";
  });
  $("exportBars").addEventListener("change", e => { state.exportBars = +e.target.value; persist(); });
  document.querySelectorAll("[data-mute]").forEach(e => e.addEventListener("input", () => { state.mutes[e.dataset.mute] = !e.checked; changed(); }));
  $("tapBtn").onclick = () => startAudio();
  $("playA").onclick = () => play("chorus");
  $("playB").onclick = () => play("vamp");
  $("playForm").onclick = () => play("form");
  $("stop").onclick = () => stop();
  $("copy").onclick = () => navigator.clipboard && navigator.clipboard.writeText(punch());
  $("exportWav").onclick = doExportWav;
  $("exportMid").onclick = doExportMid;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) $("iosNote").hidden = false;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.playing) stop("Stopped because the tab was hidden. Press play to start again.");
  });
  changed();
}

// ---------- Play along live: MIDI keyboard / computer keys / on-screen keys -> VampFour's own pinned samples ----------
// Notes trigger immediately at ctx.currentTime, beside the lookahead scheduler. Notes never start the transport.
const LIVE_LS = "vampfour.live.v1";
const live = Object.assign({ inst: "piano", oct: 4, liveDb: 0, bandDb: 0, masterDb: 0, rec: false, midiIn: "", midiOut: "", midiTransport: false, sink: "" },
  (() => { try { return JSON.parse(localStorage.getItem(LIVE_LS) || "{}"); } catch { return {}; } })());
if (!INSTRUMENTS[live.inst]) live.inst = "piano";
delete live.level; // pre-volume-fader setting (linear 0..1.5); replaced by dB faders
for (const [k, lo, hi] of [["liveDb", -40, 12], ["bandDb", -40, 6], ["masterDb", -40, 6]]) live[k] = Number.isFinite(+live[k]) ? Math.max(lo, Math.min(hi, +live[k])) : 0;
// Live samples sit far below the dense band mix (measured ~20 dB RMS below). LIVE_MAKEUP lines a normal
// strong performance up with the band at 0 dB on the "Your playing" fader; the limiter catches the rest.
const LIVE_MAKEUP = 5.6, KEY_VEL = 100 / 127;
const dbLin = db => db <= -40 ? 0 : Math.pow(10, db / 20);
const liveGainLin = () => LIVE_MAKEUP * dbLin(live.liveDb);
function applyLevels() {
  if (liveBus) liveBus.gain.value = liveGainLin();
  if (bandBus) bandBus.gain.value = dbLin(live.bandDb);
  if (userMaster) userMaster.gain.value = dbLin(live.masterDb);
}
const saveLive = () => localStorage.setItem(LIVE_LS, JSON.stringify(live));
const liveVoices = new Map(), liveOpen = new Map();
let sustain = false, midiAccess = null, midiInPort = null, midiOut = null;
window.__liveLog = [];
const KIT_KEYS = ["kick", "kick", "snare", "snare", "hihat", "hihat", "hihat", "crash", "kick", "snare", "hihat", "crash"];
const sampleSpan = inst => { const m = SAMPLES.filter(s => s.inst === inst).map(s => s.midi); return [Math.min(...m) - MAX_SHIFT, Math.max(...m) + MAX_SHIFT]; };
function takeNote(inst, n) {
  if (inst === "kit") return Object.values(DRUM_NOTE).includes(n) ? n : DRUM_NOTE[KIT_KEYS[((n % 12) + 12) % 12]];
  const [lo, hi] = sampleSpan(inst); return fold(n, lo, hi);
}
const velGain = v => 0.3 + 0.55 * Math.pow(Math.max(0, Math.min(1, v)), 0.6); // gentle curve: soft playing stays audible
function liveOn(note, vel, src) {
  if (!ctx || ctx.state !== "running" || !Object.keys(decoded).length) { setStatus("Tap to start audio first (or wait for samples), then play."); startAudio(); return; }
  const inst = live.inst, n = takeNote(inst, note), key = src + ":" + note, t = ctx.currentTime;
  if (liveVoices.has(key)) releaseVoice(liveVoices.get(key), t);
  const ns = nearestSample(inst, n), buf = ns && decoded[ns.id];
  if (!buf || Math.abs(ns.shift) > MAX_SHIFT) return;
  const s = ctx.createBufferSource(), g = ctx.createGain(), vg = velGain(vel);
  s.buffer = buf; s.playbackRate.value = Math.pow(2, ns.shift / 12);
  if (INSTRUMENTS[inst].loop) { const [a, b] = loopPoints(buf, onsetOf(buf)); s.loop = true; s.loopStart = a; s.loopEnd = b; }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vg, t + (INSTRUMENTS[inst].loop ? 0.05 : 0.003));
  s.connect(g); g.connect(liveBus); s.start(t, onsetOf(buf));
  const vo = { s, g, inst, sustained: false, done: false };
  s.onended = () => { vo.done = true; if (liveVoices.get(key) === vo) liveVoices.delete(key); };
  liveVoices.set(key, vo); keyVis(note, true);
  if (midiOut) try { midiOut.send([0x90 | (inst === "kit" ? 9 : 0), n, Math.max(1, Math.round(vel * 127))]); } catch {}
  window.__liveLog.push({ ev: "on", note, n, vel, src, startAt: t, ctxNow: ctx.currentTime, perf: performance.now(), playing: state.playing });
  if (window.__liveLog.length > 500) window.__liveLog.shift();
  if (live.rec && state.playing) { const p = transportPos(t); if (p) { const tk = takeFor(p, inst); if (tk) liveOpen.set(key, { note: n, vel, pos: p.pos, take: tk }); } }
}
function releaseVoice(vo, t) {
  if (vo.done) return; vo.done = true;
  const rel = vo.inst === "violin" ? 0.25 : vo.inst === "kit" ? 0.6 : 0.12, g = vo.g.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + rel); try { vo.s.stop(t + rel + 0.02); } catch {}
}
function liveOff(note, src) {
  const key = src + ":" + note, vo = liveVoices.get(key); keyVis(note, false);
  window.__liveLog.push({ ev: "off", note, src, sustain, ctxNow: ctx ? ctx.currentTime : 0 });
  closeRec(key);
  if (midiOut && vo) try { midiOut.send([0x80 | (vo.inst === "kit" ? 9 : 0), takeNote(vo.inst, note), 0]); } catch {}
  if (!vo || !ctx) return;
  if (vo.inst === "kit") { liveVoices.delete(key); return; } // drums ring out as one-shots
  if (sustain) { vo.sustained = true; return; }
  liveVoices.delete(key); releaseVoice(vo, ctx.currentTime);
}
function setSustain(down) {
  sustain = down; $("susLamp").classList.toggle("on", down);
  if (!down && ctx) for (const [k, vo] of [...liveVoices]) if (vo.sustained) { liveVoices.delete(k); releaseVoice(vo, ctx.currentTime); }
}
function liveAllOff() { if (ctx) for (const [, vo] of liveVoices) releaseVoice(vo, ctx.currentTime); liveVoices.clear(); sustain = false; document.querySelectorAll(".mk.down").forEach(k => k.classList.remove("down")); }

// position of audio time t in the running loop (16th steps from the section start) + pass number, from the scheduler's own log
function transportPos(t) {
  let cur = null; for (const e of stepLog) { if (e.time <= t) cur = e; else break; }
  if (!cur) return null;
  return { pos: cur.st - cur.lo + (t - cur.time) / (60 / state.bpm / 4), pass: cur.pass, len: cur.len, lo: cur.lo };
}

// ---- Takes: each loop pass while recording becomes a new take; persisted (max 16) ----
const TAKE_CAP = 16, TAKE_KEY = "vampfour.takes.v1";
const takes = (() => { try { const a = JSON.parse(localStorage.getItem(TAKE_KEY) || "[]"); return Array.isArray(a) ? a.filter(t => INSTRUMENTS[t.inst]) : []; } catch { return []; } })();
let recTake = null;
function saveTakes() { try { localStorage.setItem(TAKE_KEY, JSON.stringify(takes.map(t => ({ ...t, session: undefined, pass: undefined })))); } catch { setStatus("Could not save takes (storage full?). Export them now."); } }
const audible = t => t.mode === "loop" && !t.muted && t.notes.length > 0;
function takeFor(p, inst) {
  if (recTake && recTake.session === session && recTake.pass === p.pass) return recTake;
  if (takes.length >= TAKE_CAP) { setStatus(`Take limit (${TAKE_CAP}) reached. Export or delete takes to record more.`); return null; }
  const n = takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  for (const t of takes) if (t.mode === "loop") t.mode = "silent"; // newest take loops by default
  recTake = { id: Date.now() + "-" + n, n, name: "Take " + n, inst, bars: p.len / STEPS_PER_BAR, bpm: state.bpm, section: state.mode, mode: "loop", muted: false, notes: [], session, pass: p.pass };
  takes.push(recTake); saveTakes(); renderTakes(); return recTake;
}
function closeRec(key, atEnd) {
  const o = liveOpen.get(key); if (!o) return; liveOpen.delete(key);
  const L = o.take.bars * STEPS_PER_BAR, p = atEnd || !ctx ? null : transportPos(ctx.currentTime);
  const end = p && p.pass === o.take.pass && o.take.session === session && p.pos >= o.pos ? p.pos : L; // held past the loop seam: ends at the seam
  o.take.notes.push({ note: o.note, vel: +o.vel.toFixed(3), pos: +o.pos.toFixed(4), dur: +Math.max(0.25, Math.min(end, L) - o.pos).toFixed(4) });
  saveTakes(); renderTakes();
}
function closeAllRec() { for (const k of [...liveOpen.keys()]) { const o = liveOpen.get(k), p = ctx ? transportPos(ctx.currentTime) : null; closeRec(k, !(p && p.pass === o.take.pass)); } recTake = null; renderTakes(); }
// events of take tk that start inside export/playback step i (takes start at bar 1 of the section and loop)
function takeStepEvents(tk, i) {
  const L = tk.bars * STEPS_PER_BAR, loc = i % L, out = [];
  for (const x of tk.notes) if (Math.floor(x.pos) === loc)
    out.push({ frac: x.pos - loc, ev: { chair: tk.inst, midi: takeNote(tk.inst, x.note), gain: velGain(x.vel), beats: tk.inst === "kit" ? 1 : Math.max(0.0625, x.dur / 4) } });
  return out;
}
function scheduleTakes(st, time) {
  const lo = modeRange(state.mode)[0], sd = 60 / state.bpm / 4;
  for (const tk of takes) { if (!audible(tk) || tk === recTake) continue;
    for (const e of takeStepEvents(tk, st - lo)) { const src = voice(ctx, decoded, liveBus, e.ev, time + e.frac * sd, state.bpm); if (src) active.push(src); } }
}
function renderTakes() {
  const box = $("takes"); if (!box) return;
  $("takeInfo").textContent = takes.length ? `${takes.length}/${TAKE_CAP} takes. WAV includes takes set to Loop and not muted; MIDI has one track per take.` : "No takes yet. Tick Record, press play, and play: each loop pass becomes a new take.";
  box.innerHTML = takes.map((t, i) => `<div class="take${audible(t) ? " aud" : ""}${t === recTake ? " rec" : ""}" data-i="${i}">
    <b>${t.name}</b><small>${t.notes.length} notes · ${INSTRUMENTS[t.inst].label} · ${t.bars} bars</small>
    <select data-act="mode" aria-label="Take mode"><option value="loop"${t.mode === "loop" ? " selected" : ""}>Loop</option><option value="silent"${t.mode === "silent" ? " selected" : ""}>Silent</option></select>
    <label><input type="checkbox" data-act="mute"${t.muted ? " checked" : ""}> Mute</label>
    <button data-act="del">Delete</button></div>`).join("");
}

// ---- on-screen keys + computer keyboard ----
const KEYMAP = "awsedftgyhujk", NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const kbBase = () => 12 * (live.oct + 1);
function renderKeys() {
  const base = kbBase();
  $("miniKeys").innerHTML = [...Array(13)].map((_, i) => { const n = base + i, blk = [1, 3, 6, 8, 10].includes(i % 12);
    return `<button class="mk ${blk ? "blk" : "wht"}" data-n="${n}" aria-label="${NAMES[n % 12]}${Math.floor(n / 12) - 1}"><span>${live.inst === "kit" ? KIT_KEYS[n % 12] : NAMES[n % 12]}</span><i>${KEYMAP[i].toUpperCase()}</i></button>`; }).join("");
  $("octLbl").textContent = "C" + live.oct;
}
function keyVis(n, on) { const k = document.querySelector(`.mk[data-n="${n}"]`); if (k) k.classList.toggle("down", on); }

// ---- Web MIDI ----
function onMidi(e) {
  const d = e.data, s = d[0], cmd = s & 0xf0, n = d[1], v = d[2];
  if (s === 0xfa || s === 0xfb) { if (live.midiTransport && !state.playing) play(state.mode || "vamp"); return; } // opt-in only
  if (s === 0xfc) { if (live.midiTransport && state.playing) stop(); return; }
  if (s >= 0xf0) return;
  if (cmd === 0xb0 && n === 64) { setSustain(v >= 64); return; }
  if (cmd === 0xb0 && (n === 120 || n === 123)) { liveAllOff(); return; }
  if (cmd === 0x90 && v > 0) liveOn(n, v / 127, "midi");
  else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) liveOff(n, "midi");
}
function refreshMidi() {
  if (!midiAccess) return;
  const fill = (sel, ports, cur) => { sel.innerHTML = '<option value="">(none)</option>' + [...ports.values()].map(p => `<option value="${p.id}">${p.name}</option>`).join(""); sel.value = [...ports.keys()].includes(cur) ? cur : ""; };
  // default to the first input if none chosen yet
  if (!live.midiIn && midiAccess.inputs.size) live.midiIn = [...midiAccess.inputs.keys()][0];
  fill($("midiIn"), midiAccess.inputs, live.midiIn); fill($("midiOut"), midiAccess.outputs, live.midiOut);
  if (midiInPort) midiInPort.onmidimessage = null;
  midiInPort = midiAccess.inputs.get($("midiIn").value) || null; if (midiInPort) midiInPort.onmidimessage = onMidi;
  midiOut = midiAccess.outputs.get($("midiOut").value) || null;
  $("midiNote").textContent = midiAccess.inputs.size ? `${midiAccess.inputs.size} MIDI input(s) found.${midiInPort ? " Listening to " + midiInPort.name + "." : ""}` : "No MIDI devices yet. Plug one in; it appears here.";
}
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { $("midiNote").textContent = "Web MIDI isn't supported in this browser (try Chrome or Edge). On-screen and computer keys still play."; return; }
  try { midiAccess = await navigator.requestMIDIAccess({ sysex: false }); midiAccess.onstatechange = refreshMidi; refreshMidi(); $("midiConnect").hidden = true; }
  catch (err) { $("midiNote").textContent = "MIDI access was blocked (" + (err && err.name || "denied") + "). Allow MIDI for this site, or play the on-screen keys."; }
}

// ---- audio output (setSinkId with fallback) ----
let sinkEl = null, sinkDest = null, sinkTouched = false;
async function listOutputs() {
  const sel = $("audioOut");
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) { sel.disabled = true; return; }
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
  sel.innerHTML = '<option value="">System default</option>' + outs.filter(d => d.deviceId && d.deviceId !== "default").map((d, i) => `<option value="${d.deviceId}">${d.label || "Output " + (i + 1)}</option>`).join("");
  sel.value = [...sel.options].some(o => o.value === live.sink) ? live.sink : "";
  const canSink = (window.AudioContext && "setSinkId" in AudioContext.prototype) || ("setSinkId" in HTMLMediaElement.prototype);
  if (!canSink) { sel.disabled = true; $("outNote").textContent = "This browser plays through the system output only (no output picker)."; }
}
async function applySink() {
  if (!ctx) return;
  const id = live.sink || "";
  if (!id && !sinkTouched) return; // default output: leave the context alone
  sinkTouched = true;
  try {
    if (typeof ctx.setSinkId === "function") { await ctx.setSinkId(id); if (ctx.state !== "running") await ctx.resume().catch(() => {}); $("outNote").textContent = id ? "Output set." : ""; return; }
    if ("setSinkId" in HTMLMediaElement.prototype) { // fallback: route the master through an <audio> element
      if (!sinkEl) { sinkDest = ctx.createMediaStreamDestination(); sinkEl = new Audio(); sinkEl.srcObject = sinkDest.stream; }
      try { outComp.disconnect(); } catch {}
      if (id) { outComp.connect(sinkDest); await sinkEl.setSinkId(id); await sinkEl.play(); } else { sinkEl.pause(); outComp.connect(ctx.destination); }
      $("outNote").textContent = id ? "Output set (fallback route)." : ""; return;
    }
  } catch (err) { $("outNote").textContent = "Could not switch output: " + (err && err.message || err) + ". Using system default."; }
}

function initLive() {
  $("liveInst").innerHTML = CHAIRS.map(c => `<option value="${c}">${INSTRUMENTS[c].label}${INSTRUMENTS[c].loop ? " (hold)" : ""}</option>`).join("");
  $("liveInst").value = live.inst; $("liveRec").checked = live.rec; $("midiTransport").checked = live.midiTransport;
  $("liveInst").onchange = e => { liveAllOff(); live.inst = e.target.value; saveLive(); renderKeys(); };
  for (const [id, k] of [["volLive", "liveDb"], ["volBand", "bandDb"], ["volMaster", "masterDb"]]) {
    const el = $(id), out = $(id + "Db"), show = () => { out.textContent = live[k] <= -40 ? "−∞ dB" : (live[k] > 0 ? "+" : live[k] < 0 ? "−" : "") + Math.abs(live[k]).toFixed(1) + " dB"; };
    el.value = live[k]; show();
    el.oninput = () => { live[k] = +el.value; show(); applyLevels(); saveLive(); };
    el.ondblclick = () => { live[k] = 0; el.value = 0; show(); applyLevels(); saveLive(); };
  }
  $("liveRec").onchange = e => { live.rec = e.target.checked; if (!live.rec) closeAllRec(); saveLive(); };
  $("midiTransport").onchange = e => { live.midiTransport = e.target.checked; saveLive(); };
  $("midiIn").onchange = e => { live.midiIn = e.target.value; saveLive(); refreshMidi(); };
  $("midiOut").onchange = e => { live.midiOut = e.target.value; saveLive(); refreshMidi(); };
  $("midiConnect").onclick = connectMidi;
  $("audioOut").onchange = e => { live.sink = e.target.value; saveLive(); applySink(); };
  $("octDn").onclick = () => { live.oct = Math.max(1, live.oct - 1); saveLive(); renderKeys(); };
  $("octUp").onclick = () => { live.oct = Math.min(6, live.oct + 1); saveLive(); renderKeys(); };
  $("clearTakes").onclick = () => { if (!takes.length || !confirm(`Clear all ${takes.length} takes?`)) return; takes.length = 0; recTake = null; liveOpen.clear(); saveTakes(); renderTakes(); };
  $("takes").addEventListener("change", e => { const row = e.target.closest(".take"); if (!row) return; const t = takes[+row.dataset.i], a = e.target.dataset.act;
    if (a === "mode") t.mode = e.target.value; if (a === "mute") t.muted = e.target.checked; saveTakes(); renderTakes(); });
  $("takes").addEventListener("click", e => { if (e.target.dataset.act !== "del") return; const i = +e.target.closest(".take").dataset.i;
    if (!confirm(`Delete ${takes[i].name}?`)) return; if (takes[i] === recTake) recTake = null; takes.splice(i, 1); saveTakes(); renderTakes(); });
  const box = $("miniKeys"), down = new Map();
  box.addEventListener("pointerdown", e => { const k = e.target.closest(".mk"); if (!k) return; e.preventDefault();
    try { k.releasePointerCapture(e.pointerId); } catch {} const n = +k.dataset.n; down.set(e.pointerId, n);
    liveOn(n, e.pressure && e.pointerType === "pen" ? Math.max(KEY_VEL, e.pressure) : KEY_VEL, "tap"); });
  const up = e => { if (!down.has(e.pointerId)) return; liveOff(down.get(e.pointerId), "tap"); down.delete(e.pointerId); };
  ["pointerup", "pointercancel", "pointerleave"].forEach(t => box.addEventListener(t, up));
  box.addEventListener("pointerover", e => { if (!down.has(e.pointerId) || e.buttons === 0) return; const k = e.target.closest(".mk"); if (!k) return; const n = +k.dataset.n;
    if (n !== down.get(e.pointerId)) { liveOff(down.get(e.pointerId), "tap"); down.set(e.pointerId, n); liveOn(n, KEY_VEL, "tap"); } });
  box.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("keydown", e => { if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return; if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== "checkbox" && e.target.type !== "range") return;
    const k = e.key.toLowerCase(), i = KEYMAP.indexOf(k);
    if (k === "z" || k === "x") { live.oct = Math.max(1, Math.min(6, live.oct + (k === "z" ? -1 : 1))); saveLive(); renderKeys(); return; }
    if (k === " " && e.target === document.body) { e.preventDefault(); setSustain(true); return; }
    if (i >= 0) { e.preventDefault(); liveOn(kbBase() + i, KEY_VEL, "kb"); } });
  document.addEventListener("keyup", e => { const k = e.key.toLowerCase(), i = KEYMAP.indexOf(k); if (k === " ") { setSustain(false); return; } if (i >= 0) liveOff(kbBase() + i, "kb"); });
  window.addEventListener("blur", () => { for (const [k] of [...liveVoices]) if (/^(kb|tap):/.test(k)) liveOff(+k.split(":")[1], k.split(":")[0]); });
  if (navigator.mediaDevices) { listOutputs(); navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener("devicechange", listOutputs); }
  // re-open MIDI silently only if the user granted it before; otherwise wait for the Connect button
  if (navigator.permissions && navigator.requestMIDIAccess) navigator.permissions.query({ name: "midi" }).then(p => { if (p.state === "granted") connectMidi(); }).catch(() => {});
  if (!navigator.requestMIDIAccess) $("midiNote").textContent = "Web MIDI isn't supported here (try Chrome/Edge). On-screen and computer keys still play.";
  renderKeys(); renderTakes();
  window.__live = { applyLevels, get levels() { return { liveBus: liveBus && liveBus.gain.value, band: bandBus && bandBus.gain.value, master: userMaster && userMaster.gain.value }; }, liveOn, liveOff, setSustain, takes, onMidi, voices: liveVoices, live, tpos: () => ctx && transportPos(ctx.currentTime), get sustain() { return sustain; }, closeAllRec };
}

restore();
buildUI();
initLive();
const samplesPromise = fetchSamples().then(ok => { samplesOk = ok; refreshButtons(); return ok; });
window.__vampfour = { get busLatency() { return busLatency; }, get ctx() { return ctx; }, get playing() { return state.playing; }, state, takes, eventsFor, exportWavBytes, exportMidBytes, SAMPLES, nearestSample, INSTRUMENTS };
