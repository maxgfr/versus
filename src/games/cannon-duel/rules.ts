import { other, type Side } from '../../core/game.ts'
import { H, W } from '../../core/stage.ts'
import {
  type Ballistics,
  blast,
  type Block,
  blockAt,
  launch,
  type Shell,
  type ShotParams,
  stepShell,
} from '../../engines/aim/index.ts'

/** Pure cannon duel: forts, one shell at a time, blasts. No DOM. */

export const BALL: Ballistics = { g: 1300, vmax: 1350, elev: 1, z0: 70 }
export const WIND_MAX = 260
export const BLAST_R = 80
export const CORE_HP = 3
/** A full-power shell lands at about this speed: impact juice is scaled against it. */
export const IMPACT_MAX = 1900
const BLOCK = 72

export interface State {
  turn: Side
  blocks: Block[]
  shell: (Shell & { side: Side }) | null
  wind: number
  phase: 'aim' | 'fly' | 'boom'
  /** Seconds left of the post-impact beat. */
  beat: number
  /** Last aim direction per side, for the barrel. */
  aim: [{ dx: number; dy: number }, { dx: number; dy: number }]
  shots: [number, number]
  /** The live aim of the player whose turn it is (synced, so the online guest sees their own preview). */
  aiming: ShotParams | null
  /** Rounds won per side. The match is first to the chosen number. */
  wins: [number, number]
  /** Who opened this round; the other side opens the next. */
  starter: Side
  /** Game time the round was decided, or -1 while it is being fought. */
  endedAt: number
  /** Banner for the round just decided. */
  roundText: string
  /** Game time each block was last hit (index-aligned with `blocks`), -1 if never: wobble and collapse. */
  hitAt: number[]
  /** Scorch marks left by shells that hit the ground this round (newest last, capped). */
  craters: { x: number; y: number; r: number }[]
  /** Game time of the last shot, for the muzzle flash. */
  firedAt: number
}

const MAX_CRATERS = 10

/** Point symmetry: blue's fort is red's turned half a turn about the centre. */
const mirror = (x: number, y: number, side: Side) =>
  side === 0 ? { x, y } : { x: W - x, y: H - y }

export function cannonOf(side: Side): { x: number; y: number } {
  return mirror(165, 1655, side)
}

export function coreOf(side: Side): { x: number; y: number } {
  return mirror(W / 2, 1585, side)
}

export function fort(side: Side): Block[] {
  const out: Block[] = []
  const add = (
    x: number,
    y: number,
    kind: string,
    hp: number,
    height: number,
    w = BLOCK,
    h = BLOCK,
  ) => {
    const p = mirror(x, y, side)
    out.push({ x: p.x, y: p.y, w, h, hp, max: hp, height, kind, side })
  }
  const c = coreOf(0)
  add(c.x, c.y, 'core', CORE_HP, 100, 104, 104)
  // Front wall, then the flanks.
  for (let k = -3; k <= 3; k++) add(c.x + k * BLOCK, c.y - 120, 'wall', 2, 150)
  for (const sx of [-1, 1]) {
    add(c.x + sx * 3 * BLOCK, c.y - 120 + BLOCK, 'wall', 2, 150)
    add(c.x + sx * 3 * BLOCK, c.y - 120 + BLOCK * 2, 'wall', 2, 150)
  }
  return out
}

export function newState(starter: Side, wind: number): State {
  const blocks = [...fort(0), ...fort(1)]
  return {
    turn: starter,
    blocks,
    shell: null,
    wind,
    phase: 'aim',
    beat: 0,
    aim: [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ],
    shots: [0, 0],
    aiming: null,
    wins: [0, 0],
    starter,
    endedAt: -1,
    roundText: '',
    hitAt: blocks.map(() => -1),
    craters: [],
    firedAt: -1,
  }
}

/** Build fresh forts for the next round. The round wins carry over. */
export function nextRound(s: State, starter: Side, wind: number): void {
  const wins = s.wins
  Object.assign(s, newState(starter, wind), { wins })
}

export function fire(s: State, shot: ShotParams): void {
  const c = cannonOf(s.turn)
  s.shell = { ...launch(c.x, c.y, shot, BALL), side: s.turn }
  s.aim[s.turn] = { dx: shot.dx, dy: shot.dy }
  s.shots[s.turn]++
  s.aiming = null
  s.phase = 'fly'
}

export type Event =
  | {
      kind: 'boom'
      x: number
      y: number
      hit: number[]
      destroyed: number[]
      direct: number
      /** Impact speed (3D), drives how hard the hit feels. */
      speed: number
    }
  | { kind: 'miss'; x: number; y: number }
  | { kind: 'turn'; side: Side }

/** Advance flight / beat. `nextWind` is only used when a new turn starts. */
export function advance(s: State, dt: number, nextWind: () => number): Event[] {
  const ev: Event[] = []
  if (s.phase === 'fly' && s.shell) {
    const sh = s.shell
    // Two substeps: fast shells must not skip a 72-unit block.
    for (let i = 0; i < 2 && s.shell; i++) {
      stepShell(sh, dt / 2, s.wind, BALL)
      const hit = blockAt(s.blocks, sh.x, sh.y, sh.z)
      if (hit >= 0 || sh.z <= 0) {
        // Walls crumble to a direct hit; the keep only to direct hits, one stone at a time.
        const core = hit >= 0 && s.blocks[hit]?.kind === 'core'
        const r = blast(
          s.blocks,
          sh.x,
          sh.y,
          BLAST_R,
          1,
          hit,
          core ? 1 : 2,
          (b) => b.kind !== 'core',
        )
        const speed = Math.hypot(sh.vx, sh.vy, sh.vz)
        ev.push({
          kind: 'boom',
          x: sh.x,
          y: sh.y,
          hit: r.hit,
          destroyed: r.destroyed,
          direct: hit,
          speed,
        })
        if (hit < 0) {
          s.craters.push({ x: sh.x, y: sh.y, r: 26 + Math.min(1, speed / IMPACT_MAX) * 22 })
          if (s.craters.length > MAX_CRATERS) s.craters.shift()
        }
        s.shell = null
        s.phase = 'boom'
        s.beat = 1.1
      } else if (sh.x < -300 || sh.x > W + 300 || sh.y < -400 || sh.y > H + 400) {
        ev.push({ kind: 'miss', x: sh.x, y: sh.y })
        s.shell = null
        s.phase = 'boom'
        s.beat = 0.6
      }
    }
  } else if (s.phase === 'boom') {
    s.beat -= dt
    if (s.beat <= 0 && winner(s) === null) {
      s.turn = other(s.turn)
      s.wind = nextWind()
      s.phase = 'aim'
      ev.push({ kind: 'turn', side: s.turn })
    }
  }
  return ev
}

/** Share of the full wind range in play after `shots` shells this round: half at first, all of it by the tenth. */
export function windScale(shots: number): number {
  return Math.min(1, 0.5 + shots * 0.05)
}

export function coreHp(s: State, side: Side): number {
  return s.blocks.find((b) => b.kind === 'core' && b.side === side)?.hp ?? 0
}

export function winner(s: State): Side | null {
  if (coreHp(s, 1) <= 0) return 0
  if (coreHp(s, 0) <= 0) return 1
  return null
}
