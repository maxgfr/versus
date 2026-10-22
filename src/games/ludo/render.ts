import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { drawDie, inFrame, ROLL_TIME, textAngle } from '../../engines/dice/index.ts'
import {
  BASE,
  FINISH,
  HOME_CELLS,
  legalTokens,
  SAFE,
  START,
  TOKENS,
  TRACK,
  TRACK_CELLS,
  trackOf,
  type Tokens,
} from './rules.ts'

/** One square of the 15 × 15 grid, in world units (keeps the left arm clear of the pause button). */
export const CELL = 54
/** Top-left of the grid on the table, centred. */
const BX = (W - 15 * CELL) / 2
const BY = MID - (15 * CELL) / 2
/** Token radius. */
export const TOKEN_R = CELL * 0.54
/** Seconds per square a token hops. */
export const HOP = 0.14
/** Seconds a captured token takes to fly back to its base. */
export const CAP_FLY = 0.55

/**
 * Each side's die sits in the empty corner on its own half (red: bottom-right,
 * blue: top-left), written in red's frame; that corner is the side's dice tray.
 */
export const DIE = { x: BX + 12 * CELL, y: BY + 12 * CELL - 14, size: 132, hit: 300 }
const TRAY = { x: BX + 9 * CELL, y: BY + 9 * CELL, s: 6 * CELL }
/** Home progress row, red's frame (below the board). */
const HOME_ROW = { x: W / 2, y: 1478 }

/** A token on the move: it hops along `path` (progress values) and may capture on landing. */
export interface Move {
  side: Side
  token: number
  from: number
  to: number
  face: number
  path: number[]
  captured: { side: Side; token: number; prog: number }[]
  start: number
  hop: number
  landed: boolean
}

/** Game time the mover lands on its last square. */
export const landTime = (m: Move): number => m.start + m.path.length * HOP
/** Game time the whole move (including any capture flight) is over. */
export const moveEnd = (m: Move): number =>
  landTime(m) + (m.captured.length > 0 ? CAP_FLY + 0.1 : 0.22)

/** Base slots (grid units) for each side's four tokens, inside the side's corner. */
const BASE_SLOTS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [2, 11],
    [4, 11],
    [2, 13],
    [4, 13],
  ],
  [
    [11, 2],
    [13, 2],
    [11, 4],
    [13, 4],
  ],
]

/** Grid units → world. */
const at = (gx: number, gy: number): { x: number; y: number } => ({
  x: BX + gx * CELL,
  y: BY + gy * CELL,
})

/** Finished tokens gather in the centre, each side on its own triangle. */
function pileSlot(side: Side, rank: number): [number, number] {
  return [7.5 + (rank - 1.5) * 0.62, side === 0 ? 8.3 : 6.7]
}

/** Grid position (units) of a token at progress `prog`. `rank` orders finished tokens. */
function gridOf(side: Side, prog: number, token: number, rank: number): readonly [number, number] {
  if (prog === BASE) return BASE_SLOTS[side]?.[token] ?? [0, 0]
  if (prog === FINISH) return pileSlot(side, rank)
  if (prog >= TRACK) {
    const c = HOME_CELLS[side]?.[prog - TRACK]
    return c ? [c[0] + 0.5, c[1] + 0.5] : [7.5, 7.5]
  }
  const idx = trackOf(side, prog)
  const c = idx === null ? undefined : TRACK_CELLS[idx]
  return c ? [c[0] + 0.5, c[1] + 0.5] : [7.5, 7.5]
}

/** World position of a token (before any stacking nudge). */
export function tokenWorld(
  side: Side,
  prog: number,
  token: number,
  rank: number,
): { x: number; y: number } {
  const [gx, gy] = gridOf(side, prog, token, rank)
  return at(gx, gy)
}

/** How many finished tokens of `side` sit before token `i`: its slot in the centre pile. */
export function rankOf(tok: Tokens, side: Side, i: number): number {
  let r = 0
  for (let j = 0; j < i; j++) if (tok[side][j] === FINISH) r++
  return r
}

// ---------- the board ----------

const CREAM = '#fff3dc'

function homeSide(c: number, r: number): Side | null {
  for (const side of [0, 1] as Side[]) {
    if (HOME_CELLS[side]?.some(([hc, hr]) => hc === c && hr === r)) return side
  }
  return null
}

function trackIndexAt(c: number, r: number): number | null {
  const i = TRACK_CELLS.findIndex(([tc, tr]) => tc === c && tr === r)
  return i < 0 ? null : i
}

function cell(g: Draw, c: number, r: number, fill: string): void {
  const x = BX + c * CELL + 3
  const y = BY + r * CELL + 3
  const w = CELL - 6
  g.rrect(x, y + 4, w, w - 2, 11, shade(fill, -0.32))
  g.rrect(
    x,
    y,
    w,
    w - 2,
    11,
    g.lin(0, y, 0, y + w, [
      [0, shade(fill, 0.1)],
      [1, shade(fill, -0.06)],
    ]),
  )
}

/** A side's base: a team-coloured corner with a cream plate and four wells. */
function base(g: Draw, side: Side, c0: number, r0: number): void {
  const col = SIDE[side].main
  const x = BX + c0 * CELL + 4
  const y = BY + r0 * CELL + 4
  const s = 6 * CELL - 8
  g.rrect(
    x,
    y,
    s,
    s,
    30,
    g.lin(x, y, x + s, y + s, [
      [0, shade(col, 0.08)],
      [1, shade(col, -0.32)],
    ]),
  )
  g.alpha(0.35, () => g.rrect(x + 6, y + 5, s - 12, s * 0.3, 24, alpha('#ffffff', 0.35)))
  const px = BX + (c0 + 0.75) * CELL
  const py = BY + (r0 + 0.75) * CELL
  const ps = 4.5 * CELL
  g.rrect(px, py + 6, ps, ps, 28, shade(col, -0.5))
  g.rrect(px, py, ps, ps, 28, CREAM)
  for (const [gx, gy] of BASE_SLOTS[side] ?? []) {
    const p = at(gx, gy)
    g.circle(p.x, p.y, CELL * 0.62, shade(col, -0.05))
    g.circle(p.x, p.y + 4, CELL * 0.5, shade(col, -0.45))
    g.circle(p.x, p.y + 6, CELL * 0.46, shade(col, -0.25))
  }
}

/** An empty corner that serves as a side's dice tray: felt, tinted by its owner when live. */
function tray(g: Draw, side: Side, live: boolean, ready: boolean, now: number): void {
  inFrame(g, side, () => {
    const x = TRAY.x + 4
    const y = TRAY.y + 4
    const s = TRAY.s - 8
    const col = SIDE[side].main
    const face = live ? shade(col, -0.55) : shade(C.ink3, -0.1)
    g.rrect(x, y, s, s, 30, shade(C.woodDark, -0.45))
    g.rrect(
      x + 6,
      y + 6,
      s - 12,
      s - 12,
      26,
      g.rad(DIE.x, DIE.y, 10, s * 0.7, [
        [0, shade(face, 0.14)],
        [1, shade(face, -0.35)],
      ]),
    )
    if (ready) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 6)
      g.alpha(0.45 + pulse * 0.45, () =>
        g.rrect(x + 6, y + 6, s - 12, s - 12, 26, undefined, C.yellow, 7),
      )
    }
  })
}

function drawBoard(g: Draw, turn: Side, over: boolean, ready: boolean, now: number): void {
  const span = 15 * CELL
  g.shadow(W / 2, BY + span + 46, span * 0.52, 38, 0.5)
  g.tile(BX - 26, BY - 26, span + 52, span + 52 + 22, 48, C.woodDark, 22)
  g.rrect(
    BX - 26,
    BY - 26,
    span + 52,
    span + 52,
    48,
    g.lin(BX, BY, BX + span, BY + span, [
      [0, shade(C.wood, -0.02)],
      [1, shade(C.wood, -0.25)],
    ]),
  )
  g.alpha(0.5, () => g.rrect(BX - 18, BY - 22, span + 36, 26, 14, alpha('#ffffff', 0.2)))
  g.rrect(BX - 6, BY - 6, span + 12, span + 12, 30, shade(C.woodDark, -0.35))
  g.rrect(BX - 2, BY - 2, span + 4, span + 4, 28, shade(C.ink2, 0.05))
  base(g, 0, 0, 9)
  base(g, 1, 9, 0)
  tray(g, 0, !over && turn === 0, ready && turn === 0, now)
  tray(g, 1, !over && turn === 1, ready && turn === 1, now)
  // Track and arm cells.
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const inCross = (c >= 6 && c <= 8) || (r >= 6 && r <= 8)
      if (!inCross) continue
      if (c >= 6 && c <= 8 && r >= 6 && r <= 8) continue
      const home = homeSide(c, r)
      const idx = trackIndexAt(c, r)
      let fill: string = CREAM
      if (home !== null) {
        const k = HOME_CELLS[home]?.findIndex(([hc, hr]) => hc === c && hr === r) ?? 0
        fill = shade(SIDE[home].main, 0.05 + k * 0.03)
      } else if (idx === null) fill = shade(C.ink3, 0.18)
      if (idx !== null && idx === START[0]) fill = SIDE[0].main
      if (idx !== null && idx === START[1]) fill = SIDE[1].main
      cell(g, c, r, fill)
    }
  }
  // Safe squares: a star (white on the start squares, ink on the others).
  for (const idx of SAFE) {
    const cc = TRACK_CELLS[idx]
    if (!cc) continue
    const p = at(cc[0] + 0.5, cc[1] + 0.5)
    const start = idx === START[0] || idx === START[1]
    g.star(p.x, p.y - 1, CELL * 0.27, start ? alpha(C.white, 0.9) : alpha(C.ink, 0.28), 5, 0.48)
  }
  // Entry arrows: the square each side turns into its home column from.
  for (const side of [0, 1] as Side[]) {
    const idx = (START[side] + TRACK - 1) % TRACK
    const cc = TRACK_CELLS[idx]
    if (!cc) continue
    const p = at(cc[0] + 0.5, cc[1] + 0.5)
    const d = side === 0 ? -1 : 1
    const k = CELL * 0.2
    g.poly(
      [p.x, p.y + d * k * 1.3, p.x - k, p.y - d * k * 0.2, p.x + k, p.y - d * k * 0.2],
      alpha(SIDE[side].main, 0.85),
    )
    g.rrect(
      p.x - k * 0.35,
      p.y - d * k * 0.3 - (d > 0 ? k : 0),
      k * 0.7,
      k,
      3,
      alpha(SIDE[side].main, 0.85),
    )
  }
  centre(g)
}

/** The four triangles of the centre; red's and blue's point at their home columns. */
function centre(g: Draw): void {
  const tl = at(6, 6)
  const tr = at(9, 6)
  const br = at(9, 9)
  const bl = at(6, 9)
  const mid = at(7.5, 7.5)
  const tri = (a: { x: number; y: number }, b: { x: number; y: number }, c0: string) =>
    g.poly(
      [mid.x, mid.y, a.x, a.y, b.x, b.y],
      g.lin((a.x + b.x) / 2, (a.y + b.y) / 2, mid.x, mid.y, [
        [0, shade(c0, -0.12)],
        [1, shade(c0, 0.18)],
      ]),
    )
  g.rrect(tl.x, tl.y, 3 * CELL, 3 * CELL, 8, shade(C.woodDark, -0.3))
  tri(tl, bl, shade(C.wood, -0.05))
  tri(tr, br, shade(C.wood, -0.05))
  tri(tl, tr, SIDE[1].main)
  tri(bl, br, SIDE[0].main)
  g.alpha(0.25, () => {
    g.line(tl.x, tl.y, br.x, br.y, '#000', 3)
    g.line(tr.x, tr.y, bl.x, bl.y, '#000', 3)
  })
  g.star(mid.x, mid.y, CELL * 0.34, shade(C.wood, 0.35), 5, 0.5)
}

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
      // Skirt.
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
      // Collar.
      g.ellipse(0, by - r * 0.2, r * 0.42, r * 0.13, shade(col, -0.25))
      // Head.
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

interface Placed {
  side: Side
  token: number
  x: number
  y: number
  lift: number
  sq: number
  /** Can be moved with the die showing: bounces and glows. */
  legal: boolean
}

/** Where every token is drawn right now, grouped so tokens sharing a square fan out. */
function layout(s: View, now: number, legal: number[]): Placed[] {
  const out: Placed[] = []
  const m = s.move
  for (const side of [0, 1] as Side[]) {
    for (let i = 0; i < TOKENS; i++) {
      const pr = s.tok[side][i] ?? BASE
      const rank = rankOf(s.tok, side, i)
      if (m && m.side === side && m.token === i && now < landTime(m) + 0.2) {
        const n = m.path.length
        const elapsed = now - m.start
        const k = Math.min(n - 1, Math.floor(elapsed / HOP))
        const f = Math.min(1, Math.max(0, (elapsed - k * HOP) / HOP))
        const seq = [m.from, ...m.path]
        const a = gridOf(side, seq[k] ?? m.from, i, rank)
        const b = gridOf(side, seq[k + 1] ?? m.to, i, rank)
        const e = outCubic(f)
        const p = at(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e)
        const landed = elapsed >= n * HOP
        const after = elapsed - n * HOP
        // Squash on each touchdown, a bigger one on the final square.
        const sq = landed
          ? Math.max(0, 1 - after / 0.2) * Math.sin(after * 30) * 0.9
          : f > 0.85
            ? (f - 0.85) * 4
            : f < 0.15
              ? -0.3 + f * 2
              : 0
        out.push({
          side,
          token: i,
          x: p.x,
          y: p.y,
          lift: landed ? 0 : Math.sin(f * Math.PI) * (m.from === BASE ? 0.9 : 0.5),
          sq,
          legal: false,
        })
        continue
      }
      // A captured rival waits on its square until the hitter lands, then flies home.
      const cap = m?.captured.find((c) => c.side === side && c.token === i)
      if (cap && m && now < landTime(m) + CAP_FLY) {
        const a = gridOf(side, cap.prog, i, rank)
        const u = prog(now, landTime(m), landTime(m) + CAP_FLY)
        const b = gridOf(side, BASE, i, rank)
        const e = outCubic(u)
        const p = at(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e)
        out.push({
          side,
          token: i,
          x: p.x,
          y: p.y,
          lift: Math.sin(u * Math.PI) * 2.2,
          sq: 0,
          legal: false,
        })
        continue
      }
      const [gx, gy] = gridOf(side, pr, i, rank)
      const isLegal = side === s.turn && legal.includes(i)
      const bob = isLegal ? Math.abs(Math.sin(now * 6 + i * 0.9)) : 0
      out.push({
        side,
        token: i,
        x: BX + gx * CELL,
        y: BY + gy * CELL,
        lift: bob * 0.3,
        sq: isLegal && bob < 0.15 ? 0.25 : 0,
        legal: isLegal,
      })
    }
  }
  // Fan tokens that share a square out in a small ring.
  const groups = new Map<string, number[]>()
  out.forEach((t, idx) => {
    const key = `${Math.round(t.x)},${Math.round(t.y)}`
    groups.set(key, [...(groups.get(key) ?? []), idx])
  })
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    idxs.forEach((idx, k) => {
      const t = out[idx]
      if (!t) return
      const ang = (k / idxs.length) * Math.PI * 2 + 0.6
      t.x += Math.cos(ang) * CELL * 0.2
      t.y += Math.sin(ang) * CELL * 0.2
    })
  }
  return out
}

/** The part of the game state the board needs to draw itself. */
export interface View {
  turn: Side
  tok: Tokens
  face: number
  dice: [number, number]
  rolledAt: [number, number]
  wait: number
  move: Move | null
  end: { winner: Side; at: number } | null
}

export function renderLudo(
  g: Draw,
  s: View,
  now: number,
  over: boolean,
  isBot: (side: Side) => boolean,
): void {
  const human = !isBot(s.turn)
  const rolling = now - s.rolledAt[s.turn] < ROLL_TIME
  const ready = !over && human && s.face === 0 && s.move === null && now >= s.wait && !rolling
  drawBoard(g, s.turn, over, ready, now)
  // Legal tokens of the side to move bounce and glow, so the tap target is obvious.
  const active = !over && s.face > 0 && s.move === null && now >= s.wait && !rolling
  const legal = active && human ? legalTokens(s.tok, s.turn, s.face) : []
  const toks = layout(s, now, legal)
  const pulse = 0.5 + 0.5 * Math.sin(now * 7)
  for (const t of toks) {
    if (!t.legal) continue
    g.alpha(0.35 + pulse * 0.3, () => g.circle(t.x, t.y + TOKEN_R * 0.55, TOKEN_R * 1.05, C.yellow))
    g.alpha(0.6 + pulse * 0.4, () => g.ring(t.x, t.y + TOKEN_R * 0.55, TOKEN_R * 1.15, C.yellow, 5))
  }
  // Back to front so lower tokens overlap the ones above them.
  toks.sort((a, b) => a.y - b.y)
  const winner = s.end?.winner
  for (const t of toks) {
    let lift = t.lift
    if (winner === t.side && s.end) {
      lift += Math.max(0, Math.sin((now - s.end.at) * 7 - t.token * 0.8)) * 0.6
    }
    const done =
      s.tok[t.side][t.token] === FINISH &&
      !(s.move && s.move.side === t.side && s.move.token === t.token)
    pawn(g, t.side, t.x, t.y, done ? TOKEN_R * 0.78 : TOKEN_R, lift, t.sq)
  }
  // Each side's die in its tray, a prompt, and the home row below the board.
  for (const side of [0, 1] as Side[]) {
    const on = !over && s.turn === side
    const since = now - s.rolledAt[side]
    const tumbling = since < ROLL_TIME
    inFrame(g, side, () => {
      let face = s.dice[side]
      let angle = 0
      let x = DIE.x
      let y = DIE.y
      let squash = 0
      if (tumbling) {
        const p = since / ROLL_TIME
        face = p > 0.85 ? face : 1 + (Math.floor(now * 22 + side * 3) % 6)
        y -= Math.abs(Math.sin(p * 3 * Math.PI)) * (1 - p) * 70
        x += Math.sin(p * 9) * (1 - p) * 26
        angle = (1 - outCubic(p)) * 7
      } else if (since < ROLL_TIME + 0.25) {
        squash = Math.max(0, 1 - outBack(prog(since, ROLL_TIME, ROLL_TIME + 0.25)))
      }
      const myReady = ready && side === s.turn
      const breathe = myReady ? Math.sin(now * 5) * 5 : 0
      g.alpha(on ? 1 : 0.55, () =>
        drawDie(g, x, y - breathe, DIE.size, face, {
          angle: angle + (myReady ? Math.sin(now * 3) * 0.06 : 0),
          squash,
          color: on ? C.white : shade(C.white, -0.25),
        }),
      )
      const ta = textAngle(g, side)
      const label = !on
        ? ''
        : isBot(side)
          ? ''
          : myReady
            ? 'Tap to roll'
            : active && side === s.turn
              ? 'Move a pawn'
              : ''
      if (label)
        g.at(DIE.x, DIE.y + 112, ta, () =>
          g.text(label, 0, 0, {
            size: 34,
            weight: 700,
            color: C.yellow,
            drop: alpha('#000000', 0.4),
          }),
        )
      // Home row: four pawn slots, filled as tokens get home.
      const home = s.tok[side].filter((p) => p === FINISH).length
      g.at(HOME_ROW.x, HOME_ROW.y, ta, () => {
        g.rrect(-300, -62, 600, 124, 62, alpha(C.ink, 0.55))
        g.rrect(-300, -62, 600, 124, 62, undefined, alpha(SIDE[side].main, on ? 0.6 : 0.25), 4)
        g.text('HOME', -218, 2, { size: 34, weight: 700, color: alpha(C.white, 0.6) })
        for (let i = 0; i < TOKENS; i++) {
          const x0 = -110 + i * 76
          if (i < home) pawn(g, side, x0, 4, 26)
          else {
            g.ellipse(x0, 22, 24, 9, alpha('#000000', 0.35))
            g.alpha(0.3, () => pawn(g, side, x0, 4, 26))
          }
        }
        g.text(`${home}/${TOKENS}`, 226, 2, {
          size: 50,
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
      one(g.orient(0), MID + 190)
      one(g.orient(1), MID - 190)
    } else one(g.orient(), MID + 190)
  })
}
