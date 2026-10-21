import type { Side } from '../../core/game.ts'
import { collideDynamic, type Disc } from '../../engines/puck/index.ts'

/**
 * Carrom: a shared board, a striker flicked from each player's baseline, and
 * nine pieces a side. Light pieces are red's, dark ones blue's, the queen is
 * neutral. Pure physics and rules, no DOM.
 */

/** The playing surface (inside the rails). */
export const BOARD = { x0: 100, y0: 500, x1: 900, y1: 1300 }
export const PIECE_R = 24
export const STRIKER_R = 30
export const POCKET_R = 46
/** Exponential friction (per second). */
export const DRAG = 1.3
/** Striker speed (world units / s) at full power. */
export const VMAX = 1700
const REST = 14
const SUB = 4
const RAIL_E = 0.78
const PIECE_E = 0.93
/** Striker baseline per side (y), and where along it the striker may sit (x). */
export const BASE_Y: [number, number] = [BOARD.y1 - 110, BOARD.y0 + 110]
export const BASE_X = { x0: 210, x1: 790 }
/** A board with no end after this many turns goes to the side with fewer pieces left. */
export const MAX_TURNS = 70
export const FRAME = 1 / 60
export const CENTRE = { x: (BOARD.x0 + BOARD.x1) / 2, y: (BOARD.y0 + BOARD.y1) / 2 }

/** 0 = red's light piece, 1 = blue's dark piece, 2 = the queen. */
export type Owner = 0 | 1 | 2

export interface Puck extends Disc {
  owner: Owner
}

export interface Striker extends Disc {
  side: Side
  /** Potted: a foul this turn. */
  gone: boolean
}

export interface Board {
  pieces: Puck[]
  striker: Striker
  turn: Side
  /** place: the turn side is setting the striker. flick: ready to shoot. roll: moving. settle: a beat after a roll. done: board over. */
  phase: 'place' | 'flick' | 'roll' | 'settle' | 'done'
  /** Own pieces still on the board or off it, per side (9 at the start). */
  left: [number, number]
  /** Own pieces each side has pocketed and not yet had returned (a foul gives one back). */
  kept: [number, number]
  /** Pieces potted during the current shot. */
  pots: Owner[]
  /** Striker went in during the current shot. */
  foul: boolean
  turns: number
  /** Winner of this board, once decided. */
  winner: Side | null
}

export type Event =
  | { kind: 'hit'; speed: number; x: number; y: number }
  | { kind: 'rail'; speed: number; x: number; y: number }
  | { kind: 'pot'; owner: Owner; x: number; y: number }
  | { kind: 'foul'; side: Side; x: number; y: number }

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by)

/** Pockets sit in the four corners of the playing surface. */
export const POCKETS = [
  { x: BOARD.x0, y: BOARD.y0 },
  { x: BOARD.x1, y: BOARD.y0 },
  { x: BOARD.x0, y: BOARD.y1 },
  { x: BOARD.x1, y: BOARD.y1 },
]

/** The opening layout: queen in the middle, two rings of pieces alternating light and dark. */
function layout(): Puck[] {
  const pieces: Puck[] = [{ x: CENTRE.x, y: CENTRE.y, vx: 0, vy: 0, r: PIECE_R, owner: 2 }]
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3
    pieces.push({
      x: CENTRE.x + 58 * Math.cos(a),
      y: CENTRE.y + 58 * Math.sin(a),
      vx: 0,
      vy: 0,
      r: PIECE_R,
      owner: i % 2 === 0 ? 0 : 1,
    })
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6 + Math.PI / 12
    pieces.push({
      x: CENTRE.x + 116 * Math.cos(a),
      y: CENTRE.y + 116 * Math.sin(a),
      vx: 0,
      vy: 0,
      r: PIECE_R,
      owner: i % 2 === 0 ? 0 : 1,
    })
  }
  return pieces
}

/** A fresh board. `first` places the first striker. */
export function newBoard(first: Side): Board {
  const b: Board = {
    pieces: layout(),
    striker: {
      x: CENTRE.x,
      y: BASE_Y[first],
      vx: 0,
      vy: 0,
      r: STRIKER_R,
      side: first,
      gone: false,
    },
    turn: first,
    phase: 'place',
    left: [9, 9],
    kept: [0, 0],
    pots: [],
    foul: false,
    turns: 0,
    winner: null,
  }
  return b
}

/** Nearest baseline x to `x` where the striker does not overlap a piece. */
export function freeX(b: Board, side: Side, x: number): number {
  const clear = (px: number) =>
    b.pieces.every((p) => dist(px, BASE_Y[side], p.x, p.y) >= STRIKER_R + p.r + 4)
  const lo = BASE_X.x0
  const hi = BASE_X.x1
  const cx = Math.min(hi, Math.max(lo, x))
  for (let k = 0; k <= 40; k++) {
    for (const s of k === 0 ? [0] : [1, -1]) {
      const px = cx + s * k * 12
      if (px < lo || px > hi) continue
      if (clear(px)) return px
    }
  }
  return cx
}

/** Put the turn side's striker at (about) `x` on its baseline. */
export function placeStriker(b: Board, x: number): void {
  const side = b.turn
  b.striker.x = freeX(b, side, x)
  b.striker.y = BASE_Y[side]
  b.striker.vx = 0
  b.striker.vy = 0
  b.striker.gone = false
  b.striker.side = side
}

/** Flick the striker. `dx, dy` a unit direction, `power` 0..1. */
export function strike(b: Board, dx: number, dy: number, power: number): void {
  const len = Math.hypot(dx, dy) || 1
  b.striker.vx = (dx / len) * power * VMAX
  b.striker.vy = (dy / len) * power * VMAX
  b.pots = []
  b.foul = false
  b.phase = 'roll'
  b.turns++
}

function railBounce(p: Disc, e: number, ev?: Event[]): void {
  const { x0, y0, x1, y1 } = BOARD
  if (p.x - p.r < x0) {
    p.x = x0 + p.r
    if (p.vx < 0) ev?.push({ kind: 'rail', speed: -p.vx, x: p.x, y: p.y })
    p.vx = Math.abs(p.vx) * e
  } else if (p.x + p.r > x1) {
    p.x = x1 - p.r
    if (p.vx > 0) ev?.push({ kind: 'rail', speed: p.vx, x: p.x, y: p.y })
    p.vx = -Math.abs(p.vx) * e
  }
  if (p.y - p.r < y0) {
    p.y = y0 + p.r
    if (p.vy < 0) ev?.push({ kind: 'rail', speed: -p.vy, x: p.x, y: p.y })
    p.vy = Math.abs(p.vy) * e
  } else if (p.y + p.r > y1) {
    p.y = y1 - p.r
    if (p.vy > 0) ev?.push({ kind: 'rail', speed: p.vy, x: p.x, y: p.y })
    p.vy = -Math.abs(p.vy) * e
  }
}

/** Is a disc at (x, y) inside a pocket? */
function pocketed(x: number, y: number): boolean {
  return POCKETS.some((k) => dist(x, y, k.x, k.y) < POCKET_R)
}

/**
 * One fixed frame of the shot: every moving disc slides, bounces off the rails,
 * knocks into the others, and drops if it reaches a pocket.
 */
export function frame(b: Board, ev?: Event[], dt = FRAME): void {
  const h = dt / SUB
  for (let i = 0; i < SUB; i++) {
    const s = b.striker
    if (!s.gone && (s.vx !== 0 || s.vy !== 0)) {
      s.x += s.vx * h
      s.y += s.vy * h
      const k = Math.exp(-DRAG * h)
      s.vx *= k
      s.vy *= k
      railBounce(s, RAIL_E, ev)
    }
    for (const p of b.pieces) {
      if (p.vx === 0 && p.vy === 0) continue
      p.x += p.vx * h
      p.y += p.vy * h
      const k = Math.exp(-DRAG * h)
      p.vx *= k
      p.vy *= k
      railBounce(p, RAIL_E, ev)
    }
    // Striker against pieces (heavier), then pieces against each other. Two
    // resting discs never touch each other, so only moving pairs are checked.
    if (!s.gone) {
      for (const p of b.pieces) {
        if (s.vx === 0 && s.vy === 0 && p.vx === 0 && p.vy === 0) continue
        const c = collideDynamic(s, p, 1.6, 1, PIECE_E)
        if (c && c.speed > 30) ev?.push({ kind: 'hit', speed: c.speed, x: c.x, y: c.y })
      }
    }
    for (let a = 0; a < b.pieces.length; a++) {
      for (let c2 = a + 1; c2 < b.pieces.length; c2++) {
        const pa = b.pieces[a] as Puck
        const pb = b.pieces[c2] as Puck
        if (pa.vx === 0 && pa.vy === 0 && pb.vx === 0 && pb.vy === 0) continue
        const c = collideDynamic(pa, pb, 1, 1, PIECE_E)
        if (c && c.speed > 30) ev?.push({ kind: 'hit', speed: c.speed, x: c.x, y: c.y })
      }
    }
    // Pockets.
    if (!s.gone && pocketed(s.x, s.y)) {
      s.gone = true
      s.vx = 0
      s.vy = 0
      b.foul = true
      ev?.push({ kind: 'foul', side: s.side, x: s.x, y: s.y })
    }
    for (let j = b.pieces.length - 1; j >= 0; j--) {
      const p = b.pieces[j] as Puck
      if (!pocketed(p.x, p.y)) continue
      b.pieces.splice(j, 1)
      b.pots.push(p.owner)
      ev?.push({ kind: 'pot', owner: p.owner, x: p.x, y: p.y })
    }
  }
  for (const p of [b.striker, ...b.pieces]) {
    if (Math.hypot(p.vx, p.vy) < REST) {
      p.vx = 0
      p.vy = 0
    }
  }
}

/** True when the striker and every piece have stopped (or gone). */
export function atRest(b: Board): boolean {
  return (
    (b.striker.gone || (b.striker.vx === 0 && b.striker.vy === 0)) &&
    b.pieces.every((p) => p.vx === 0 && p.vy === 0)
  )
}

/** Put a piece back on the board at the free spot nearest the centre. */
export function respot(b: Board, owner: Owner): void {
  for (let r = 0; r <= 300; r += 12) {
    const steps = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / 40))
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2
      const x = CENTRE.x + r * Math.cos(a)
      const y = CENTRE.y + r * Math.sin(a)
      const clear =
        x - PIECE_R > BOARD.x0 &&
        x + PIECE_R < BOARD.x1 &&
        y - PIECE_R > BOARD.y0 &&
        y + PIECE_R < BOARD.y1 &&
        b.pieces.every((p) => dist(x, y, p.x, p.y) >= PIECE_R * 2 + 2) &&
        dist(x, y, b.striker.x, b.striker.y) >= PIECE_R + STRIKER_R + 2
      if (clear) {
        b.pieces.push({ x, y, vx: 0, vy: 0, r: PIECE_R, owner })
        return
      }
    }
  }
}

/**
 * The shot is over: count the pots, give pieces back for a rival pot or a
 * foul, decide whether the turn stays, and whether the board is won.
 */
export function resolve(b: Board, ev?: Event[]): void {
  const side = b.turn
  const own: Owner = side
  const rival: Owner = side === 0 ? 1 : 0
  const ownPots = b.pots.filter((o) => o === own).length
  const rivalPots = b.pots.filter((o) => o === rival)
  b.left[side] -= ownPots
  b.kept[side] += ownPots
  // A rival's piece goes straight back: it gives the turn away without a point.
  for (let i = 0; i < rivalPots.length; i++) respot(b, rival)
  // A foul costs one of your own pieces already in the pocket.
  if (b.foul) {
    ev?.push({ kind: 'foul', side, x: b.striker.x, y: b.striker.y })
    if (b.kept[side] > 0) {
      b.kept[side]--
      b.left[side]++
      respot(b, own)
    }
  }
  b.pots = []
  b.foul = false
  if (b.left[side] <= 0) {
    b.winner = side
    b.phase = 'done'
    return
  }
  if (b.turns >= MAX_TURNS) {
    b.winner = b.left[0] === b.left[1] ? side : b.left[0] < b.left[1] ? 0 : 1
    b.phase = 'done'
    return
  }
  // Potting one of your own pieces earns another turn.
  const again = ownPots > 0 && !b.striker.gone
  b.turn = again ? side : side === 0 ? 1 : 0
  b.phase = 'place'
  b.striker.gone = false
  // The next side's striker waits on its own baseline, not where the last shot left the other one.
  if (!again) placeStriker(b, CENTRE.x)
}

/** What one shot did: own pieces potted, rival pieces potted, queen potted, striker lost. */
export interface Outcome {
  own: number
  rival: number
  queen: boolean
  foul: boolean
  /** Distance of the striker to the nearest piece it left behind (for the bot's tie-break). */
  strikerEnd: number
}

/** The shot played forward on a copy of the board, with the real physics. */
export function simulate(
  b: Board,
  x: number,
  dx: number,
  dy: number,
  power: number,
  maxFrames = 240,
): Outcome {
  const c = cloneBoard(b)
  placeStriker(c, x)
  c.striker.vx = dx * power * VMAX
  c.striker.vy = dy * power * VMAX
  c.pots = []
  c.foul = false
  c.phase = 'roll'
  for (let i = 0; i < maxFrames && !atRest(c); i++) frame(c)
  const side = b.turn
  const own: Owner = side
  const rival: Owner = side === 0 ? 1 : 0
  let nearest = Infinity
  for (const p of c.pieces) nearest = Math.min(nearest, dist(p.x, p.y, c.striker.x, c.striker.y))
  return {
    own: c.pots.filter((o) => o === own).length,
    rival: c.pots.filter((o) => o === rival).length,
    queen: c.pots.includes(2),
    foul: c.foul || c.striker.gone,
    strikerEnd: Number.isFinite(nearest) ? nearest : 0,
  }
}

export function cloneBoard(b: Board): Board {
  return {
    ...b,
    pieces: b.pieces.map((p) => ({ ...p })),
    striker: { ...b.striker },
    left: [b.left[0], b.left[1]],
    kept: [b.kept[0], b.kept[1]],
    pots: [...b.pots],
  }
}
