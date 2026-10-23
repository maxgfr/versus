/**
 * Reflex engine: the parts every tap / timing / "wait for it" duel shares.
 *
 * Everything that matters for the game lives in plain JSON objects (MashState,
 * SignalState, GaugeState, Rounds) so it can sit in `this.s` and travel in
 * online snapshots; the functions here only read and update those objects.
 * Cosmetic feedback goes through `ctx.fx` (replicated to the online guest).
 *
 * Building a new reflex game (copy src/games/pull-the-rope):
 * 1. State: `rounds: roundsNew(target)` plus whatever the game needs
 *    (a `MashState` per side for mashers, a `SignalState` for "wait for the
 *    signal" games, a `GaugeState` per side for timing games).
 * 2. step(dt):
 *    - `if (roundsStep(this.s.rounds, this.time)) resetRound()` handles the pause
 *      between rounds and tells you when the next one starts;
 *    - while `this.s.rounds.phase === 'play'`, read taps with `taps(ctx, side)`
 *      (or `tapsInLane` for 2 vs 2), feed bots through `MashBot` / `ReactBot`;
 *    - end a round with `roundEnd(rounds, winner, time, names)`; when it returns
 *      true the match is decided: call `this.finish(winner, { score: rounds.wins })`.
 * 3. render: `drawTapZone` for each half, `drawRounds` for pips + round banner.
 * 4. Bots: `MashBot` for mashing at a difficulty-scaled rate with human jitter,
 *    `ReactBot` for reaction-time games (Hand Slap, Last Sashimi…).
 */
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'

// ---------- taps ----------

/** Presses this step for a side (anywhere on its half: input routing already split the screen). */
export function taps(ctx: GameContext, side: Side): number {
  return ctx.input.player(side).downs.length
}

/** Presses this step for one lane of a side (2 vs 2: left / right teammate). */
export function tapsInLane(ctx: GameContext, side: Side, lane: 0 | 1): number {
  return ctx.input.player(side).downs.filter((p) => p.lane === lane).length
}

/** Positions of this step's presses, for ripples. */
export function tapPoints(ctx: GameContext, side: Side): { x: number; y: number }[] {
  return ctx.input.player(side).downs.map((p) => ({ x: p.x, y: p.y }))
}

// ---------- mash counter ----------

export interface MashState {
  taps: number
  /** Smoothed taps per second. */
  rate: number
  /** Taps in the current streak (gaps < 0.35 s). */
  combo: number
  /** Game time of the last tap (-1 = never). */
  last: number
}

/** Seconds of history in the smoothed rate. */
const RATE_WINDOW = 1

export const mashNew = (): MashState => ({ taps: 0, rate: 0, combo: 0, last: -1 })

export function mashTap(m: MashState, now: number, n = 1): void {
  if (n <= 0) return
  m.combo = now - m.last < 0.35 ? m.combo + n : n
  m.taps += n
  m.last = now
  m.rate += n / RATE_WINDOW
}

/** Decay the rate. Call once per step. */
export function mashStep(m: MashState, dt: number, now: number): void {
  // Exponential window: at a steady pace the rate converges to taps per second.
  m.rate *= Math.exp(-dt / RATE_WINDOW)
  if (now - m.last > 0.35) m.combo = 0
}

/** 0..1 "just tapped" pulse, for squash and press feedback. */
export function mashPulse(m: MashState, now: number, dur = 0.14): number {
  if (m.last < 0) return 0
  const t = (now - m.last) / dur
  return t >= 1 || t < 0 ? 0 : 1 - t
}

// ---------- signal ("wait for it") ----------

export interface SignalState {
  phase: 'wait' | 'live' | 'done'
  /** Seconds since the current phase started. */
  t: number
  /** When the signal goes live, seconds after `wait` began. */
  at: number
  /** A decoy: looks like the signal but must not be answered. */
  fake: boolean
}

/** Schedule a signal in [min, max] s; with `fakeChance` it is a decoy. */
export function signalNew(rng: Rng, min = 1.5, max = 4.5, fakeChance = 0): SignalState {
  return { phase: 'wait', t: 0, at: rng.range(min, max), fake: rng.chance(fakeChance) }
}

/** Advance; returns true on the step the signal fires. */
export function signalStep(s: SignalState, dt: number): boolean {
  s.t += dt
  if (s.phase === 'wait' && s.t >= s.at) {
    s.phase = 'live'
    s.t = 0
    return true
  }
  return false
}

export type Judgement = 'early' | 'hit' | 'fooled'

/** Judge a press now: before the signal = false start, on a decoy = fooled, else a hit. */
export function signalJudge(s: SignalState): Judgement {
  if (s.phase === 'wait') return 'early'
  return s.fake ? 'fooled' : 'hit'
}

// ---------- timing gauge ----------

export interface GaugeState {
  /** Phase accumulator. */
  t: number
  /** Full sweeps (0→1→0) per second. */
  speed: number
  /** Value when stopped, or null while swinging. */
  stopped: number | null
}

export const gaugeNew = (speed = 0.8): GaugeState => ({ t: 0, speed, stopped: null })

/** Current needle 0..1 (triangle wave). */
export function gaugeValue(g: GaugeState): number {
  if (g.stopped !== null) return g.stopped
  const p = (g.t * g.speed) % 1
  return p < 0.5 ? p * 2 : 2 - p * 2
}

export function gaugeStep(g: GaugeState, dt: number): void {
  if (g.stopped === null) g.t += dt
}

/** Stop the needle; returns the score 0..1 (1 = dead on the peak). */
export function gaugeStop(g: GaugeState): number {
  g.stopped = gaugeValue(g)
  return g.stopped
}

/** Vertical gauge for a side: track, sweet spot at the top, needle. Upright for that player. */
export function drawGauge(gr: Draw, side: Side, x: number, y: number, h: number, v: number): void {
  gr.forSide(side, x, y, () => {
    const w = 56
    gr.rrect(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16, 22, alpha(C.ink, 0.8))
    gr.rrect(
      -w / 2,
      -h / 2,
      w,
      h,
      16,
      gr.lin(0, h / 2, 0, -h / 2, [
        [0, C.green],
        [0.6, C.yellow],
        [0.92, C.orange],
        [1, C.red],
      ]),
    )
    const ny = h / 2 - v * h
    gr.poly([-w / 2 - 20, ny - 14, -w / 2 - 20, ny + 14, -w / 2 + 2, ny], C.white)
    gr.poly([w / 2 + 20, ny - 14, w / 2 + 20, ny + 14, w / 2 - 2, ny], C.white)
  })
}

// ---------- rounds ----------

export interface Rounds {
  wins: [number, number]
  /** First to this many round wins takes the match. */
  target: number
  round: number
  phase: 'play' | 'between'
  /** Game time the phase began. */
  at: number
  /** Banner text while between rounds. */
  text: string
  last: Side | 'draw' | null
}

export const roundsNew = (target = 2): Rounds => ({
  wins: [0, 0],
  target,
  round: 1,
  phase: 'play',
  at: 0,
  text: '',
  last: null,
})

/**
 * End the current round. Returns true when the match is decided (the caller
 * then calls `finish`). Plays the score sound.
 */
export function roundEnd(
  r: Rounds,
  winner: Side | 'draw',
  now: number,
  names: [string, string],
): boolean {
  if (r.phase !== 'play') return false
  r.last = winner
  r.phase = 'between'
  r.at = now
  if (winner === 'draw') {
    r.text = 'Draw round'
    return false
  }
  r.wins[winner]++
  r.text = `${names[winner]} takes round ${r.round}`
  return r.wins[winner] >= r.target
}

/**
 * Between rounds, wait `pause` s then start the next one. Returns true on the
 * step the next round starts (reset your round state then).
 */
export function roundsStep(r: Rounds, now: number, pause = 2): boolean {
  if (r.phase !== 'between') return false
  if (now - r.at < pause) return false
  r.phase = 'play'
  r.round++
  r.at = now
  r.text = ''
  return true
}

/** Pips at each edge plus the between-rounds banner (and "Round N" at the start of each). */
export function drawRounds(
  g: Draw,
  r: Rounds,
  now: number,
  o: { inset?: number; over?: boolean } = {},
): void {
  pips(g, 0, r.wins[0], r.target, { inset: o.inset ?? 70 })
  pips(g, 1, r.wins[1], r.target, { inset: o.inset ?? 70 })
  if (o.over) return
  if (r.phase === 'between' && r.text) {
    banner(g, undefined, r.text, MID, { size: 56, alpha: Math.min(1, (now - r.at) * 4) })
  } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
    const a = 1 - Math.max(0, (now - r.at - 0.7) / 0.4)
    banner(g, undefined, `Round ${r.round}`, MID, { size: 64, alpha: a })
  }
}

// ---------- tap zones ----------

/**
 * A player's half as a big pressable pad: team-tinted field with a rim that
 * lights on each tap. `pulse` is 0..1 (use mashPulse). Pass `label` for a
 * "TAP!" style hint, upright for that player.
 */
export function drawTapZone(
  g: Draw,
  side: Side,
  pulse: number,
  o: { label?: string; labelAlpha?: number; y0?: number; y1?: number; lanes?: boolean } = {},
): void {
  const v = g.stage.view
  const top = side === 0 ? (o.y0 ?? MID) : v.y - 2
  const bot = side === 0 ? v.y + v.h + 2 : (o.y1 ?? MID)
  const col = SIDE[side]
  g.rect(v.x - 2, top, v.w + 4, bot - top, shade(col.main, -0.74 + pulse * 0.08))
  // Rim light along the inner edge.
  const edgeY = side === 0 ? top : bot
  const dir = side === 0 ? 1 : -1
  g.rect(v.x - 2, edgeY, v.w + 4, dir * (10 + pulse * 10), alpha(col.main, 0.5 + pulse * 0.5))
  if (o.lanes)
    g.dashed(
      W / 2,
      side === 0 ? top + 40 : top,
      W / 2,
      side === 0 ? bot : bot - 40,
      alpha(col.light, 0.25),
      6,
    )
  // Online, each phone only prompts its own player.
  const rival = g.viewer !== null && g.viewer !== side
  if (o.label && (o.labelAlpha ?? 1) > 0 && !rival) {
    const y = side === 0 ? g.stage.edge(0) - 250 : g.stage.edge(1) + 250
    g.alpha(o.labelAlpha ?? 1, () =>
      g.sideText(side, o.label as string, W / 2, y, {
        size: 92 * (1 + pulse * 0.08),
        weight: 700,
        color: alpha(col.light, 0.9),
        drop: alpha('#000000', 0.35),
      }),
    )
  }
}

/** Ripple + sparkle where a finger landed (replicated to the online guest). */
export function tapRipple(ctx: GameContext, side: Side, x: number, y: number): void {
  ctx.fx.ring(x, y, SIDE[side].light, 90)
  ctx.fx.burst(x, y, SIDE[side].light, { count: 4, speed: 260, size: 7, life: 0.3, gravity: 0 })
}

// ---------- bots ----------

/** Taps per second for a masher bot. */
export function mashRate(d: Difficulty): number {
  return d === 'easy' ? 4.6 : d === 'normal' ? 6.6 : 8.4
}

/**
 * Mashes at `rate` taps/s with human jitter: uneven intervals, short flurries
 * and the odd hesitation. Not part of the snapshot (bots only run on the host).
 */
export class MashBot {
  private wait = 0.3

  constructor(
    private rng: Rng,
    public rate: number,
  ) {}

  /** Taps to make this step. */
  step(dt: number): number {
    this.wait -= dt
    let n = 0
    while (this.wait <= 0) {
      n++
      const base = 1 / this.rate
      let gap = base * this.rng.range(0.6, 1.45)
      if (this.rng.chance(0.03)) gap += this.rng.range(0.15, 0.4) // hesitation
      if (this.rng.chance(0.08)) gap *= 0.55 // flurry
      this.wait += gap
    }
    return n
  }
}

/** Reaction-time bot: answers a signal after a human-like delay; may false-start on easy. */
export class ReactBot {
  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** Seconds after the signal before reacting. */
  delay(): number {
    const [a, b] =
      this.d === 'easy' ? [0.42, 0.75] : this.d === 'normal' ? [0.3, 0.52] : [0.2, 0.36]
    return this.rng.range(a, b)
  }

  /** Chance to be fooled by a decoy / to jump early per round. */
  slip(): boolean {
    return this.rng.chance(this.d === 'easy' ? 0.3 : this.d === 'normal' ? 0.15 : 0.05)
  }
}
