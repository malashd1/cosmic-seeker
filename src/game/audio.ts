// 8-bit style audio: pure WebAudio synth. No external samples.
// Designed for negligible memory footprint and the chiptune aesthetic.

export type SfxName =
  | 'shoot' | 'hit' | 'explode' | 'boss-hit' | 'boss-die'
  | 'damage' | 'level-clear' | 'bomb' | 'pickup' | 'menu' | 'connect';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicBeat = 0;
  private currentTrack: string | null = null;
  enabled = true;
  musicEnabled = true;
  shootSfx = false;     // shoot sound is off by default — toggle in settings
  enemySfx = true;      // explosions, damage, etc.
  volume = 0.5;
  musicVolume = 0.18;

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.master);
      return true;
    } catch { return false; }
  }

  /// Unlock on first user gesture (browsers block autoplay).
  prime() {
    if (!this.ensure()) return;
    if (this.ctx!.state === 'suspended') this.ctx!.resume();
  }

  setEnabled(on: boolean) { this.enabled = on; }
  setShootSfx(on: boolean) { this.shootSfx = on; }
  setEnemySfx(on: boolean) { this.enemySfx = on; }
  setMusicEnabled(on: boolean) {
    this.musicEnabled = on;
    if (!on && this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  // ---- SFX ----
  play(name: SfxName) {
    if (!this.enabled || !this.ensure()) return;
    if (name === 'shoot' && !this.shootSfx) return;
    if ((name === 'hit' || name === 'explode' || name === 'boss-hit' || name === 'boss-die' || name === 'damage') && !this.enemySfx) return;
    const t = this.ctx!.currentTime;
    switch (name) {
      case 'shoot':       this.beep(t, 'square',   880, 0.06, 0.12); break;
      case 'hit':         this.beep(t, 'square',   220, 0.05, 0.10); break;
      case 'explode':     this.noise(t, 0.18, 0.30); break;
      case 'boss-hit':    this.beep(t, 'sawtooth', 110, 0.08, 0.18); break;
      case 'boss-die':    this.bossDie(t); break;
      case 'damage':      this.sweep(t, 660, 110, 0.22, 'square', 0.25); break;
      case 'level-clear': this.fanfare(t); break;
      case 'bomb':        this.noise(t, 0.35, 0.50); this.sweep(t, 200, 1200, 0.4, 'sawtooth', 0.2); break;
      case 'pickup':      this.beep(t, 'square', 1320, 0.08, 0.18); this.beep(t + 0.06, 'square', 1760, 0.08, 0.18); break;
      case 'menu':        this.beep(t, 'square', 660, 0.05, 0.12); break;
      case 'connect':     this.beep(t, 'square', 523, 0.06, 0.15); this.beep(t + 0.08, 'square', 659, 0.06, 0.15); this.beep(t + 0.16, 'square', 784, 0.08, 0.18); break;
    }
  }

  private beep(t: number, type: OscillatorType, freq: number, dur: number, vol: number) {
    const osc = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur);
  }

  private sweep(t: number, from: number, to: number, dur: number, type: OscillatorType, vol: number) {
    const osc = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur);
  }

  private noise(t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    // crude lowpass
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 1800;
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
  }

  private bossDie(t: number) {
    this.noise(t, 0.6, 0.4);
    this.sweep(t, 880, 60, 0.6, 'sawtooth', 0.3);
    this.sweep(t + 0.2, 660, 40, 0.6, 'square', 0.25);
  }

  private fanfare(t: number) {
    const notes = [523, 659, 784, 1047]; // C E G C
    for (let i = 0; i < notes.length; i++) {
      this.beep(t + i * 0.10, 'square', notes[i], 0.18, 0.22);
    }
  }

  // ---- Music: simple arpeggio + bass loop, key per track ----
  playMusic(track: string) {
    if (!this.musicEnabled) return;
    if (!this.ensure()) return;
    if (this.currentTrack === track && this.musicTimer) return;
    this.stopMusic();
    this.currentTrack = track;
    this.musicBeat = 0;

    const config = TRACKS[track] ?? TRACKS['neon-dawn'];
    const bpm = config.bpm;
    const interval = (60 / bpm) * 1000 / 2; // 8th notes

    this.musicTimer = setInterval(() => this.musicStep(config), interval) as unknown as number;
  }
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.currentTrack = null;
  }

  private musicStep(cfg: TrackCfg) {
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    const beat = this.musicBeat++;
    const arp = cfg.arp;
    const bass = cfg.bass;
    // Arp on every step
    const arpNote = arp[beat % arp.length];
    this.tone(t, 'square', arpNote, 0.18, 0.08, this.musicGain);
    // Bass on every 4
    if (beat % 4 === 0) {
      const bassNote = bass[(beat / 4) % bass.length];
      this.tone(t, 'triangle', bassNote, 0.42, 0.15, this.musicGain);
    }
    // Hat on every 2
    if (beat % 2 === 1) {
      const noiseG = this.ctx.createGain();
      const dur = 0.05;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      noiseG.gain.value = 0.05;
      src.connect(noiseG).connect(this.musicGain);
      src.start(t);
    }
  }

  private tone(t: number, type: OscillatorType, freq: number, dur: number, vol: number, dest: AudioNode) {
    const osc = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur);
  }
}

interface TrackCfg { bpm: number; arp: number[]; bass: number[]; }

const TRACKS: Record<string, TrackCfg> = {
  'neon-dawn':       { bpm: 124, arp: [523, 659, 784, 988, 784, 659], bass: [131, 131, 174, 165] },
  'crystal-drift':   { bpm: 112, arp: [440, 554, 659, 880, 659, 554], bass: [110, 147, 165, 110] },
  'voltage':         { bpm: 140, arp: [659, 784, 988, 1175, 988, 784], bass: [165, 220, 196, 165] },
  'parallax':        { bpm: 128, arp: [440, 523, 659, 784, 659, 523], bass: [110, 131, 165, 196] },
  'comet':           { bpm: 132, arp: [587, 740, 880, 1047, 880, 740], bass: [147, 196, 175, 147] },
  'fracture':        { bpm: 144, arp: [466, 587, 698, 880, 698, 587], bass: [117, 156, 175, 117] },
  'overcharge':      { bpm: 150, arp: [622, 740, 932, 1109, 932, 740], bass: [156, 208, 185, 156] },
  'flux':            { bpm: 136, arp: [494, 622, 740, 932, 740, 622], bass: [123, 165, 196, 123] },
  'singularity':     { bpm: 160, arp: [415, 523, 622, 831, 622, 523], bass: [104, 138, 175, 104] },
  'event-horizon':   { bpm: 152, arp: [554, 698, 831, 1047, 831, 698], bass: [139, 185, 165, 139] },
  'void-protocol':   { bpm: 168, arp: [466, 622, 698, 932, 698, 622], bass: [117, 156, 196, 117] },
  'eclipse':         { bpm: 158, arp: [392, 523, 622, 784, 622, 523], bass: [98, 131, 165, 98] },
  'sovereign-ascend':{ bpm: 174, arp: [523, 659, 784, 1047, 1319, 1047, 784, 659], bass: [131, 196, 175, 131] },
};

export const audio = new AudioEngine();
