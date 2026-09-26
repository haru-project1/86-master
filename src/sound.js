// Synthesized sound effects (Web Audio). No audio files; browsers keep the
// context silent until the first user gesture, so unlockSound() runs on input.
// Every voice plays into one mixer — a small dark room, gentle compression and
// a softened top end — so the sounds share a space instead of beeping dry.
// Musical cues use electric-piano, bell and pad voices in D major (Dmaj9 at
// its brightest, B minor for losses); card sounds vary a little every time.
let context = null;
let mixer = null;
let settings = { enabled: true, volume: 0.6 };

export function configureSound(next) {
  settings = { ...settings, ...next };
  if (mixer) mixer.volume.gain.value = settings.volume;
}

function audio() {
  if (!settings.enabled || typeof document === 'undefined' || document.hidden) return null;
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) return null;
  if (!context) {
    context = new AudioContext();
    mixer = createMixer(context);
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context.state === 'running' ? context : null;
}

export function unlockSound() {
  if (!settings.enabled) return;
  audio();
}

// A dark, decaying stereo tail: a small garage at night rather than a hall.
function roomImpulse(ctx, seconds = 1.6) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // The tail loses its highs as it fades, as air absorbs them.
      smooth += (Math.random() * 2 - 1 - smooth) * (0.55 - 0.45 * t);
      data[i] = smooth * (1 - t) ** 3.5;
    }
  }
  return buffer;
}

// dry and send are the inputs: send feeds the room, both meet at the compressor.
export function createMixer(ctx, destination = ctx.destination) {
  const dry = ctx.createGain();
  const send = ctx.createGain();
  const preDelay = ctx.createDelay(0.1);
  preDelay.delayTime.value = 0.015;
  const room = ctx.createConvolver();
  room.buffer = roomImpulse(ctx);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.25;
  const soften = ctx.createBiquadFilter();
  soften.type = 'highshelf';
  soften.frequency.value = 7000;
  soften.gain.value = -4;
  const volume = ctx.createGain();
  volume.gain.value = settings.volume;
  dry.connect(compressor);
  send.connect(preDelay).connect(room).connect(compressor);
  compressor.connect(soften).connect(volume).connect(destination);
  return { dry, send, volume };
}

// The context and mixer of the sound being scheduled; voices read them.
let ctx = null;
let out = null;

const vary = (value, amount) => value * (1 + (Math.random() * 2 - 1) * amount);
// CPU seats on screen: REN left, KAI top, AOI right.
const SEAT_PAN = [0, -0.5, 0, 0.5];
const seatPan = (seat) => SEAT_PAN[seat] || 0;

// Places a voice left–right and sends part of it into the room.
function output(node, { pan = 0, space = 0.2 } = {}) {
  let last = node;
  if (pan && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    last = node.connect(panner);
  }
  last.connect(out.dry);
  if (space > 0) {
    const send = ctx.createGain();
    send.gain.value = space;
    last.connect(send).connect(out.send);
  }
}

function envelope(start, { gain, attack = 0.005, dur }) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  return env;
}

function oscillator(type, freq, start, dur) {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = freq;
  node.start(start);
  node.stop(start + dur + 0.1);
  return node;
}

// A plain sine or triangle, optionally gliding: thumps, knocks and ticks.
function tone({ freq, to, type = 'sine', at = 0, dur = 0.1, gain = 0.1, attack = 0.004, pan = 0, space = 0.15 }) {
  const start = ctx.currentTime + at;
  const node = oscillator(type, freq, start, dur);
  if (to) node.frequency.exponentialRampToValueAtTime(to, start + dur);
  const env = envelope(start, { gain, attack, dur });
  node.connect(env);
  output(env, { pan, space });
}

// Electric piano (FM, 1:1): bright on the strike, mellow as it rings, with a short tine.
function keys({ freq, at = 0, dur = 0.9, gain = 0.06, pan = 0, space = 0.3, bright = 1 }) {
  const start = ctx.currentTime + at;
  const carrier = oscillator('sine', freq, start, dur);
  const modulator = oscillator('sine', freq, start, dur);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(freq * 1.2 * bright, start);
  depth.gain.exponentialRampToValueAtTime(freq * 0.08, start + 0.3);
  modulator.connect(depth).connect(carrier.frequency);
  const body = envelope(start, { gain, attack: 0.003, dur });
  carrier.connect(body);
  output(body, { pan, space });
  const tine = oscillator('sine', freq * 7.1, start, 0.12);
  const ring = envelope(start, { gain: gain * 0.15 * bright, attack: 0.001, dur: 0.1 });
  tine.connect(ring);
  output(ring, { pan, space });
}

// Glassy bell (FM, 3.5:1) for sparkle on top of chords.
function bell({ freq, at = 0, dur = 1.4, gain = 0.025, pan = 0, space = 0.45 }) {
  const start = ctx.currentTime + at;
  const carrier = oscillator('sine', freq, start, dur);
  const modulator = oscillator('sine', freq * 3.5, start, dur);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(freq * 0.9, start);
  depth.gain.exponentialRampToValueAtTime(freq * 0.05, start + dur);
  modulator.connect(depth).connect(carrier.frequency);
  const env = envelope(start, { gain, attack: 0.002, dur });
  carrier.connect(env);
  output(env, { pan, space });
}

// Soft pad: detuned saws under a low-pass that opens as it swells in.
function pad({ freqs, at = 0, dur = 1.8, gain = 0.03, attack = 0.3, cutoff = 1500, space = 0.5 }) {
  const start = ctx.currentTime + at;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(cutoff * 0.4, start);
  filter.frequency.exponentialRampToValueAtTime(cutoff, start + attack + 0.2);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(gain, start + attack);
  env.gain.setValueAtTime(gain, start + dur * 0.55);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  for (const freq of freqs)
    for (const cents of [-7, 7]) oscillator('sawtooth', freq * 2 ** (cents / 1200), start, dur).connect(filter);
  filter.connect(env);
  output(env, { space });
}

// White noise, shared per context; the filters shape it into paper and air.
const noiseBuffers = new WeakMap();
function noiseBuffer() {
  if (!noiseBuffers.has(ctx)) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return noiseBuffers.get(ctx);
}

// Filtered noise: card slides, flips and slaps, intake and air.
function hiss({
  at = 0,
  dur = 0.1,
  gain = 0.1,
  freq = 2000,
  to,
  q = 1,
  type = 'bandpass',
  attack = 0.003,
  pan = 0,
  space = 0.15,
}) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, start);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, start + dur);
  const env = envelope(start, { gain, attack, dur });
  source.connect(filter).connect(env);
  output(env, { pan, space });
  source.start(start, Math.random() * 1.5, dur + 0.05);
}

// Soft clipping gives the engine its growl.
let driveCurve = null;
function drive() {
  if (!driveCurve) {
    driveCurve = new Float32Array(1024);
    for (let i = 0; i < driveCurve.length; i++) {
      const x = (i / (driveCurve.length - 1)) * 2 - 1;
      driveCurve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5);
    }
  }
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve;
  return shaper;
}

// A throttle blip on a flat-four: revs rise fast, then fall back past idle.
// A four-cylinder fires twice per revolution, so the pitch is rpm / 30.
function engine({ at = 0, dur = 0.8, idle = 1100, peak = 5200, gain = 0.09, pan = 0, space = 0.12 }) {
  const start = ctx.currentTime + at;
  const rpm = new Float32Array(48);
  for (let i = 0; i < rpm.length; i++) {
    const t = i / (rpm.length - 1);
    rpm[i] =
      t < 0.3 ? idle + (peak - idle) * (1 - (1 - t / 0.3) ** 2) : peak - (peak - idle * 1.2) * ((t - 0.3) / 0.7) ** 0.6;
  }
  const pitch = (scale) => rpm.map((value) => (value / 30) * scale);
  const shaper = drive();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueCurveAtTime(pitch(5), start, dur);
  const env = envelope(start, { gain, attack: 0.04, dur });
  for (const [type, scale, level] of [
    ['sawtooth', 1, 0.5],
    ['square', 0.5, 0.35],
    ['sawtooth', 2.008, 0.18],
  ]) {
    const node = oscillator(type, (idle / 30) * scale, start, dur);
    node.frequency.setValueCurveAtTime(pitch(scale), start, dur);
    const mix = ctx.createGain();
    mix.gain.value = level;
    node.connect(mix).connect(shaper);
  }
  shaper.connect(filter).connect(env);
  output(env, { pan, space });
  hiss({ at, dur, freq: 900, to: 1400, q: 1.2, gain: gain * 0.25, attack: 0.05, pan, space });
}

// Notes of D major used below.
const N = {
  B2: 123.47,
  D3: 146.83,
  B3: 246.94,
  D4: 293.66,
  Fs4: 369.99,
  A4: 440,
  B4: 493.88,
  Cs5: 554.37,
  D5: 587.33,
  E5: 659.26,
  Fs5: 739.99,
  A5: 880,
  B5: 987.77,
  Cs6: 1108.73,
  D6: 1174.66,
  E6: 1318.51,
  Fs6: 1479.98,
  A6: 1760,
  B6: 1975.53,
  D7: 2349.32,
  E7: 2637.02,
};
const DMAJ9 = [N.D4, N.Fs4, N.A4, N.Cs5, N.E5];
const BM_ADD9 = [N.B3, N.D4, N.Fs4, N.Cs5];

const arpeggio = (freqs, { at = 0, step = 0.09, ...rest } = {}) =>
  freqs.forEach((freq, index) => keys({ freq, at: at + index * step, ...rest }));

const SOUNDS = {
  // Cards: layered paper sounds that differ slightly every time.
  select: () => {
    hiss({ dur: 0.018, freq: vary(3800, 0.08), q: 2.5, gain: vary(0.2, 0.15), space: 0.05 });
    tone({ freq: vary(2350, 0.02), dur: 0.035, gain: 0.02, space: 0.1 });
  },
  deselect: () => hiss({ dur: 0.016, freq: vary(2600, 0.08), q: 2.5, gain: vary(0.13, 0.15), space: 0.05 }),
  draw: () => {
    hiss({ dur: vary(0.14, 0.1), freq: vary(2600, 0.1), to: 1300, q: 0.9, gain: vary(0.14, 0.12), attack: 0.02 });
    hiss({ at: 0.11, dur: 0.02, freq: vary(4200, 0.08), q: 3, gain: 0.08 });
  },
  pickup: () => {
    hiss({ dur: 0.08, freq: vary(3000, 0.1), to: 1600, q: 1, gain: 0.1, attack: 0.01 });
    keys({ freq: N.D6, at: 0.05, dur: 0.6, gain: 0.045, space: 0.35 });
  },
  discard: () => {
    hiss({ dur: vary(0.07, 0.1), freq: vary(1400, 0.1), type: 'lowpass', gain: vary(0.17, 0.1), attack: 0.002 });
    tone({ freq: vary(150, 0.05), to: 75, dur: 0.09, gain: 0.1, space: 0.1 });
  },
  cpuDiscard: ({ seat } = {}) =>
    hiss({
      dur: 0.06,
      freq: vary(1200, 0.1),
      type: 'lowpass',
      gain: vary(0.06, 0.15),
      pan: seatPan(seat),
      space: 0.2,
    }),
  cpuPickup: ({ seat } = {}) =>
    hiss({ dur: 0.035, freq: vary(3000, 0.1), q: 3, gain: vary(0.075, 0.15), pan: seatPan(seat), space: 0.2 }),
  block: () => {
    tone({ freq: 95, to: 48, dur: 0.3, gain: 0.34, space: 0.2 });
    hiss({ dur: 0.15, freq: 500, type: 'lowpass', gain: 0.18 });
    hiss({ at: 0.04, dur: 0.25, freq: 2400, to: 2200, q: 12, gain: 0.04, space: 0.4 });
  },
  scoreUp: ({ delta = 20 } = {}) =>
    arpeggio(delta >= 60 ? [N.D6, N.Fs6, N.A6, N.Cs6 * 2] : [N.D6, N.Fs6], { step: 0.07, dur: 0.8, gain: 0.03 }),
  // A soft lobby chime rather than a beep.
  turn: () => arpeggio([N.A5, N.D6], { step: 0.12, dur: 0.9, gain: 0.04, space: 0.35 }),
  lapUnlock: () => engine({ dur: 0.75, peak: 4800 }),
  finalTurn: () => {
    keys({ freq: N.D4, dur: 1.2, gain: 0.035, bright: 0.6 });
    arpeggio([N.A5, N.E6], { at: 0.02, step: 0.14, dur: 1, gain: 0.04 });
  },
  declare: () => {
    engine({ dur: 0.9, peak: 6200, gain: 0.07 });
    hiss({ at: 0.62, dur: 0.22, freq: 3200, to: 5200, type: 'highpass', gain: 0.015, attack: 0.01 });
    pad({ freqs: DMAJ9, at: 0.7, dur: 1.5, gain: 0.014, attack: 0.15 });
    DMAJ9.forEach((freq) => keys({ freq, at: 0.72, dur: 1.2, gain: 0.014, bright: 0.8 }));
  },
  cpuDeclare: ({ seat } = {}) => {
    engine({ dur: 0.8, peak: 5600, gain: 0.036, pan: seatPan(seat), space: 0.25 });
    pad({ freqs: BM_ADD9, at: 0.55, dur: 1.4, gain: 0.01, attack: 0.2, cutoff: 900 });
    BM_ADD9.forEach((freq) => keys({ freq, at: 0.6, dur: 1.1, gain: 0.009, bright: 0.6 }));
  },
  win: () => {
    arpeggio([N.D5, N.Fs5, N.A5, N.Cs6, N.E6], { step: 0.09, dur: 1.2, gain: 0.032 });
    pad({ freqs: DMAJ9, at: 0.35, dur: 2, gain: 0.02 });
    bell({ freq: N.A6, at: 0.5, gain: 0.015 });
  },
  lose: () => {
    arpeggio([N.Fs5, N.D5, N.B4], { step: 0.18, dur: 1.1, gain: 0.032, bright: 0.7 });
    pad({ freqs: [N.B3, N.D4, N.Fs4, N.A4], at: 0.35, dur: 1.6, gain: 0.015, cutoff: 900 });
  },
  tie: () => {
    [N.A4, N.D5, N.E5].forEach((freq) => keys({ freq, dur: 1.3, gain: 0.03, bright: 0.8 }));
    pad({ freqs: [N.D4, N.A4, N.E5], at: 0.1, dur: 1.6, gain: 0.018 });
  },
  // Timed to the full-screen celebration: the rev, a swell under the title,
  // the chord as it lands (~1s) and one bell per card as the hand fans out.
  master: ({ count = 7 } = {}) => {
    engine({ dur: 0.7, peak: 6800, gain: 0.1 });
    hiss({ at: 0.35, dur: 0.7, freq: 800, to: 6000, type: 'highpass', gain: 0.022, attack: 0.6, space: 0.5 });
    pad({ freqs: DMAJ9, at: 0.4, dur: 3, gain: 0.035, attack: 0.6, cutoff: 1800 });
    tone({ freq: N.D3 / 2, at: 0.95, dur: 1.2, gain: 0.09, attack: 0.01, space: 0.3 });
    [N.D4, N.A4, N.Cs5, N.E5, N.Fs5].forEach((freq) => keys({ freq, at: 0.95, dur: 2, gain: 0.03 }));
    [N.D6, N.E6, N.Fs6, N.A6, N.B6, N.D7, N.E7].slice(0, count).forEach((freq, index) =>
      bell({
        freq,
        at: 1.3 + index * 0.09,
        dur: 1.6,
        gain: 0.02,
        pan: count > 1 ? (index / (count - 1) - 0.5) * 0.9 : 0,
      }),
    );
    bell({ freq: N.D7, at: 2.2, dur: 2, gain: 0.012 });
  },
  error: () => {
    tone({ freq: 220, to: 180, dur: 0.06, gain: 0.03, space: 0.05 });
    tone({ freq: 200, to: 165, at: 0.09, dur: 0.07, gain: 0.025, space: 0.05 });
  },
};

export const SOUND_NAMES = Object.keys(SOUNDS);

// Schedules one sound on a given context and mixer (also used to render offline).
export function scheduleSound(targetContext, targetMixer, name, options) {
  if (!SOUNDS[name]) return;
  ctx = targetContext;
  out = targetMixer;
  try {
    SOUNDS[name](options);
  } finally {
    ctx = null;
    out = null;
  }
}

export function playSound(name, options, delay = 0) {
  const live = audio();
  if (!live || !SOUNDS[name]) return;
  if (delay) setTimeout(() => playSound(name, options), delay);
  else scheduleSound(live, mixer, name, options);
}
