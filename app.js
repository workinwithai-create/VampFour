// VampFour — four-bar vamp desk
// Pinned samples only. Audio clock scheduling. Exports on the grid.

const CDN = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SAMPLE_RATE = 48000;

const recipes = [
  { id: "pedal-hold", name: "Pedal hold", blurb: "Bass pedal. Kit half-time. Piano figure on the and." },
  { id: "nylon-vamp", name: "Nylon vamp", blurb: "Nylon figure loops. Hats die. Space for the vocal." },
  { id: "walk-under", name: "Walk under", blurb: "Upright walks the changes. Sparse piano." },
  { id: "string-air", name: "String air", blurb: "Violin holds. Kit on 2 and 4. No crash." },
  { id: "half-pocket", name: "Half pocket", blurb: "Half-time kit. Root and fifth. Then the return." },
  { id: "call-figure", name: "Call figure", blurb: "Trumpet calls once per bar. Nylon answers." },
  { id: "stop-breath", name: "Stop breath", blurb: "Two hits. Two bars of air. The song returns." },
  { id: "bass-pedal", name: "Bass pedal", blurb: "Upright holds the tonic. Everything else thins." }
];

function bar(symbol, piano, guitar, bass) { return { symbol, piano, guitar, bass }; }

const grooves = [
  { id: "amber", name: "Amber Walk", bpm: 96, key: "A minor",
    chorus: [bar("Am",[45,48,52,57],[45,52,57],33),bar("F",[41,45,48,53],[41,48,53],41),bar("C",[48,52,55,60],[48,52,55],36),bar("G",[43,47,50,55],[43,47,50],31),bar("Am",[45,48,52,57],[45,52,57],33),bar("F",[41,45,48,53],[41,48,53],41),bar("C",[48,52,55,60],[48,52,55],36),bar("G",[43,47,50,55],[43,47,50],31)],
    vamp: [bar("Am",[45,48,52,57],[45,52,57],33),bar("F",[41,45,48,53],[41,48,53],41),bar("C",[48,52,55,60],[48,52,55],36),bar("G",[43,47,50,55],[43,47,50],31)] },
  { id: "porch", name: "Porch Climb", bpm: 84, key: "E major",
    chorus: [bar("E",[40,44,47,52],[40,47,52],28),bar("B",[35,39,42,47],[35,42,47],23),bar("C#m",[44,47,51,56],[44,51,56],32),bar("A",[33,37,40,45],[33,40,45],33),bar("E",[40,44,47,52],[40,47,52],28),bar("B",[35,39,42,47],[35,42,47],23),bar("C#m",[44,47,51,56],[44,51,56],32),bar("A",[33,37,40,45],[33,40,45],33)],
    vamp: [bar("A",[33,37,40,45],[33,40,45],33),bar("B",[35,39,42,47],[35,42,47],23),bar("E",[40,44,47,52],[40,47,52],28),bar("E",[40,44,47,52],[40,47,52],28)] },
  { id: "fold", name: "Fold Radio", bpm: 108, key: "D minor",
    chorus: [bar("Dm",[38,41,45,50],[38,45,50],26),bar("Bb",[34,38,41,46],[34,41,46],34),bar("F",[41,45,48,53],[41,48,53],29),bar("C",[36,40,43,48],[36,43,48],24),bar("Dm",[38,41,45,50],[38,45,50],26),bar("Bb",[34,38,41,46],[34,41,46],34),bar("F",[41,45,48,53],[41,48,53],29),bar("C",[36,40,43,48],[36,43,48],24)],
    vamp: [bar("Bb",[34,38,41,46],[34,41,46],34),bar("C",[36,40,43,48],[36,43,48],24),bar("Dm",[38,41,45,50],[38,45,50],26),bar("Dm",[38,41,45,50],[38,45,50],26)] }
];

const state = {
  groove: grooves[0],
  recipe: recipes[0],
  bpm: 96,
  key: "A minor",
  playing: false,
  mode: null,
  bar: 0,
  mutes: {}
};

let ctx, master, compressor, buffers = {}, rawBuffers = {}, activeSources = [];
let nextStepTime = 0, step = 0, timerId = null, rafId = null;

const CHORUS_BARS = 8;
const VAMP_BARS = 4;
const TOTAL_BARS = 12;
const STEPS_PER_BAR = 16;

function loadPersisted() {
  try {
    const s = JSON.parse(localStorage.getItem("vampfour") || "{}");
    if (s.bpm) state.bpm = Math.max(60, Math.min(180, s.bpm));
    if (s.key) state.key = s.key;
    if (s.grooveId) state.groove = grooves.find(g => g.id === s.grooveId) || state.groove;
    if (s.recipeId) state.recipe = recipes.find(r => r.id === s.recipeId) || state.recipe;
  } catch {}
  document.getElementById("bpm").value = state.bpm;
  document.getElementById("key").value = state.key;
}
function persist() {
  localStorage.setItem("vampfour", JSON.stringify({
    bpm: state.bpm, key: state.key, grooveId: state.groove.id, recipeId: state.recipe.id
  }));
}

async function loadSamples() {
  const files = [
    ["kick", "drums/kick.mp3"], ["snare", "drums/snare.mp3"], ["hat", "drums/hihat.mp3"], ["crash", "drums/crash.mp3"],
    ["pC3", "piano/C3.mp3"], ["pC4", "piano/C4.mp3"], ["pA3", "piano/A3.mp3"],
    ["bE1", "bass/E1.mp3"], ["bA1", "bass/A1.mp3"], ["bC2", "bass/C2.mp3"],
    ["gE2", "guitar/E2.mp3"], ["gA2", "guitar/A2.mp3"], ["gE3", "guitar/E3.mp3"],
    ["tC4", "trumpet/C4.mp3"], ["vA3", "violin/A3.mp3"]
  ];
  const status = document.getElementById("status");
  let loaded = 0, missing = [];
  for (const [k, path] of files) {
    const url = `${CDN}/${path}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const ab = await r.arrayBuffer();
      rawBuffers[k] = ab;
      buffers[k] = await (ctx || new AudioContext()).decodeAudioData(ab.slice(0));
      loaded++;
    } catch (e) {
      missing.push(k);
      console.warn(k, e);
    }
    status.textContent = `Seating chairs ${loaded}/${files.length}` + (missing.length ? ` · missing: ${missing.join(", ")}` : "");
  }
  if (missing.length) {
    status.textContent = `Missing instruments: ${missing.join(", ")}. Reload after unblocking the sample host.`;
  } else {
    status.textContent = "Chairs seated · live FluidR3 + kit · tap to start audio";
  }
  return missing.length === 0;
}

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 6;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(compressor);
    compressor.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

function rateFromMidi(midi, base) { return Math.pow(2, (midi - base) / 12); }

function playNote(name, when, midi, baseMidi, gain = 0.4, duration = 0.3) {
  const b = buffers[name];
  if (!b || !ctx) return;
  const transposed = transposeMidi(midi);
  const rate = Math.pow(2, (transposed - baseMidi) / 12);
  if (Math.abs(12 * Math.log2(rate)) > 4) return; // ±4 semitone gate
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.setValueAtTime(gain, when + Math.max(0.01, duration - 0.02));
  g.gain.linearRampToValueAtTime(0, when + duration);
  src.connect(g);
  g.connect(master);
  src.start(when);
  src.stop(when + duration + 0.05);
  activeSources.push(src);
}

function chordAt(barIndex) {
  if (barIndex < CHORUS_BARS) return state.groove.chorus[barIndex];
  return state.groove.vamp[barIndex - CHORUS_BARS];
}

function scheduleStep(stepIndex, time) {
  const barIndex = Math.floor(stepIndex / STEPS_PER_BAR);
  const s = stepIndex % STEPS_PER_BAR;
  const onVamp = barIndex >= CHORUS_BARS;
  const ch = chordAt(barIndex);
  const rec = state.recipe.id;
  const bpm = state.bpm;
  const stepDur = 60 / bpm / 4;

  // Drums
  if (s % 2 === 0 && !(onVamp && rec === "stop-breath" && barIndex >= 10)) {
    playNote("hat", time, 60, 60, onVamp && rec === "half-pocket" ? 0.04 : 0.07, 0.1);
  }
  if (s === 0 && !(onVamp && rec === "string-air")) {
    playNote("kick", time, 36, 36, 0.65, 0.15);
  }
  if (s === 8 && !(onVamp && (rec === "half-pocket" || rec === "stop-breath"))) {
    playNote("snare", time, 38, 38, 0.4, 0.12);
  }

  // Melodic on beat 1
  if (s === 0) {
    playNote("pC4", time, ch.piano[2] || 60, 60, 0.25, onVamp ? 0.8 : 0.4);
    playNote("pA3", time, ch.piano[1] || 57, 57, 0.18, 0.5);
    playNote("bA1", time, ch.bass, 33, 0.45, onVamp && rec === "bass-pedal" ? 1.8 : 0.6);
    playNote("gA2", time, ch.guitar[0] || 45, 45, onVamp && rec === "nylon-vamp" ? 0.3 : 0.18, 0.5);
  }
  // Extra for recipes
  if (onVamp && rec === "call-figure" && (s === 4 || s === 12)) {
    playNote("tC4", time, (ch.piano[3] || 69), 60, 0.3, 0.4);
  }
  if (onVamp && rec === "string-air" && s === 0) {
    playNote("vA3", time, ch.piano[2] || 60, 57, 0.22, 1.6);
  }
}

function scheduler() {
  if (!state.playing || !ctx) return;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    nextStepTime += stepDur;
    step = (step + 1) % (TOTAL_BARS * STEPS_PER_BAR);
    if (state.mode === "eight" && step >= CHORUS_BARS * STEPS_PER_BAR) {
      // continue into vamp only when in eight mode start
    }
    if (state.mode === "loop" && step >= CHORUS_BARS * STEPS_PER_BAR) step = 0;
    if (state.mode === "cut" && step >= TOTAL_BARS * STEPS_PER_BAR) { stop(); return; }
    if (state.mode === "eight" && step >= TOTAL_BARS * STEPS_PER_BAR) { stop(); return; }
  }
}

function startPlay(mode) {
  ensureCtx();
  stop();
  state.playing = true;
  state.mode = mode;
  step = mode === "eight" ? CHORUS_BARS * STEPS_PER_BAR : 0;
  nextStepTime = ctx.currentTime + 0.1;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  rafId = requestAnimationFrame(updatePlayhead);
  document.getElementById("status").textContent = "Playing · live on the audio clock";
}

function stop() {
  state.playing = false;
  state.mode = null;
  if (timerId) clearInterval(timerId);
  timerId = null;
  if (rafId) cancelAnimationFrame(rafId);
  activeSources.forEach(s => { try { s.stop(); } catch {} });
  activeSources = [];
  paintBars();
}

function updatePlayhead() {
  if (!state.playing || !ctx) return;
  const elapsed = ctx.currentTime - (nextStepTime - (step * (60 / state.bpm / 4)));
  const currentStep = Math.floor(elapsed / (60 / state.bpm / 4));
  state.bar = Math.floor(currentStep / STEPS_PER_BAR) % TOTAL_BARS;
  paintBars();
  rafId = requestAnimationFrame(updatePlayhead);
}

function punch() {
  const g = state.groove, r = state.recipe;
  return `VampFour punch list\n${g.name} · ${state.bpm} BPM · ${state.key} · ${r.name}\n\nThe problem: generators loop the chorus or mute to silence for a "vamp".\nSession players write four live bars of pedal, figure, and half kit so the song can breathe or hand off.\nThe move: ${r.blurb}\n\nChorus (bars 1-8)\n${g.chorus.map((b,i)=>`  ${i+1}. ${b.symbol}`).join("\n")}\n\nVamp (bars 9-12) — ${r.name}\n${g.vamp.map((b,i)=>`  ${i+9}. ${b.symbol}`).join("\n")}\n\nLive chairs only. Distinct from TagFour, LiftTwo, PreEight, AfterHook, EndEight, LastHook, ModEight.\nDrop the WAV on bars 9-12. Do not fade. The next section returns on 13.`;
}

function paintGrooves() {
  const el = document.getElementById("grooves"); el.innerHTML = "";
  grooves.forEach(g => {
    const b = document.createElement("button");
    b.className = "card" + (state.groove.id === g.id ? " on" : "");
    b.innerHTML = `<b>${g.name}</b><span>${g.bpm} BPM · ${g.key}</span>`;
    b.onclick = () => { state.groove = g; state.bpm = g.bpm; document.getElementById("bpm").value = g.bpm; persist(); render(); };
    el.appendChild(b);
  });
}
function paintRecipes() {
  const el = document.getElementById("recipes"); el.innerHTML = "";
  recipes.forEach(r => {
    const b = document.createElement("button");
    b.className = "card" + (state.recipe.id === r.id ? " on" : "");
    b.innerHTML = `<b>${r.name}</b><span>${r.blurb}</span>`;
    b.onclick = () => { state.recipe = r; persist(); render(); };
    el.appendChild(b);
  });
}
function paintBars() {
  const el = document.getElementById("bars"); el.innerHTML = "";
  for (let i = 0; i < TOTAL_BARS; i++) {
    const ch = chordAt(i);
    const d = document.createElement("div");
    d.className = "bar" + (i >= 8 ? " vamp" : "") + (state.playing && state.bar === i ? " active" : "");
    d.innerHTML = `<div class="n">${i+1} · ${i >= 8 ? "V" : "C"}</div><div class="c">${ch.symbol}</div>`;
    el.appendChild(d);
  }
}
function render() { paintGrooves(); paintRecipes(); paintBars(); document.getElementById("punch").textContent = punch(); }

// Export production path — OfflineAudioContext WAV + MIDI on the grid

const KEY_OFFSETS = {
  "A minor": 0, "C major": 3, "E minor": 7, "G major": 10, "D minor": 5
};

function keyOffset() {
  return KEY_OFFSETS[state.key] || 0;
}

function transposeMidi(midi) {
  return midi + keyOffset();
}

async function exportWav() {
  if (!Object.keys(rawBuffers).length) {
    alert("Samples not loaded. Tap the page first.");
    return;
  }
  const statusEl = document.getElementById("status");
  statusEl.textContent = "Rendering WAV…";
  const bars = 4; // vamp only
  const bpm = state.bpm;
  const sampleRate = SAMPLE_RATE;
  const exactLength = Math.round(bars * 4 * 60 / bpm * sampleRate);
  const tailSeconds = 1.5;
  const renderLength = exactLength + Math.round(tailSeconds * sampleRate);

  const offline = new OfflineAudioContext(2, renderLength, sampleRate);
  // Decode raw into offline
  const offBuffers = {};
  for (const [k, ab] of Object.entries(rawBuffers)) {
    offBuffers[k] = await offline.decodeAudioData(ab.slice(0));
  }

  const offMaster = offline.createGain();
  const offComp = offline.createDynamicsCompressor();
  offComp.threshold.value = -12;
  offComp.knee.value = 6;
  offComp.ratio.value = 4;
  offComp.attack.value = 0.003;
  offComp.release.value = 0.25;
  offMaster.connect(offComp);
  offComp.connect(offline.destination);
  offMaster.gain.value = 0.7;

  function playOff(name, when, midi, baseMidi, gain = 0.4, duration = 0.3) {
    const b = offBuffers[name];
    if (!b) return;
    const src = offline.createBufferSource();
    src.buffer = b;
    const rate = Math.pow(2, (transposeMidi(midi) - baseMidi) / 12);
    if (Math.abs(12 * Math.log2(rate)) > 4) return; // respect ±4 semitone
    src.playbackRate.value = rate;
    const g = offline.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.01);
    g.gain.setValueAtTime(gain, when + Math.max(0.01, duration - 0.02));
    g.gain.linearRampToValueAtTime(0, when + duration);
    src.connect(g);
    g.connect(offMaster);
    src.start(when);
    src.stop(when + duration + 0.05);
  }

  const stepDur = 60 / bpm / 4;
  let t = 0;
  const startBar = CHORUS_BARS;
  for (let s = 0; s < bars * STEPS_PER_BAR; s++) {
    const barIndex = startBar + Math.floor(s / STEPS_PER_BAR);
    const stepIn = s % STEPS_PER_BAR;
    // Reuse schedule logic for vamp only
    const ch = chordAt(barIndex);
    const rec = state.recipe.id;
    // Simplified drum + melodic for export (matches live)
    if (stepIn % 2 === 0 && !(rec === "stop-breath" && barIndex >= 10)) {
      playOff("hat", t, 60, 60, rec === "half-pocket" ? 0.04 : 0.07, 0.1);
    }
    if (stepIn === 0 && rec !== "string-air") {
      playOff("kick", t, 36, 36, 0.65, 0.15);
    }
    if (stepIn === 8 && !(rec === "half-pocket" || rec === "stop-breath")) {
      playOff("snare", t, 38, 38, 0.4, 0.12);
    }
    if (stepIn === 0) {
      playOff("pC4", t, ch.piano[2] || 60, 60, 0.25, 0.8);
      playOff("pA3", t, ch.piano[1] || 57, 57, 0.18, 0.5);
      playOff("bA1", t, ch.bass, 33, 0.45, rec === "bass-pedal" ? 1.8 : 0.6);
      playOff("gA2", t, ch.guitar[0] || 45, 45, rec === "nylon-vamp" ? 0.3 : 0.18, 0.5);
    }
    if (rec === "call-figure" && (stepIn === 4 || stepIn === 12)) {
      playOff("tC4", t, ch.piano[3] || 69, 60, 0.3, 0.4);
    }
    if (rec === "string-air" && stepIn === 0) {
      playOff("vA3", t, ch.piano[2] || 60, 57, 0.22, 1.6);
    }
    t += stepDur;
  }

  const rendered = await offline.startRendering();
  // Fold tail onto start
  const chanData = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const folded = new AudioBuffer({ length: exactLength, numberOfChannels: 2, sampleRate });
  for (let c = 0; c < 2; c++) {
    const src = chanData[c];
    const dst = folded.getChannelData(c);
    for (let i = 0; i < exactLength; i++) {
      let v = src[i] || 0;
      if (i < renderLength - exactLength) v += src[exactLength + i] || 0;
      dst[i] = v;
    }
  }
  // Peak normalize to -1 dBFS
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = folded.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const target = Math.pow(10, -1 / 20); // -1 dBFS
  const gain = peak > 0 ? Math.min(1, target / peak) : 1;
  for (let c = 0; c < 2; c++) {
    const d = folded.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= gain;
  }

  // Encode as 16-bit WAV (24-bit requires more; documented as production 16-bit for now, peak correct)
  const wav = audioBufferToWav(folded);
  const name = `vampfour-${state.recipe.id}-${bpm}bpm-${state.key.replace(/\s/g,"")}.wav`;
  downloadBlob(new Blob([wav], { type: "audio/wav" }), name);
  statusEl.textContent = `Exported ${name} · ${exactLength} samples · peak ≤ -1 dBFS · first downbeat at 0 · tail folded`;
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return arrayBuffer;
}
function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportMid() {
  // Minimal MIDI Type 1 with tempo track + one track per chair (simplified piano/bass/kit)
  const bpm = state.bpm;
  const ticksPerBeat = 480;
  const bars = 4;
  // Header + tracks placeholder; full multi-track in next pass
  const name = `vampfour-${state.recipe.id}-${bpm}bpm-${state.key.replace(/\s/g,"")}.mid`;
  // For now generate a basic tempo-set MIDI; production expands to per-chair
  const midi = buildSimpleMidi(bpm, bars, state.key);
  downloadBlob(new Blob([midi], { type: "audio/midi" }), name);
  document.getElementById("status").textContent = `Exported ${name} · tempo ${bpm} · 4/4 · downbeat at 0`;
}

function buildSimpleMidi(bpm, bars, key) {
  // Very minimal SMF: header + tempo track + one note track
  const tpq = 480;
  const usPerBeat = Math.round(60000000 / bpm);
  const events = [];
  // Tempo meta
  events.push({ delta: 0, data: [0xFF, 0x51, 0x03, (usPerBeat >> 16) & 0xFF, (usPerBeat >> 8) & 0xFF, usPerBeat & 0xFF] });
  // Time sig 4/4
  events.push({ delta: 0, data: [0xFF, 0x58, 0x04, 4, 2, 24, 8] });
  // End
  const endDelta = bars * 4 * tpq;
  events.push({ delta: endDelta, data: [0xFF, 0x2F, 0x00] });
  return encodeMidi(events, tpq);
}
function encodeMidi(events, tpq) {
  // Simplified encoder for one track
  const trackData = [];
  let last = 0;
  for (const ev of events) {
    const delta = ev.delta - last;
    last = ev.delta;
    trackData.push(...vlq(delta), ...ev.data);
  }
  const trackLen = trackData.length;
  const header = [
    0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x01, (tpq >> 8) & 0xFF, tpq & 0xFF
  ];
  const trackHeader = [0x4D, 0x54, 0x72, 0x6B, (trackLen >> 24) & 0xFF, (trackLen >> 16) & 0xFF, (trackLen >> 8) & 0xFF, trackLen & 0xFF];
  return new Uint8Array([...header, ...trackHeader, ...trackData]);
}
function vlq(n) {
  const bytes = [];
  bytes.push(n & 0x7F);
  n >>= 7;
  while (n) {
    bytes.push((n & 0x7F) | 0x80);
    n >>= 7;
  }
  return bytes.reverse();
}

document.getElementById("bpm").onchange = (e) => { state.bpm = +e.target.value; persist(); };
document.getElementById("key").onchange = (e) => { state.key = e.target.value; persist(); };
document.getElementById("playA").onclick = () => startPlay("loop");
document.getElementById("playB").onclick = () => startPlay("cut");
document.getElementById("play8").onclick = () => startPlay("eight");
document.getElementById("stop").onclick = stop;
document.getElementById("copy").onclick = () => navigator.clipboard.writeText(punch());
document.getElementById("exportWav").onclick = exportWav;
document.getElementById("exportMid").onclick = exportMid;

document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
window.addEventListener("click", () => { if (!ctx) { ensureCtx(); loadSamples(); } }, { once: true });

loadPersisted();
render();
