/**
 * Procedural sound effects: every sound is synthesised from a few oscillator /
 * noise parameters, so there are no audio files to load or license. The context
 * is created lazily and unlocked on the first user gesture (iOS requires it).
 */

type Wave = OscillatorType | 'noise'

interface Voice {
  wave: Wave
  /** Start and end frequency (Hz); the sweep is exponential. */
  f: number
  f2?: number
  dur: number
  attack?: number
  vol?: number
  /** Low-pass cutoff for noise / harshness control. */
  lp?: number
  /** Start offset in seconds, for multi-voice sounds. */
  at?: number
  /** Vibrato depth (Hz) and rate. */
  vib?: [number, number]
}

const S: Record<string, Voice[]> = {
  tap: [{ wave: 'sine', f: 880, f2: 660, dur: 0.06, vol: 0.25 }],
  click: [{ wave: 'square', f: 1400, f2: 900, dur: 0.03, vol: 0.12, lp: 4000 }],
  pop: [{ wave: 'sine', f: 400, f2: 1100, dur: 0.09, vol: 0.4 }],
  place: [
    { wave: 'triangle', f: 520, f2: 380, dur: 0.1, vol: 0.45 },
    { wave: 'noise', f: 1, dur: 0.04, vol: 0.15, lp: 2500 },
  ],
  hit: [
    { wave: 'triangle', f: 300, f2: 90, dur: 0.12, vol: 0.55 },
    { wave: 'noise', f: 1, dur: 0.06, vol: 0.3, lp: 3000 },
  ],
  bounce: [{ wave: 'sine', f: 220, f2: 520, dur: 0.08, vol: 0.35 }],
  wall: [{ wave: 'triangle', f: 180, f2: 120, dur: 0.06, vol: 0.35 }],
  thud: [
    { wave: 'sine', f: 120, f2: 45, dur: 0.18, vol: 0.7 },
    { wave: 'noise', f: 1, dur: 0.08, vol: 0.2, lp: 800 },
  ],
  score: [
    { wave: 'square', f: 660, dur: 0.08, vol: 0.18, lp: 3000 },
    { wave: 'square', f: 990, dur: 0.14, vol: 0.18, lp: 3000, at: 0.08 },
  ],
  coin: [
    { wave: 'square', f: 988, dur: 0.06, vol: 0.15, lp: 5000 },
    { wave: 'square', f: 1319, dur: 0.2, vol: 0.15, lp: 5000, at: 0.06 },
  ],
  win: [
    { wave: 'triangle', f: 523, dur: 0.12, vol: 0.4 },
    { wave: 'triangle', f: 659, dur: 0.12, vol: 0.4, at: 0.11 },
    { wave: 'triangle', f: 784, dur: 0.12, vol: 0.4, at: 0.22 },
    { wave: 'triangle', f: 1047, dur: 0.4, vol: 0.45, at: 0.33, vib: [8, 6] },
  ],
  lose: [
    { wave: 'triangle', f: 392, f2: 370, dur: 0.18, vol: 0.4 },
    { wave: 'triangle', f: 330, f2: 311, dur: 0.18, vol: 0.4, at: 0.18 },
    { wave: 'triangle', f: 262, f2: 196, dur: 0.45, vol: 0.4, at: 0.36 },
  ],
  draw: [
    { wave: 'triangle', f: 440, dur: 0.16, vol: 0.35 },
    { wave: 'triangle', f: 440, dur: 0.3, vol: 0.35, at: 0.18 },
  ],
  count: [{ wave: 'square', f: 440, dur: 0.12, vol: 0.2, lp: 2500 }],
  go: [{ wave: 'square', f: 880, dur: 0.35, vol: 0.22, lp: 3500 }],
  explode: [
    { wave: 'noise', f: 1, dur: 0.5, vol: 0.7, lp: 1200 },
    { wave: 'sine', f: 90, f2: 30, dur: 0.4, vol: 0.6 },
  ],
  shoot: [
    { wave: 'square', f: 900, f2: 200, dur: 0.12, vol: 0.12, lp: 3000 },
    { wave: 'noise', f: 1, dur: 0.05, vol: 0.15, lp: 5000 },
  ],
  whoosh: [{ wave: 'noise', f: 1, dur: 0.22, vol: 0.3, lp: 1800, attack: 0.08 }],
  swish: [{ wave: 'noise', f: 1, dur: 0.12, vol: 0.22, lp: 5000, attack: 0.03 }],
  splash: [{ wave: 'noise', f: 1, dur: 0.35, vol: 0.4, lp: 2200, attack: 0.02 }],
  zap: [{ wave: 'sawtooth', f: 1600, f2: 120, dur: 0.15, vol: 0.12, lp: 4000 }],
  boing: [{ wave: 'sine', f: 180, f2: 600, dur: 0.25, vol: 0.4, vib: [30, 18] }],
  error: [
    { wave: 'square', f: 180, dur: 0.1, vol: 0.18, lp: 1500 },
    { wave: 'square', f: 140, dur: 0.18, vol: 0.18, lp: 1500, at: 0.1 },
  ],
  flip: [{ wave: 'noise', f: 1, dur: 0.07, vol: 0.25, lp: 6000, attack: 0.01 }],
  roll: [
    { wave: 'noise', f: 1, dur: 0.05, vol: 0.25, lp: 3500 },
    { wave: 'noise', f: 1, dur: 0.05, vol: 0.2, lp: 3500, at: 0.08 },
    { wave: 'noise', f: 1, dur: 0.05, vol: 0.22, lp: 3500, at: 0.15 },
    { wave: 'noise', f: 1, dur: 0.06, vol: 0.18, lp: 3500, at: 0.24 },
    { wave: 'triangle', f: 700, f2: 500, dur: 0.05, vol: 0.2, at: 0.3 },
  ],
  slide: [{ wave: 'noise', f: 1, dur: 0.18, vol: 0.15, lp: 900 }],
  tick: [{ wave: 'square', f: 2000, dur: 0.015, vol: 0.08, lp: 6000 }],
  chomp: [
    { wave: 'square', f: 220, f2: 110, dur: 0.07, vol: 0.2, lp: 1500 },
    { wave: 'square', f: 260, f2: 120, dur: 0.07, vol: 0.2, lp: 1500, at: 0.08 },
  ],
  powerup: [{ wave: 'square', f: 300, f2: 1200, dur: 0.3, vol: 0.15, lp: 3000, vib: [20, 25] }],
  slap: [
    { wave: 'noise', f: 1, dur: 0.08, vol: 0.6, lp: 6000 },
    { wave: 'sine', f: 160, f2: 60, dur: 0.1, vol: 0.4 },
  ],
  buzz: [{ wave: 'sawtooth', f: 110, dur: 0.35, vol: 0.18, lp: 900 }],
}

export type SoundName = keyof typeof S

export class Audio {
  private ac: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  enabled = true
  haptics = true
  /** Sounds played this step; the online host forwards them to the guest. */
  outbox: [string, number][] | null = null

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (!this.ac) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ac = new Ctor()
      this.master = this.ac.createGain()
      this.master.gain.value = 0.6
      this.master.connect(this.ac.destination)
      const len = this.ac.sampleRate
      this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    if (this.ac.state === 'suspended') void this.ac.resume()
  }

  /** `pitch` multiplies every frequency (1 = as designed); a little variation keeps repeats alive. */
  play(name: SoundName | (string & {}), pitch = 1): void {
    this.outbox?.push([name, pitch])
    if (!this.enabled) return
    const voices = S[name]
    const ac = this.ac
    if (!voices || !ac || !this.master || ac.state !== 'running') return
    const t0 = ac.currentTime + 0.005
    for (const v of voices) this.voice(ac, v, t0 + (v.at ?? 0), pitch)
  }

  private voice(ac: AudioContext, v: Voice, t: number, pitch: number): void {
    const g = ac.createGain()
    const vol = v.vol ?? 0.3
    const attack = v.attack ?? 0.004
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur)
    let src: AudioScheduledSourceNode
    if (v.wave === 'noise') {
      const b = ac.createBufferSource()
      b.buffer = this.noise
      b.playbackRate.value = pitch
      src = b
    } else {
      const o = ac.createOscillator()
      o.type = v.wave
      o.frequency.setValueAtTime(v.f * pitch, t)
      if (v.f2) o.frequency.exponentialRampToValueAtTime(v.f2 * pitch, t + v.dur)
      if (v.vib) {
        const lfo = ac.createOscillator()
        const lg = ac.createGain()
        lfo.frequency.value = v.vib[1]
        lg.gain.value = v.vib[0]
        lfo.connect(lg).connect(o.frequency)
        lfo.start(t)
        lfo.stop(t + v.dur)
      }
      src = o
    }
    let node: AudioNode = src
    if (v.lp) {
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = v.lp
      node.connect(f)
      node = f
    }
    node.connect(g).connect(this.master as GainNode)
    src.start(t)
    src.stop(t + v.dur + 0.02)
  }

  /** Haptic tick where supported (Android). iOS Safari ignores it silently. */
  buzz(ms = 12): void {
    if (!this.haptics) return
    try {
      navigator.vibrate?.(ms)
    } catch {
      // Not supported.
    }
  }
}

export const audio = new Audio()
