import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'

/**
 * Pure target practice: targets pop up across the whole table for a moment.
 * Each player's crossbow sits at their edge; a tap on a target loads a bolt
 * that flies to that point in BOLT_TIME seconds. The first bolt to arrive
 * while the target is still there scores; the rest arrive too late. 45 s,
 * most points wins. No DOM.
 */

export const TIME = 45
export const BOLT_TIME = 0.25
export const RELOAD = 0.45
/** Crossbow positions (world units). Red's is at the bottom, blue's at the top. */
export const BOW: readonly { x: number; y: number }[] = [
  { x: 500, y: 1590 },
  { x: 500, y: 210 },
]
/** A tap this far outside a target still counts as aiming at it. */
export const TAP_PAD = 40
/** A bolt hits when it lands within the target's radius plus this. */
export const HIT_PAD = 14
export const MAX_ALIVE = 6
/** Balloon bonus window: popped within this fraction of its life. */
export const FRESH = 0.4

export type Kind = 'bull' | 'can' | 'balloon'

export const KINDS: Record<Kind, { r: number; life: number; pts: number }> = {
  bull: { r: 70, life: 1.7, pts: 3 },
  can: { r: 46, life: 1.5, pts: 2 },
  balloon: { r: 52, life: 2.4, pts: 1 },
}

export interface Target {
  id: number
  kind: Kind
  x: number
  y: number
  r: number
  /** Elapsed time when it popped up. */
  born: number
  life: number
  vy: number
}

export interface Bolt {
  side: Side
  /** Where the bolt is aimed. */
  x: number
  y: number
  /** The target it was loaded for. */
  target: number
  /** Elapsed time at which it arrives. */
  at: number
}

/** A target that was just hit, kept for a moment so it can burst on screen. */
export interface Pop {
  kind: Kind
  x: number
  y: number
  r: number
  id: number
  side: Side
  pts: number
  /** Elapsed time of the hit. */
  at: number
}

/** A bolt that arrived too late and stuck in the floor. */
export interface Miss {
  side: Side
  x: number
  y: number
  at: number
}

/** How long hit and miss marks stay for the renderer (s). */
export const MARK_TIME = 0.9

export interface State {
  /** Elapsed time (s). */
  now: number
  left: number
  targets: Target[]
  bolts: Bolt[]
  reload: [number, number]
  score: [number, number]
  hits: [number, number]
  nextSpawn: number
  nextId: number
  /** Set once the clock ran out and the last bolt has landed. */
  ended: boolean
  /** Where each crossbow last pointed (world angle) and when it last fired. */
  aim: [number, number]
  shotAt: [number, number]
  pops: Pop[]
  misses: Miss[]
}

export type Event =
  | { kind: 'spawn'; target: Target }
  | { kind: 'expire'; target: Target }
  | { kind: 'fire'; side: Side; x: number; y: number }
  | { kind: 'hit'; side: Side; target: Target; pts: number; bonus: boolean }
  | { kind: 'late'; side: Side; x: number; y: number }
  | { kind: 'end' }

export function newState(): State {
  return {
    now: 0,
    left: TIME,
    targets: [],
    bolts: [],
    reload: [0, 0],
    score: [0, 0],
    hits: [0, 0],
    nextSpawn: 0.4,
    nextId: 1,
    ended: false,
    aim: [-Math.PI / 2, Math.PI / 2],
    shotAt: [-9, -9],
    pops: [],
    misses: [],
  }
}

/** The spawn interval shortens over the round, so the last seconds are busier. */
export function spawnGap(elapsed: number, rng: Rng): number {
  const k = Math.min(1, Math.max(0, elapsed / TIME))
  return (0.56 - 0.24 * k) * rng.range(0.8, 1.2)
}

export function isAlive(t: Target, now: number): boolean {
  return now - t.born < t.life
}

export function pointIn(t: Target, x: number, y: number, pad = 0): boolean {
  return (t.x - x) ** 2 + (t.y - y) ** 2 <= (t.r + pad) ** 2
}

/** Pop a target at a random free spot across the table. */
export function spawn(s: State, rng: Rng): Target | null {
  const roll = rng.next()
  const kind: Kind = roll < 0.35 ? 'bull' : roll < 0.75 ? 'can' : 'balloon'
  const r = KINDS[kind].r
  for (let tries = 0; tries < 12; tries++) {
    const x = rng.range(150 + r, W - 150 - r)
    const y = rng.range(330 + r, H - 330 - r)
    const clear = s.targets.every((t) => (t.x - x) ** 2 + (t.y - y) ** 2 > (t.r + r + 24) ** 2)
    if (!clear) continue
    const t: Target = {
      id: s.nextId++,
      kind,
      x,
      y,
      r,
      born: s.now,
      life: KINDS[kind].life * rng.range(0.9, 1.1),
      vy: kind === 'balloon' ? -36 : 0,
    }
    s.targets.push(t)
    return t
  }
  return null
}

/**
 * Fire from `side`'s crossbow at the point (x, y). Only a tap near a live target
 * loads a bolt. Returns false when the tap missed every target or the bow is reloading.
 */
export function fire(s: State, side: Side, x: number, y: number): boolean {
  if (s.left <= 0 || s.reload[side] > 0) return false
  let best: Target | undefined
  let bestD = Infinity
  for (const t of s.targets) {
    if (!isAlive(t, s.now)) continue
    const d = Math.hypot(t.x - x, t.y - y) - t.r
    if (d <= TAP_PAD && d < bestD) {
      best = t
      bestD = d
    }
  }
  if (!best) return false
  s.bolts.push({ side, x, y, target: best.id, at: s.now + BOLT_TIME })
  s.reload[side] = RELOAD
  const bow = BOW[side] as { x: number; y: number }
  s.aim[side] = Math.atan2(y - bow.y, x - bow.x)
  s.shotAt[side] = s.now
  return true
}

/** Points a hit is worth at this moment, with the balloon bonus. */
export function hitValue(t: Target, now: number): { pts: number; bonus: boolean } {
  if (t.kind !== 'balloon') return { pts: KINDS[t.kind].pts, bonus: false }
  const bonus = now - t.born <= t.life * FRESH
  return { pts: 1 + (bonus ? 3 : 0), bonus }
}

/** Advance the clock by `dt`: spawns, drift, expiry, bolts landing. */
export function advance(s: State, dt: number, rng: Rng): Event[] {
  const ev: Event[] = []
  // The clock keeps running after the end so the last marks can fade.
  s.now += dt
  s.pops = s.pops.filter((p) => s.now - p.at < MARK_TIME)
  s.misses = s.misses.filter((m) => s.now - m.at < MARK_TIME)
  if (s.ended) return ev
  s.left = Math.max(0, s.left - dt)
  for (const side of [0, 1] as Side[]) s.reload[side] = Math.max(0, s.reload[side] - dt)

  // Balloons drift up; expired targets leave.
  for (const t of s.targets) t.y += t.vy * dt
  const gone = s.targets.filter((t) => !isAlive(t, s.now))
  for (const t of gone) ev.push({ kind: 'expire', target: t })
  s.targets = s.targets.filter((t) => isAlive(t, s.now))

  // Bolts arrive in the order they were loosed.
  const landed = s.bolts.filter((b) => b.at <= s.now)
  s.bolts = s.bolts.filter((b) => b.at > s.now)
  for (const b of landed) {
    const i = s.targets.findIndex((t) => t.id === b.target)
    const t = s.targets[i]
    if (t && pointIn(t, b.x, b.y, HIT_PAD)) {
      const { pts, bonus } = hitValue(t, s.now)
      s.targets.splice(i, 1)
      s.score[b.side] += pts
      s.hits[b.side]++
      s.pops.push({ kind: t.kind, x: t.x, y: t.y, r: t.r, id: t.id, side: b.side, pts, at: s.now })
      ev.push({ kind: 'hit', side: b.side, target: t, pts, bonus })
    } else {
      s.misses.push({ side: b.side, x: b.x, y: b.y, at: s.now })
      ev.push({ kind: 'late', side: b.side, x: b.x, y: b.y })
    }
  }

  s.nextSpawn -= dt
  if (s.nextSpawn <= 0 && s.targets.length < MAX_ALIVE && s.left > 0) {
    const t = spawn(s, rng)
    if (t) ev.push({ kind: 'spawn', target: t })
    s.nextSpawn = spawnGap(s.now, rng)
  }

  if (s.left <= 0 && s.bolts.length === 0) {
    s.ended = true
    ev.push({ kind: 'end' })
  }
  return ev
}

/** The side with more points, or 'draw'. */
export function leader(s: State): Side | 'draw' {
  if (s.score[0] === s.score[1]) return 'draw'
  return s.score[0] > s.score[1] ? 0 : 1
}
