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

function alert() {
  const osc = oscillator('square');
  return render(0.72, (t) => {
    const beep = Math.floor(t / 0.12);
    const inBeep = t - beep * 0.12;
    return osc(beep % 2 ? 660 : 880) * (inBeep < 0.1 ? 1 : 0) * 0.5;
  });
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
  'recruit.wav': recruit,
  'merge.wav': merge,
  'boost.wav': boost,
  'dash.wav': dash,
  'alert.wav': alert,
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
