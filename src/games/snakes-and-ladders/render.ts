import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { cellCenter, geom, type Geom } from '../../engines/board/index.ts'
import { drawDie, frame, inFrame, textAngle } from '../../engines/dice/index.ts'
import { colOf, GOAL, type Link, rowOf, type Board } from './rules.ts'

/** The shared board, centred on the table. */
export const BOARD: Geom = geom(10, 10, 820, 820, MID)

/** Each player's die, written in red's frame (bottom of the table). */
export const DIE = { x: 500, y: 1478, size: 150, hit: 230 }
/** Start pad (off-board tokens), red's frame. */
export const PAD = { x: 168, y: 1478 }
/** Square counter, red's frame. */
const COUNT = { x: 832, y: 1478 }

/** Seconds a roll takes to tumble before the token moves. */
export const ROLL_T = 0.6
/** Seconds per square hopped. */
export const HOP = 0.2
/** Seconds pausing on the square the link starts from. */
export const LINK_PAUSE = 0.28
/** Seconds to climb a ladder or slide down a snake. */
export const LINK_T = 0.8

/** Where square `n` is in the world (n = 0 is the side's start pad). */
export function squareAt(n: number): { x: number; y: number } {
  return cellCenter(BOARD, colOf(n), 9 - rowOf(n))
}

export function spot(side: Side, n: number): { x: number; y: number } {
  if (n === 0) return frame(side, PAD.x, PAD.y - 6)
  return squareAt(n)
}

// ---------- board ----------

/** Board colour of square `n`: a warm checker, gold on the goal. */
function cellFill(n: number): string {
  if (n === GOAL) return C.yellow
  return (rowOf(n) + colOf(n)) % 2 === 0 ? '#fff1d6' : '#f3cf8e'
}

function drawBoardBase(g: Draw): void {
  const b = BOARD
  const pad = 26
  const w = b.cols * b.cell
  const h = b.rows * b.cell
  g.shadow(b.x + w / 2, b.y + h + pad + 34, w * 0.54, 40, 0.5)
  g.tile(b.x - pad, b.y - pad, w + pad * 2, h + pad * 2 + 22, 44, C.woodDark, 22)
  g.rrect(
    b.x - pad,
    b.y - pad,
    w + pad * 2,
    h + pad * 2,
    44,
    g.lin(b.x, b.y, b.x + w, b.y + h, [
      [0, shade(C.wood, -0.02)],
      [1, shade(C.wood, -0.25)],
    ]),
  )
  g.alpha(0.5, () =>
    g.rrect(b.x - pad + 10, b.y - pad + 4, w + pad * 2 - 20, 24, 12, alpha('#fff', 0.2)),
  )
  g.rrect(b.x - 6, b.y - 6, w + 12, h + 12, 24, shade(C.woodDark, -0.4))
  for (let n = 1; n <= GOAL; n++) {
    const p = squareAt(n)
    const s = b.cell - 6
    const x = p.x - s / 2
    const y = p.y - s / 2
    const f = cellFill(n)
    g.rrect(x, y + 4, s, s - 2, 12, shade(f, -0.3))
    g.rrect(
      x,
      y,
      s,
      s - 2,
      12,
      g.lin(0, y, 0, y + s, [
        [0, shade(f, 0.08)],
        [1, shade(f, -0.05)],
      ]),
    )
  }
}

/**
 * Square numbers in each square's top-left corner, upright for the player whose
 * half it sits in, so ladder rails and snake bodies cross the middle, not the
 * numbers. A trophy on 100.
 */
function drawNumbers(g: Draw): void {
  const off = BOARD.cell * 0.3
  for (let n = 1; n <= GOAL; n++) {
    const p = squareAt(n)
    const side: Side = rowOf(n) < 5 ? 0 : 1
    if (n === GOAL) {
      g.emoji('🏆', p.x, p.y - 2, 50, 0)
      continue
    }
    g.at(p.x, p.y, g.orient(side), () =>
      g.text(n, -off, -off + 2, { size: 30, weight: 800, color: alpha(C.ink, 0.62) }),
    )
  }
}

const SNAKE_COLORS = ['#2fa86a', '#9d6bff', '#e0622f', '#2aa3c9', '#c2368a', '#7a9a1f']

function drawLadder(g: Draw, link: Link, cell: number): void {
  const a = squareAt(link.from)
  const b = squareAt(link.to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const inset = cell * 0.22
  const s0 = { x: a.x - ux * inset, y: a.y - uy * inset }
  const s1 = { x: b.x + ux * inset, y: b.y + uy * inset }
  const half = cell * 0.2
  const L = Math.hypot(s1.x - s0.x, s1.y - s0.y)
  const rungs = Math.max(3, Math.round(L / (cell * 0.36)))
  const seg = (t0: number, t1: number, off: number, col: string, w: number, sh = 0) =>
    g.line(
      s0.x + (s1.x - s0.x) * t0 + px * off + sh,
      s0.y + (s1.y - s0.y) * t0 + py * off + sh * 1.4,
      s0.x + (s1.x - s0.x) * t1 + px * off + sh,
      s0.y + (s1.y - s0.y) * t1 + py * off + sh * 1.4,
      col,
      w,
    )
  // Shadow on the board first.
  g.alpha(0.3, () => {
    seg(0, 1, -half, '#000', 16, 8)
    seg(0, 1, half, '#000', 16, 8)
  })
  // Rungs sit behind the rails.
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs
    const cx = s0.x + (s1.x - s0.x) * t
    const cy = s0.y + (s1.y - s0.y) * t
    g.line(cx - px * half, cy - py * half + 3, cx + px * half, cy + py * half + 3, '#000000', 10)
    g.line(cx - px * half, cy - py * half, cx + px * half, cy + py * half, shade(C.wood, 0.05), 9)
    g.line(
      cx - px * half,
      cy - py * half - 2,
      cx + px * half,
      cy + py * half - 2,
      shade(C.sand, 0.2),
      3,
    )
  }
  for (const side of [-1, 1]) {
    seg(0, 1, side * half, shade(C.woodDark, -0.35), 17)
    seg(0, 1, side * half, C.wood, 11)
    seg(0, 1, side * half - 2.5, shade(C.sand, 0.15), 3.5)
  }
}

/** Points along a snake from its tail (link.to) to its head (link.from), with a lazy wave. */
function snakePath(link: Link, cell: number, now: number, idx: number): { x: number; y: number }[] {
  const tail = squareAt(link.to)
  const head = squareAt(link.from)
  const dx = head.x - tail.x
  const dy = head.y - tail.y
  const len = Math.hypot(dx, dy)
  const px = -dy / len
  const py = dx / len
  const N = 64
  const waves = Math.max(1.5, Math.round((len / cell) * 0.75 * 2) / 2)
  const amp = cell * 0.32
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    // A gentle slither: the wave drifts along the body, calmer at the head.
    const ph = Math.sin(now * 1.6 + idx) * 0.35 * (1 - t * 0.7)
    const off = Math.sin(t * Math.PI * waves + ph) * amp * Math.sin(Math.PI * Math.min(1, t * 1.15))
    pts.push({ x: tail.x + dx * t + px * off, y: tail.y + dy * t + py * off })
  }
  return pts
}

function drawSnake(
  g: Draw,
  link: Link,
  color: string,
  cell: number,
  now: number,
  idx: number,
): void {
  const pts = snakePath(link, cell, now, idx)
  const N = pts.length
  const bodyW = cell * 0.36
  /** Width at t (0 tail .. 1 head): a tapering tail, a thicker middle, a slimmer neck. */
  const width = (t: number) => bodyW * (0.25 + 0.75 * Math.min(1, t * 2.6)) * (t > 0.9 ? 0.9 : 1)
  const c = g.ctx
  c.lineCap = 'round'
  const stroke = (col: string, wk: number, add = 0, sx = 0, sy = 0) => {
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (!a || !b) continue
      c.beginPath()
      c.moveTo(a.x + sx, a.y + sy)
      c.lineTo(b.x + sx, b.y + sy)
      c.strokeStyle = col
      c.lineWidth = width(i / (N - 1)) * wk + add
      c.stroke()
    }
  }
  stroke('rgba(0,0,0,0.25)', 1, 10, 7, 10)
  stroke(shade(color, -0.5), 1, 10)
  stroke(color, 1)
  stroke(shade(color, 0.3), 0.38, 0, -bodyW * 0.12, -bodyW * 0.16)
  // Diamonds down the back.
  for (let i = 6; i < N - 8; i += 5) {
    const p = pts[i]
    const q = pts[i + 1]
    if (!p || !q) continue
    const a = Math.atan2(q.y - p.y, q.x - p.x)
    const k = width(i / (N - 1)) * 0.3
    g.at(p.x, p.y, a, () => g.poly([-k * 1.3, 0, 0, -k, k * 1.3, 0, 0, k], shade(color, -0.32)))
  }
  // Head: an oval wider than the neck, eyes looking ahead, a flicking tongue.
  const hd = pts[N - 1] ?? squareAt(link.from)
  const nk = pts[N - 4] ?? hd
  const ang = Math.atan2(hd.y - nk.y, hd.x - nk.x)
  const r = bodyW * 0.7
  g.at(hd.x, hd.y, ang, () => {
    const flick = Math.sin(now * 9 + idx * 2) > 0.2
    if (flick) {
      g.line(r * 0.9, 0, r * 1.7, 0, C.redDark, 5)
      g.line(r * 1.7, 0, r * 2.05, -r * 0.3, C.redDark, 4)
      g.line(r * 1.7, 0, r * 2.05, r * 0.3, C.redDark, 4)
    }
    g.ellipse(4, 7, r * 1.25, r, 'rgba(0,0,0,0.25)')
    g.ellipse(0, 0, r * 1.3, r * 1.04, shade(color, -0.5))
    g.ellipse(0, 0, r * 1.2, r * 0.94, color)
    g.alpha(0.45, () => g.ellipse(-r * 0.2, -r * 0.4, r * 0.55, r * 0.22, '#fff'))
    for (const s of [-1, 1]) {
      g.circle(r * 0.35, s * r * 0.48, r * 0.36, C.white)
      g.circle(r * 0.47, s * r * 0.44, r * 0.18, C.ink)
      g.circle(r * 0.42, s * r * 0.5, r * 0.07, C.white)
    }
    g.circle(r * 1.05, -r * 0.18, r * 0.06, shade(color, -0.6))
    g.circle(r * 1.05, r * 0.18, r * 0.06, shade(color, -0.6))
  })
}

// ---------- tokens ----------

/**
 * A glossy toy pawn: flared skirt, collar and head. Red's head is a ball,
 * blue's a rounded cube, so the sides read without colour. (x, y) is where it
 * stands; `lift` raises it off the board, `sq` squashes (> 0) or stretches (< 0).
 */
/** Each pawn stands upright for its owner (blue's turn to face the top edge in local 2P). */
export function pawn(g: Draw, side: Side, x: number, y: number, r: number, lift = 0, sq = 0): void {
  const angle = g.orient(side)
  if (angle === 0) pawnUpright(g, side, x, y, r, lift, sq)
  else g.at(x, y, angle, () => pawnUpright(g, side, 0, 0, r, lift, sq))
}

function pawnUpright(
  g: Draw,
  side: Side,
  x: number,
  y: number,
  r: number,
  lift: number,
  sq: number,
): void {
  const col = SIDE[side].main
  g.shadow(x, y + r * 0.62, r * (0.95 - lift * 0.3), r * 0.3, 0.42 - lift * 0.2)
  g.at(
    x,
    y + r * 0.62 - lift * r * 1.4,
    0,
    () => {
      const by = -r * 0.62
      const body = g.lin(-r * 0.7, 0, r * 0.7, 0, [
        [0, shade(col, -0.35)],
        [0.4, shade(col, 0.22)],
        [1, shade(col, -0.45)],
      ])
      g.ellipse(0, 0, r * 0.82, r * 0.3, shade(col, -0.5))
      g.path((p) => {
        p.moveTo(-r * 0.8, by + r * 0.6)
        p.quadraticCurveTo(-r * 0.2, by + r * 0.3, -r * 0.28, by - r * 0.2)
        p.lineTo(r * 0.28, by - r * 0.2)
        p.quadraticCurveTo(r * 0.2, by + r * 0.3, r * 0.8, by + r * 0.6)
        p.closePath()
      }, body)
      g.ellipse(0, by + r * 0.6, r * 0.8, r * 0.24, shade(col, -0.15))
      g.alpha(0.5, () => g.ellipse(-r * 0.25, by + r * 0.55, r * 0.3, r * 0.08, '#fff'))
      g.ellipse(0, by - r * 0.2, r * 0.42, r * 0.13, shade(col, -0.25))
      const hy = by - r * 0.62
      if (side === 0) g.ball(0, hy, r * 0.5, col)
      else {
        const k = r * 0.46
        g.rrect(-k, hy - k + 3, k * 2, k * 2, k * 0.45, shade(col, -0.4))
        g.rrect(
          -k,
          hy - k,
          k * 2,
          k * 2,
          k * 0.45,
          g.lin(-k, hy - k, k, hy + k, [
            [0, shade(col, 0.4)],
            [1, shade(col, -0.15)],
          ]),
        )
        g.alpha(0.7, () => g.ellipse(-k * 0.35, hy - k * 0.5, k * 0.35, k * 0.17, '#fff', -0.5))
      }
    },
    1 + sq * 0.18,
    1 - sq * 0.22,
  )
}

/** Where a token sits right now: resting, hopping along the track, or tweening up a ladder / down a snake. */
export interface Anim {
  side: Side
  from: number
  path: number[]
  link: Link | null
  start: number
}

export function tokenSpot(
  anim: Anim | null,
  side: Side,
  resting: number,
  now: number,
  board?: Board,
): { x: number; y: number; lift: number; sq: number } {
  if (!anim || anim.side !== side) return { ...spot(side, resting), lift: 0, sq: 0 }
  const t = now - (anim.start + ROLL_T)
  const n = anim.path.length
  if (t < 0) return { ...spot(side, anim.from), lift: 0, sq: 0 }
  if (t < n * HOP) {
    const k = Math.floor(t / HOP)
    const f = (t - k * HOP) / HOP
    const a = spot(side, k === 0 ? anim.from : (anim.path[k - 1] ?? anim.from))
    const b = spot(side, anim.path[k] ?? anim.from)
    const e = outCubic(f)
    return {
      x: a.x + (b.x - a.x) * e,
      y: a.y + (b.y - a.y) * e,
      lift: Math.sin(f * Math.PI) * (k === 0 && anim.from === 0 ? 1.2 : 0.6),
      sq: f > 0.85 ? (f - 0.85) * 5 : f < 0.12 ? -0.3 : 0,
    }
  }
  const landed = spot(side, anim.path[n - 1] ?? anim.from)
  const u = t - n * HOP
  const settle = Math.max(0, 1 - u / 0.22) * Math.sin(u * 28) * 0.8
  if (!anim.link || u < LINK_PAUSE) return { ...landed, lift: 0, sq: settle }
  const f = Math.min(1, (u - LINK_PAUSE) / LINK_T)
  const to = spot(side, anim.link.to)
  if (f >= 1) {
    const v = u - LINK_PAUSE - LINK_T
    return { ...to, lift: 0, sq: Math.max(0, 1 - v / 0.25) * Math.sin(v * 26) }
  }
  const climb = anim.link.to > anim.link.from
  const link = anim.link
  const si = board && !climb ? board.snakes.findIndex((sn) => sn.from === link.from) : -1
  if (si >= 0) {
    // Ride the snake's body from head to tail.
    const pts = snakePath(link, BOARD.cell, now, si)
    const e = f * f * (3 - 2 * f)
    const at = (1 - e) * (pts.length - 1)
    const i = Math.floor(at)
    const a = pts[i] ?? to
    const b = pts[Math.min(pts.length - 1, i + 1)] ?? to
    const k = at - i
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, lift: 0.15, sq: 0.15 }
  }
  // Ladders: a rung-by-rung climb; snakes: the token rides the snake's body down.
  const e = climb ? f + Math.sin(f * Math.PI * 10) * 0.012 : f * f * (3 - 2 * f)
  const wob = climb ? 0 : Math.sin(f * Math.PI * 5) * 22 * (1 - f)
  const dx = to.x - landed.x
  const dy = to.y - landed.y
  const len = Math.hypot(dx, dy) || 1
  return {
    x: landed.x + dx * e + (-dy / len) * wob,
    y: landed.y + dy * e + (dx / len) * wob,
    lift: climb ? 0.25 + Math.abs(Math.sin(f * Math.PI * 5)) * 0.15 : 0.1,
    sq: climb ? -0.15 : 0.2,
  }
}

export interface RenderState {
  turn: Side
  pos: [number, number]
  dice: [number, number]
  rolledAt: [number, number]
  anim: Anim | null
  end: { winner: Side; at: number } | null
}

/** A side's start pad: an inset well its token waits in before entering at square 1. */
function drawPad(g: Draw, side: Side, home: boolean): void {
  inFrame(g, side, () => {
    const col = SIDE[side].main
    g.rrect(PAD.x - 86, PAD.y - 80, 172, 168, 44, alpha('#000000', 0.3))
    g.rrect(PAD.x - 86, PAD.y - 80, 172, 168, 44, undefined, alpha(col, home ? 0.25 : 0.6), 5)
    g.at(PAD.x, PAD.y + 58, textAngle(g, side), () =>
      g.text('START', 0, 0, { size: 34, weight: 700, color: alpha(C.white, home ? 0.3 : 0.6) }),
    )
  })
  // Once the token is out on the board, a faint ghost keeps the well from reading as empty.
  if (home) {
    const at = frame(side, PAD.x, PAD.y - 6)
    g.alpha(0.2, () => pawn(g, side, at.x, at.y, BOARD.cell * 0.38))
  }
}

/** Everything on the board, tokens and dice, drawn for this frame. */
export function renderSnakes(
  g: Draw,
  s: RenderState,
  board: Board,
  now: number,
  over: boolean,
  isBot: (side: Side) => boolean,
): void {
  const cell = BOARD.cell
  drawBoardBase(g)
  // Ladders and snakes sit between the board and the tokens; the numbers go over them.
  for (const l of board.ladders) drawLadder(g, l, cell)
  board.snakes.forEach((sn, i) =>
    drawSnake(g, sn, SNAKE_COLORS[i % SNAKE_COLORS.length] ?? C.green, cell, now, i),
  )
  drawNumbers(g)
  for (const side of [0, 1] as Side[]) drawPad(g, side, s.pos[side] > 0)
  // The side to move gets a soft spotlight under its token.
  const live = !over && !s.anim
  // Tokens: resting ones first, then the moving one on top.
  const order: Side[] = s.anim ? ([s.anim.side === 0 ? 1 : 0, s.anim.side] as Side[]) : [0, 1]
  for (const side of order) {
    const t = tokenSpot(s.anim, side, s.pos[side], now, board)
    const shared = s.pos[0] === s.pos[1] && s.pos[side] > 0 && (!s.anim || s.anim.side !== side)
    const nudge = shared ? (side === 0 ? -cell * 0.2 : cell * 0.2) : 0
    if (live && side === s.turn) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 6)
      g.alpha(0.3 + pulse * 0.3, () =>
        g.circle(t.x + nudge, t.y + cell * 0.2, cell * 0.42, C.yellow),
      )
    }
    let lift = t.lift
    if (s.end && s.end.winner === side) {
      lift += Math.abs(Math.sin((now - s.end.at) * 6)) * 0.7
    }
    pawn(g, side, t.x + nudge, t.y, cell * 0.38, lift, t.sq)
  }
  // Each player's die, the square counter, and a prompt.
  for (const side of [0, 1] as Side[]) {
    const active = s.turn === side && !over
    const since = now - s.rolledAt[side]
    const tumbling = since < ROLL_T
    const ready = active && !s.anim && !isBot(side)
    inFrame(g, side, () => {
      // Felt cup behind the die, owned by the side, glowing when it is yours to roll.
      const col = SIDE[side].main
      const face = active ? shade(col, -0.5) : shade(C.ink3, -0.1)
      const pulse = ready ? 0.5 + 0.5 * Math.sin(now * 6) : 0
      if (ready)
        g.alpha(0.25 + pulse * 0.35, () =>
          g.rrect(DIE.x - 136, DIE.y - 128, 272, 256, 70, C.yellow),
        )
      g.rrect(DIE.x - 126, DIE.y - 118, 252, 244, 64, shade(C.woodDark, -0.4))
      g.rrect(
        DIE.x - 120,
        DIE.y - 118,
        240,
        232,
        60,
        g.rad(DIE.x, DIE.y, 10, 170, [
          [0, shade(face, 0.12)],
          [1, shade(face, -0.4)],
        ]),
      )
      let face0 = s.dice[side]
      let angle = 0
      let x = DIE.x
      let y = DIE.y
      let squash = 0
      if (tumbling) {
        const p = since / ROLL_T
        face0 = p > 0.85 ? face0 : 1 + (Math.floor(now * 22 + side * 3) % 6)
        y -= Math.abs(Math.sin(p * 3 * Math.PI)) * (1 - p) * 60
        x += Math.sin(p * 9) * (1 - p) * 22
        angle = (1 - outCubic(p)) * 7
      } else if (since < ROLL_T + 0.25) {
        squash = Math.max(0, 1 - outBack(prog(since, ROLL_T, ROLL_T + 0.25)))
      }
      const breathe = ready ? Math.sin(now * 5) * 5 : 0
      g.alpha(active ? 1 : 0.55, () =>
        drawDie(g, x, y - breathe, DIE.size, face0 || 1, {
          angle: angle + (ready ? Math.sin(now * 3) * 0.06 : 0),
          squash,
          color: active ? C.white : shade(C.white, -0.25),
        }),
      )
      const ta = textAngle(g, side)
      if (ready)
        g.at(DIE.x, DIE.y + 160, ta, () =>
          g.text('Tap to roll', 0, 0, {
            size: 38,
            weight: 700,
            color: C.yellow,
            drop: alpha('#000000', 0.4),
          }),
        )
      g.at(COUNT.x, COUNT.y, ta, () => {
        g.text('SQUARE', 0, -52, { size: 34, weight: 700, color: alpha(C.white, 0.55) })
        g.text(s.pos[side] === 0 ? '–' : s.pos[side], 0, 14, {
          size: 76,
          weight: 700,
          color: SIDE[side].main,
          drop: alpha('#000000', 0.4),
        })
      })
    })
  }
}

/** The closing call over the board, readable from both edges, popping in. */
export function endBanner(g: Draw, text: string, side: Side, at0: number, now: number): void {
  const k = prog(now, at0, at0 + 0.45)
  if (k <= 0) return
  const scale = 0.4 + 0.6 * outBack(k)
  const one = (angle: number, cy: number) =>
    g.at(
      W / 2,
      cy,
      angle,
      () => {
        const w = g.measure(text, 72, 700) + 110
        g.rrect(-w / 2 - 8, -62, w + 16, 132, 66, alpha(C.ink, 0.6))
        g.tile(-w / 2, -58, w, 124, 58, SIDE[side].main, 12)
        g.text(text, 0, -2, { size: 72, weight: 700, color: C.white, drop: alpha('#000000', 0.35) })
      },
      scale,
    )
  g.alpha(k, () => {
    if (g.flipTop) {
      one(g.orient(0), MID + 200)
      one(g.orient(1), MID - 200)
    } else one(g.orient(), MID)
  })
}
