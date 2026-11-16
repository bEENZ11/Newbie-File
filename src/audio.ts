// Sound effects. Explosions, impacts and the interface use recordings from
// Kenney's CC0 sound packs (see public/sounds/CREDITS.md). Gunfire is
// synthesised in the browser, and so is everything else if a recording fails
// to load. Everything here is cosmetic and never touches the game.

export type SoundName =
  | 'rifle'
  | 'cannon'
  | 'blast'
  | 'collapse'
  | 'flame'
  | 'order'
  | 'click'
  | 'placed'
  | 'ready'
  | 'refused'
  | 'victory'
  | 'defeat';

/** The shortest gap between two plays of the same sound, in milliseconds. */
const MIN_GAP: Partial<Record<SoundName, number>> = { rifle: 45, cannon: 70, blast: 80, order: 60, flame: 120 };

/** The recordings for each sound. One is picked at random each time, so repeats do not grate. */
const SAMPLES: Partial<Record<SoundName, { files: string[]; gain: number }>> = {
  blast: { files: ['explosionCrunch_000', 'explosionCrunch_001', 'explosionCrunch_002', 'explosionCrunch_003'], gain: 0.9 },
  collapse: { files: ['lowFrequency_explosion_000', 'lowFrequency_explosion_001'], gain: 1.6 },
  cannon: { files: ['impactMetal_heavy_000', 'impactMetal_heavy_001', 'impactMetal_heavy_002'], gain: 0.7 },
  flame: { files: ['flame'], gain: 0.5 },
  order: { files: ['select_001', 'select_002'], gain: 0.5 },
  click: { files: ['click_001', 'click_002'], gain: 0.6 },
  placed: { files: ['impactPlate_heavy_000', 'impactPlate_heavy_002'], gain: 1.0 },
  ready: { files: ['confirmation_001', 'confirmation_002'], gain: 0.7 },
  refused: { files: ['error_002'], gain: 0.7 },
};

export class Sounds {
  private samples = new Map<string, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SoundName, number>();
  muted = false;

  constructor() {
    // Browsers only allow sound after the player has interacted with the page.
    const start = (): void => this.wake();
    window.addEventListener('mousedown', start);
    window.addEventListener('keydown', start);
  }

  private wake(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
      // One second of white noise, reused for every shot and explosion.
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.load();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Fetches the recordings in the background. Until one arrives, its synthesised stand-in plays. */
  private load(): void {
    const ctx = this.ctx!;
    const names = new Set(Object.values(SAMPLES).flatMap((s) => s.files));
    for (const name of names) {
      fetch(`sounds/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => this.samples.set(name, buffer))
        .catch(() => {
          // No recording: the synthesised sound is used instead.
        });
    }
  }

  /** Plays a recording, at a slightly varied pitch. Returns false if it has not loaded. */
  private sample(name: SoundName, volume: number): boolean {
    const entry = SAMPLES[name];
    if (!entry) return false;
    const buffer = this.samples.get(entry.files[Math.floor(Math.random() * entry.files.length)]);
    if (!buffer) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = ctx.createGain();
    gain.gain.value = entry.gain * volume;
    src.connect(gain).connect(this.master!);
    src.start();
    return true;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /** A burst of filtered noise that fades out: the basis of shots and explosions. */
  private burst(type: BiquadFilterType, from: number, to: number, length: number, volume: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t, Math.random() * 0.5, length);
  }

  /** A pitched note that slides and fades. */
  private tone(wave: OscillatorType, from: number, to: number, length: number, volume: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /** Plays a sound. Volume runs from 0 to 1, for things further from the camera. */
  play(name: SoundName, volume = 1): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running' || volume <= 0) return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < (MIN_GAP[name] ?? 0)) return;
    this.last.set(name, now);
    const v = volume;
    // A tank gun is a recorded clang on top of the synthesised thump. Everything
    // else with a recording plays just that.
    if (this.sample(name, v) && name !== 'cannon') return;
    switch (name) {
      case 'rifle':
        this.burst('highpass', 1800, 900, 0.07, 0.5 * v);
        break;
      case 'cannon':
        this.burst('lowpass', 1400, 200, 0.22, 0.9 * v);
        this.tone('sine', 150, 45, 0.2, 0.8 * v);
        break;
      case 'blast':
        this.burst('lowpass', 900, 80, 0.45, 0.9 * v);
        this.tone('sine', 90, 30, 0.4, 0.7 * v);
        break;
      case 'flame':
        this.burst('bandpass', 900, 500, 0.22, 0.35 * v);
        break;
      case 'collapse':
        this.burst('lowpass', 700, 50, 1.1, 1.0 * v);
        this.tone('sine', 70, 24, 0.9, 0.9 * v);
        break;
      case 'order':
        this.tone('square', 520, 640, 0.06, 0.12 * v);
        break;
      case 'click':
        this.tone('square', 880, 700, 0.04, 0.1 * v);
        break;
      case 'placed':
        this.tone('triangle', 180, 90, 0.18, 0.5 * v);
        this.burst('lowpass', 500, 120, 0.15, 0.3 * v);
        break;
      case 'ready':
        this.tone('triangle', 660, 660, 0.09, 0.25 * v);
        this.tone('triangle', 880, 880, 0.14, 0.25 * v, 0.1);
        break;
      case 'refused':
        this.tone('sawtooth', 160, 120, 0.16, 0.2 * v);
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.3, i * 0.16));
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.97, 0.4, 0.3, i * 0.22));
        break;
    }
  }
}
