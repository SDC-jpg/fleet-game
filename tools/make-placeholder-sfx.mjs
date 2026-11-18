// Generates placeholder sound effects as WAV files in public/assets/sfx/.
// Simple retro synth sounds (beeps, noise bursts, sweeps), meant to be replaced.
//
//   npm run make-sfx            -> only creates files that don't exist yet
//   npm run make-sfx -- --force -> overwrites everything (careful: replaces your sounds!)
//
// No libraries needed: this file includes a tiny WAV writer.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../public/assets/sfx/', import.meta.url));
const FORCE = process.argv.includes('--force');
const RATE = 44100;

// ---------- Tiny WAV writer (16-bit mono) ----------
function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per sample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ---------- Synth building blocks ----------

// Deterministic random numbers, so the sounds are the same every run.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wave = {
  sine: (p) => Math.sin(p * 2 * Math.PI),
  square: (p) => ((p % 1) < 0.5 ? 1 : -1),
  pulse: (p) => ((p % 1) < 0.25 ? 1 : -1),
  saw: (p) => 2 * (p % 1) - 1,
  triangle: (p) => 1 - 4 * Math.abs((p % 1) - 0.5),
};

/** An oscillator whose frequency can change over time: call it once per sample. */
function oscillator(type) {
  let phase = 0;
  return (freq) => {
    phase += freq / RATE;
    return wave[type](phase);
  };
}

/** One-pole low-pass filter (smooths out highs): call once per sample. */
function lowpass() {
  let y = 0;
  return (x, cutoff) => {
    y += (1 - Math.exp((-2 * Math.PI * cutoff) / RATE)) * (x - y);
    return y;
  };
}

/** Sweep from a to b over progress k (0–1), on a curve that sounds even to the ear. */
const sweep = (a, b, k) => a * (b / a) ** k;

/** Make `seconds` of sound; `fn(t, k)` gets time and progress (0–1) and returns a sample. */
function render(seconds, fn) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, i / n);
  // Normalise loudness and fade the last few ms to avoid a click.
  const peak = out.reduce((m, s) => Math.max(m, Math.abs(s)), 1e-6);
  const fade = Math.min(n, Math.round(0.005 * RATE));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.9 * Math.min(1, (n - i) / fade);
  return out;
}

/**
 * Make a seamless loop of `seconds`: renders a little extra and blends that
 * tail into the start, so the end runs straight into the beginning with no click.
 */
function renderLoop(seconds, fn, blend = 0.3) {
  const n = Math.round(seconds * RATE);
  const b = Math.round(blend * RATE);
  const raw = new Float32Array(n + b);
  for (let i = 0; i < n + b; i++) raw[i] = fn(i / RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i < b ? raw[i] * (i / b) + raw[n + i] * (1 - i / b) : raw[i];
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.9;
  return out;
}

/** Quick attack, then exponential fade (`speed` higher = shorter). */
const decay = (t, speed, attack = 0.003) => Math.min(1, t / attack) * Math.exp(-t * speed);

// ---------- The sounds ----------

function shoot() {
  const osc = oscillator('pulse');
  return render(0.09, (t, k) => osc(sweep(1400, 450, k)) * decay(t, 30));
}

function shootEnemy() {
  const osc = oscillator('saw');
  const lp = lowpass();
  return render(0.12, (t, k) => lp(osc(sweep(620, 200, k)), 2500) * decay(t, 22));
}

function hit() {
  const r = rng(3);
  const lp = lowpass();
  const blip = oscillator('square');
  return render(0.06, (t) => {
    const n = r() * 2 - 1;
    return ((n - lp(n, 1500)) * 0.8 + blip(1800) * 0.3) * decay(t, 70);
  });
}

/** Explosions get longer and deeper with tier. */
function explosion(tier = 1) {
  const r = rng(10 + tier);
  const lp = lowpass();
  const thump = oscillator('sine');
  const length = [0.45, 0.7, 1.0, 1.4][tier - 1];
  const low = 0.8 ** (tier - 1);
  let held = 0;
  return render(length, (t, k) => {
    // Crunchy noise: hold each random value for a few samples (retro "bitcrush").
    if (Math.floor(t * RATE) % 3 === 0) held = r() * 2 - 1;
    const noise = lp(held, sweep(3500 * low, 150 * low, k));
    const boom = thump(sweep(110 * low, 30 * low, k)) * Math.exp(-t * 6 / length);
    return (noise * 1.2 + boom) * decay(t, 4.5 / length, 0.002);
  });
}

/** The ship you fly blowing up: a sharp crack, a long deep boom, and crackling debris fading out. Deeper for bigger tiers. */
function flagshipExplosion(tier = 1) {
  const r = rng(300 + tier);
  const lp = lowpass();
  const lp2 = lowpass();
  const thump = oscillator('sine');
  const sub = oscillator('sine');
  const length = 2.2 + 0.3 * (tier - 1);
  const low = 0.85 ** (tier - 1);
  let held = 0;
  return render(length, (t, k) => {
    if (Math.floor(t * RATE) % 4 === 0) held = r() * 2 - 1;
    const crack = (r() * 2 - 1) * Math.exp(-t * 30) * 0.9;
    const roar = lp(held, sweep(4000 * low, 120 * low, Math.min(1, k * 1.5))) * Math.exp(-t * 1.6);
    const boom = thump(sweep(90 * low, 25 * low, Math.min(1, k * 2))) * Math.exp(-t * 2.2) * 1.2;
    const rumble = sub(32 * low) * Math.exp(-t * 1.2) * 0.5;
    // Crackles: random pops while the debris flies.
    const crackle = t > 0.3 && r() < 0.004 ? (r() * 2 - 1) * 2 * Math.exp(-(t - 0.3) * 1.5) : 0;
    return (crack + roar * 1.1 + boom + rumble + lp2(crackle, 3000)) * decay(t, 0.8 / length, 0.001);
  });
}

/** Point Defense Cannon: a tiny dry tick (played for some of the many shots). */
function pdc() {
  const r = rng(808);
  const lp = lowpass();
  return render(0.03, (t) => (lp(r() * 2 - 1, 5000) * 0.8 + Math.sin(t * 2 * Math.PI * 2400) * 0.3) * decay(t, 140, 0.0005));
}

/** Time Dilation: a falling, slowing "wooo" with a soft shimmer, like time winding down. */
function timeDilation() {
  const osc = oscillator('triangle');
  const shimmer = oscillator('sine');
  return render(1.1, (t, k) => {
    const f = sweep(700, 110, Math.min(1, k * 1.3));
    return (osc(f) * 0.7 + shimmer(f * 3.01) * 0.15) * decay(t, 2.2, 0.02);
  });
}

function recruit() {
  const osc = oscillator('square');
  const notes = [660, 880, 1320];
  return render(0.3, (t) => {
    const i = Math.min(notes.length - 1, Math.floor(t / 0.08));
    return osc(notes[i]) * decay(t - i * 0.08, 18) * 0.6;
  });
}

function merge() {
  const charge = oscillator('saw');
  const lp = lowpass();
  const r = rng(77);
  const chord = [oscillator('triangle'), oscillator('triangle'), oscillator('triangle')];
  const hitAt = 0.55;
  return render(1.0, (t) => {
    if (t < hitAt) {
      // Rising charge-up with a wobble.
      const k = t / hitAt;
      const f = sweep(150, 900, k) * (1 + 0.03 * Math.sin(t * 2 * Math.PI * 18));
      return lp(charge(f), sweep(400, 4000, k)) * k * 0.7;
    }
    // Flash: a bright burst and a chord ringing out.
    const u = t - hitAt;
    const burst = (r() * 2 - 1) * Math.exp(-u * 25);
    const ring = (chord[0](440) + chord[1](660) + chord[2](880)) / 3;
    return burst * 0.8 + ring * Math.exp(-u * 6);
  });
}

function boost() {
  const r = rng(5);
  const lp = lowpass();
  return render(0.4, (t, k) => lp(r() * 2 - 1, sweep(400, 2500, Math.min(1, k * 1.5))) * decay(t, 6, 0.05));
}

/** Engine hum (loop) while the ship you fly moves: a soft, low rumble with a faint drone. */
function engineMove() {
  const r = rng(61);
  const lp = lowpass();
  const lp2 = lowpass();
  const hum = oscillator('sine');
  return renderLoop(2, (t) => {
    const rumble = lp2(lp(r() * 2 - 1, 260), 180) * 3;
    const wobble = 1 + 0.08 * Math.sin(t * 2 * Math.PI * 3);
    return (rumble * 0.8 + hum(58) * 0.25) * wobble;
  });
}

/** Laser sear (looping): an energy beam burning something: bright crackling hiss over a buzzing tone. */
function laserSear() {
  const r = rng(73);
  const hp = lowpass();
  const buzz = oscillator('square');
  return renderLoop(1, (t) => {
    const hiss = r() * 2 - 1 - hp(r() * 2 - 1, 1800);
    const crackle = r() < 0.02 ? (r() * 2 - 1) * 2 : 0;
    const tone = buzz(240 + 12 * Math.sin(t * 2 * Math.PI * 9)) * 0.18;
    return (hiss * 0.5 + crackle + tone) * (0.85 + 0.15 * Math.sin(t * 2 * Math.PI * 23));
  });
}

/** Dash: a quick "fwoosh" of noise that opens up, plus a rising zip. */
function dash() {
  const r = rng(21);
  const lp = lowpass();
  const zip = oscillator('triangle');
  return render(0.45, (t, k) => {
    const open = k < 0.25 ? sweep(500, 6000, k / 0.25) : sweep(6000, 300, (k - 0.25) / 0.75);
    const air = lp(r() * 2 - 1, open) * 1.4;
    const tone = zip(sweep(220, 1100, Math.min(1, k * 3))) * Math.exp(-t * 12) * 0.5;
    return (air + tone) * decay(t, 7, 0.01);
  });
}

/** Laser: a bright, buzzing zap that drops in pitch. */
function laser() {
  const a = oscillator('saw'), b = oscillator('square');
  return render(0.32, (t, k) => (a(sweep(1800, 400, k)) * 0.7 + b(sweep(1810, 405, k)) * 0.3) * decay(t, 8));
}

/** Missile launch: a muffled "thump", like a missile pushed out of a tube. */
function missile() {
  const r = rng(41);
  const lp = lowpass();
  const thump = oscillator('sine');
  return render(0.2, (t, k) => {
    const puff = lp(r() * 2 - 1, 500) * decay(t, 30, 0.002) * 0.6;
    return thump(sweep(130, 45, k)) * decay(t, 22, 0.002) + puff;
  });
}

/** Missile firing up: a quick rising whoosh with a little crackle. */
function missileIgnite() {
  const r = rng(43);
  const lp = lowpass();
  let held = 0;
  return render(0.22, (t, k) => {
    if (Math.floor(t * RATE) % 4 === 0) held = r() * 2 - 1;
    const whoosh = lp(held, sweep(500, 5000, Math.min(1, k * 2)));
    return whoosh * Math.min(1, t / 0.03) * Math.exp(-Math.max(0, t - 0.05) * 14);
  });
}

/** Missile impact: a small, short pop (much lighter than a ship exploding). */
function missileHit() {
  const r = rng(47);
  const lp = lowpass();
  const pop = oscillator('sine');
  return render(0.22, (t, k) => lp(r() * 2 - 1, sweep(4500, 700, k)) * decay(t, 18, 0.001) + pop(sweep(240, 80, k)) * Math.exp(-t * 25) * 0.7);
}

/** Mine dropped: a short metallic clunk-beep. */
function mineDrop() {
  const a = oscillator('square'), b = oscillator('sine');
  return render(0.18, (t) => (b(160) * Math.exp(-t * 40) + (t > 0.06 ? a(1320) * Math.exp(-(t - 0.06) * 30) * 0.4 : 0)));
}

/** Mine blast: a sharp bang with a short rumble. */
function mineBlast() {
  const r = rng(61);
  const lp = lowpass();
  const boom = oscillator('sine');
  return render(0.55, (t, k) => lp(r() * 2 - 1, sweep(5000, 300, k)) * decay(t, 7, 0.002) + boom(sweep(120, 40, k)) * Math.exp(-t * 9) * 0.8);
}

/** Shield: a soft rising shimmer (three notes with a wobble). */
function shield() {
  const a = oscillator('triangle'), b = oscillator('triangle'), c = oscillator('sine');
  return render(0.6, (t, k) => {
    const wob = 1 + 0.15 * Math.sin(t * 2 * Math.PI * 18);
    const up = sweep(1, 1.5, Math.min(1, k * 2));
    return (a(330 * up) + b(495 * up) * 0.7 + c(660 * up) * 0.5) * wob * decay(t, 4, 0.06);
  });
}

/** Repulse: a deep "whoomp" that swells outward. */
function repulse() {
  const r = rng(71);
  const lp = lowpass();
  const low = oscillator('sine');
  return render(0.5, (t, k) => low(sweep(90, 45, k)) * decay(t, 6, 0.02) + lp(r() * 2 - 1, sweep(300, 1800, k)) * decay(t, 7, 0.05) * 0.6);
}

/** Freeze: a glassy, falling shimmer with a crackle. */
function freeze() {
  const r = rng(81);
  const a = oscillator('sine'), b = oscillator('sine');
  return render(0.7, (t, k) => {
    const shimmer = (a(sweep(2400, 900, k)) + b(sweep(3200, 1200, k)) * 0.6) * (0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 30));
    const crackle = r() > 0.97 ? (r() * 2 - 1) * Math.exp(-t * 6) : 0;
    return shimmer * decay(t, 4, 0.01) * 0.6 + crackle;
  });
}

/** Item picked up: a quick bright sparkle (rising arpeggio). */
function loot() {
  const osc = oscillator('triangle');
  const notes = [880, 1109, 1319, 1760];
  return render(0.5, (t) => {
    const n = Math.min(notes.length - 1, Math.floor(t / 0.07));
    const local = t - n * 0.07;
    return osc(notes[n]) * Math.exp(-local * 10) * (t < 0.28 ? 1 : Math.exp(-(t - 0.28) * 12));
  });
}

/** Level up: a bright rising fanfare. */
function levelUp() {
  const a = oscillator('square'), b = oscillator('triangle');
  const notes = [523, 659, 784, 1047];
  return render(0.75, (t) => {
    const n = Math.min(notes.length - 1, Math.floor(t / 0.09));
    const local = t - n * 0.09;
    const fade = n === notes.length - 1 ? Math.exp(-local * 5) : 1;
    return (a(notes[n]) * 0.35 + b(notes[n] * 2) * 0.4) * fade * Math.min(1, local / 0.004);
  });
}

/** Card picked: a crisp two-tone click. */
function card() {
  const a = oscillator('triangle');
  return render(0.16, (t) => a(t < 0.05 ? 880 : 1320) * Math.exp(-t * 18));
}

function alert() {
  const osc = oscillator('square');
  return render(0.72, (t) => {
    const beep = Math.floor(t / 0.12);
    const inBeep = t - beep * 0.12;
    return osc(beep % 2 ? 660 : 880) * (inBeep < 0.1 ? 1 : 0) * 0.5;
  });
}

/** Swarm incoming: a short two-pulse klaxon (a low, buzzy siren rising and falling). */
function swarm() {
  const osc = oscillator('saw');
  const lp = lowpass();
  return render(0.8, (t) => {
    const pulse = Math.floor(t / 0.4);
    const k = (t - pulse * 0.4) / 0.4;
    const f = 330 + 200 * Math.sin(Math.PI * k);
    return lp(osc(f), 2200) * Math.min(1, k * 20) * (1 - k) ** 0.5 * 0.5;
  });
}

/** Reinforcements: a bright rising two-part call (the good news counterpart of the alert). */
function reinforcements() {
  const a = oscillator('triangle'), b = oscillator('square');
  const notes = [392, 523, 659, 784, 659, 1047];
  return render(1.0, (t) => {
    const n = Math.min(notes.length - 1, Math.floor(t / 0.12));
    const local = t - n * 0.12;
    const fade = n === notes.length - 1 ? Math.exp(-local * 3.5) : 1;
    return (a(notes[n]) * 0.45 + b(notes[n] / 2) * 0.15) * fade * Math.min(1, local / 0.006);
  });
}

/** Gatling bolt: a tiny, quick zap (plays for every bolt, so it's short and quiet). */
function gatling() {
  const a = oscillator('square');
  return render(0.05, (t, k) => a(sweep(2400, 1200, k)) * decay(t, 60) * 0.6);
}

/** Crescent Strike: an airy rising whoosh with a bright ring. */
function crescent() {
  const r = rng(71);
  const lp = lowpass();
  const ring = oscillator('sine');
  return render(0.35, (t, k) => lp(r() * 2 - 1, sweep(800, 4000, k)) * decay(t, 7, 0.03) * 0.7 + ring(sweep(900, 1400, k)) * decay(t, 10) * 0.3);
}

/** Arc Impulse: a crackling electric snap. */
function arc() {
  const r = rng(83);
  const buzz = oscillator('saw');
  return render(0.25, (t) => ((r() < 0.3 ? r() * 2 - 1 : 0) * 0.8 + buzz(120 + 40 * Math.sin(t * 200)) * 0.3) * decay(t, 12, 0.001));
}

/** Ion Cloud launch: a soft bubbly burble. */
function ionCloud() {
  const a = oscillator('sine');
  return render(0.3, (t) => a(500 + 300 * Math.sin(t * 2 * Math.PI * 25)) * decay(t, 9, 0.01) * 0.7);
}

/** Ion ball popping: a small, high blip. */
function ionPop() {
  const a = oscillator('triangle');
  return render(0.08, (t, k) => a(sweep(1600, 700, k)) * decay(t, 40));
}

/** Plasma Lance: an ignition hum that swells and fades. */
function plasmaLance() {
  const a = oscillator('saw'), b = oscillator('sine');
  const lp = lowpass();
  return render(0.6, (t, k) => lp(a(110) * 0.6 + b(220), sweep(300, 2500, Math.min(1, k * 4))) * Math.min(1, t / 0.05) * Math.exp(-t * 4) * 0.7);
}

/** Splitting Beam: a bright zap that forks (two tones peeling apart). */
function splitBeam() {
  const a = oscillator('square'), b = oscillator('square');
  return render(0.22, (t, k) => (a(sweep(1500, 900, k)) + b(sweep(1500, 2100, k))) * 0.35 * decay(t, 14));
}

/** Laser Pods launch: three soft pops in a row. */
function pods() {
  const a = oscillator('sine');
  return render(0.3, (t) => {
    const i = Math.floor(t / 0.08);
    return a(300 + i * 80) * decay(t - i * 0.08, 30) * (i < 3 ? 1 : 0);
  });
}

/** Pod shot: a very short, thin "tik". */
function podShot() {
  const a = oscillator('triangle');
  return render(0.04, (t, k) => a(sweep(3000, 2000, k)) * decay(t, 80));
}

/** Gravity Well: a deep falling "whoom". */
function gravityWell() {
  const a = oscillator('sine'), b = oscillator('saw');
  const lp = lowpass();
  return render(0.9, (t, k) => (a(sweep(160, 50, k)) + lp(b(sweep(80, 30, k)), 400) * 0.4) * Math.min(1, t / 0.08) * Math.exp(-t * 3) * 0.8);
}

/** Scramble: a glitchy burst of stuttering noise and blips. */
function scramble() {
  const r = rng(97);
  const a = oscillator('square');
  return render(0.4, (t) => {
    const step = Math.floor(t / 0.03);
    const on = rng(step + 5)() < 0.6 ? 1 : 0;
    return ((r() * 2 - 1) * 0.5 + a(400 + (step % 5) * 220) * 0.4) * on * decay(t, 5, 0.005);
  });
}

/** Wrecksplosion: a heavy, crunchy blast with metal debris rattling. */
function wrecksplosion() {
  const r = rng(113);
  const lp = lowpass();
  const boom = oscillator('sine');
  return render(0.8, (t, k) => {
    const noise = lp(r() * 2 - 1, sweep(4000, 200, k)) * decay(t, 5, 0.002);
    const rattle = (r() < 0.08 ? r() * 2 - 1 : 0) * decay(t, 8) * 0.6;
    return noise * 0.8 + boom(sweep(90, 35, k)) * decay(t, 6) * 0.8 + rattle;
  });
}

/** Tractor beam: a rising hum, like a beam taking hold. */
function tractorBeam() {
  const a = oscillator('triangle'), b = oscillator('sine');
  return render(0.45, (t, k) => (a(sweep(200, 600, k)) * 0.5 + b(sweep(400, 1200, k)) * 0.3) * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 30)) * decay(t, 4, 0.03));
}

/** Force wall: a glassy shimmer swelling up. */
function forceWall() {
  const a = oscillator('sine'), b = oscillator('sine');
  return render(0.5, (t, k) => (a(1200) + b(1800 + 40 * Math.sin(t * 60))) * 0.3 * Math.min(1, t / 0.1) * Math.exp(-t * 5));
}

/** A shot stopped by a force wall: a short glassy "tink". */
function forceWallHit() {
  const a = oscillator('sine');
  return render(0.12, (t) => a(2600) * decay(t, 35));
}

/** Cloak: a breathy falling whoosh that fades to nothing. */
function cloak() {
  const r = rng(127);
  const lp = lowpass();
  return render(0.6, (t, k) => lp(r() * 2 - 1, sweep(5000, 300, k)) * Math.min(1, t / 0.05) * (1 - k) * 0.7);
}

/** Hijack: a wobbling, warbly pulse. */
function hijack() {
  const a = oscillator('square');
  const lp = lowpass();
  return render(0.55, (t, k) => lp(a(sweep(300, 700, k) * (1 + 0.15 * Math.sin(t * 2 * Math.PI * 14))), 1800) * decay(t, 4, 0.01) * 0.6);
}

function command() {
  const osc = oscillator('triangle');
  const notes = [523, 392, 659];
  return render(0.5, (t) => {
    const i = Math.min(notes.length - 1, Math.floor(t / 0.14));
    return osc(notes[i]) * decay(t - i * 0.14, i === notes.length - 1 ? 6 : 12);
  });
}

function gameOver() {
  const osc = oscillator('square');
  const lp = lowpass();
  const notes = [523, 440, 349, 262];
  return render(1.4, (t) => {
    const i = Math.min(notes.length - 1, Math.floor(t / 0.25));
    const speed = i === notes.length - 1 ? 2.5 : 8;
    return lp(osc(notes[i]), 1800) * decay(t - i * 0.25, speed);
  });
}

// ---------- Write files ----------
const FILES = {
  'shoot.wav': shoot,
  'shoot-enemy.wav': shootEnemy,
  'hit.wav': hit,
  'explosion.wav': () => explosion(1),
  'explosion-t2.wav': () => explosion(2),
  'explosion-t3.wav': () => explosion(3),
  'explosion-t4.wav': () => explosion(4),
  'flagship-explosion.wav': () => flagshipExplosion(1),
  'flagship-explosion-t2.wav': () => flagshipExplosion(2),
  'flagship-explosion-t3.wav': () => flagshipExplosion(3),
  'flagship-explosion-t4.wav': () => flagshipExplosion(4),
  'recruit.wav': recruit,
  'merge.wav': merge,
  'boost.wav': boost,
  'dash.wav': dash,
  'laser.wav': laser,
  'missile.wav': missile,
  'missile-ignite.wav': missileIgnite,
  'missile-hit.wav': missileHit,
  'mine.wav': mineDrop,
  'mine-blast.wav': mineBlast,
  'shield.wav': shield,
  'repulse.wav': repulse,
  'freeze.wav': freeze,
  'levelup.wav': levelUp,
  'card.wav': card,
  'loot.wav': loot,
  'alert.wav': alert,
  'swarm.wav': swarm,
  'reinforcements.wav': reinforcements,
  'gatling.wav': gatling,
  'crescent.wav': crescent,
  'arc.wav': arc,
  'ion-cloud.wav': ionCloud,
  'ion-pop.wav': ionPop,
  'plasma-lance.wav': plasmaLance,
  'split-beam.wav': splitBeam,
  'pods.wav': pods,
  'pod-shot.wav': podShot,
  'gravity-well.wav': gravityWell,
  'scramble.wav': scramble,
  'wrecksplosion.wav': wrecksplosion,
  'tractor-beam.wav': tractorBeam,
  'force-wall.wav': forceWall,
  'force-wall-hit.wav': forceWallHit,
  'cloak.wav': cloak,
  'hijack.wav': hijack,
  'pdc.wav': pdc,
  'engine-move.wav': engineMove,
  'laser-sear.wav': laserSear,
  // The user's choice (2026-11-16): boosting uses the same hum, a little louder (manifest volume).
  'engine-boost.wav': engineMove,
  'time-dilation.wav': timeDilation,
  'command.wav': command,
  'gameover.wav': gameOver,
};

for (const [name, make] of Object.entries(FILES)) {
  const path = join(OUT_DIR, name);
  if (existsSync(path) && !FORCE) {
    console.log(`skip   ${name} (already exists)`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodeWav(make()));
  console.log(`write  sfx/${name}`);
}
