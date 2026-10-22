import type { Side } from '../../core/game.ts'
import { clamp, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { HEADER } from '../../engines/puzzle/index.ts'
import {
  canDrop,
  type Deal,
  destinationFor,
  type Dst,
  home,
  isRed,
  rankOf,
  run,
  type Src,
  suitOf,
} from './rules.ts'

/*
 * Everything below is laid out in "table units": the geometry of a half panel
 * (1000 × 900). In solo the table is scaled and shifted as a whole (see
 * `tableView`) so the seven columns stay clear of the pause button.
 */

export const CARD_W = 124
export const CARD_H = 172
const GAP = 8
/** Left margin of the seven columns. */
const X0 = 42
/** Top row: stock, waste, the home counter, four foundations. */
export const TOP_Y = HEADER + 22
/** Tableau top. */
export const TAB_Y = TOP_Y + CARD_H + 26
/** Visible strip of a face-down card, and the range for face-up strips. */
const DOWN_STEP = 14
const UP_MIN = 34
const UP_MAX = 52
/** Keys for the card that last moved (see `keyOf`). */
export const WASTE_KEY = 200
export const FOUND_KEY = 210
export const STOCK_KEY = 220
/** How long a tableau card takes to flip over (s), and a landing to settle. */
export const FLIP = 0.24
const SETTLE = 0.3

export const colX = (c: number): number => X0 + c * (CARD_W + GAP)

/** Key of a tableau card: the card at `idx` in column `col`. */
export const keyOf = (col: number, idx: number): number => col * 24 + idx

/** Where the table sits in a panel: scale `k`, offset (tx, ty), and its height in table units. */
export interface TableView {
  k: number
  tx: number
  ty: number
  h: number
}

/** The table for a panel of w × h. Solo scales it down a touch and keeps it right of x = 110. */
export function tableView(w: number, h: number): TableView {
  if (h <= 1000) return { k: 1, tx: 0, ty: 0, h }
  const k = 0.92
  const left = 122
  const tx = left - X0 * k
  const ty = HEADER + 34 - TOP_Y * k
  void w
  return { k, tx, ty, h: (h - ty) / k }
}

/** Panel-local point → table units. */
export const toTable = (v: TableView, x: number, y: number): { x: number; y: number } => ({
  x: (x - v.tx) / v.k,
  y: (y - v.ty) / v.k,
})

/** Table units → panel-local point. */
export const fromTable = (v: TableView, x: number, y: number): { x: number; y: number } => ({
  x: v.tx + x * v.k,
  y: v.ty + y * v.k,
})

/** Vertical step of a face-up card in column `col`: as large as fits a table of height `h`. */
export function upStep(h: number, d: Deal, col: number): number {
  const avail = h - 18 - TAB_Y - CARD_H
  const up = (d.tab[col]?.length ?? 0) - (d.down[col] ?? 0)
  if (up <= 1) return UP_MAX
  const room = avail - DOWN_STEP * (d.down[col] ?? 0)
  return Math.max(UP_MIN, Math.min(UP_MAX, Math.floor(room / (up - 1))))
}

/** Top y of card `idx` in column `col`. */
export function cardY(h: number, d: Deal, col: number, idx: number): number {
  const down = d.down[col] ?? 0
  if (idx < down) return TAB_Y + idx * DOWN_STEP
  return TAB_Y + down * DOWN_STEP + (idx - down) * upStep(h, d, col)
}

/** Top-left of the card a key names (tableau, waste, foundation or stock), in table units. */
export function keyPos(h: number, d: Deal, key: number): { x: number; y: number } {
  if (key >= STOCK_KEY) return { x: colX(0), y: TOP_Y }
  if (key >= FOUND_KEY) return { x: colX(3 + key - FOUND_KEY), y: TOP_Y }
  if (key >= WASTE_KEY) return { x: colX(1), y: TOP_Y }
  const col = Math.floor(key / 24)
  return { x: colX(col), y: cardY(h, d, col, key % 24) }
}

export type Hit = { kind: 'stock' } | { kind: 'src'; src: Src }

/**
 * Where a card dragged to centre (cx, cy) would land: anywhere on the
 * foundation row is its suit's pile, otherwise the column under it. Its own
 * column is no target (letting go there just puts it back).
 */
export function dropAt(h: number, d: Deal, src: Src, cx: number, cy: number): Dst | null {
  void h
  const first = run(d, src)[0]
  if (first === undefined) return null
  if (cy < TAB_Y - 14) {
    return cx >= colX(3) - GAP ? { to: 'found', suit: suitOf(first) } : null
  }
  const col = Math.round((cx - X0 - CARD_W / 2) / (CARD_W + GAP))
  if (col < 0 || col > 6) return null
  if (Math.abs(cx - (colX(col) + CARD_W / 2)) > (CARD_W + GAP) * 0.75) return null
  if (src.from === 'tab' && src.col === col) return null
  return { to: 'tab', col }
}

/** What a tap at table-unit (x, y) picked, or null. */
export function hitAt(h: number, d: Deal, x: number, y: number): Hit | null {
  if (y >= TOP_Y && y <= TOP_Y + CARD_H) {
    if (x >= colX(0) && x <= colX(0) + CARD_W) return { kind: 'stock' }
    if (x >= colX(1) && x <= colX(1) + CARD_W && d.waste.length) {
      return { kind: 'src', src: { from: 'waste' } }
    }
    return null
  }
  if (y < TAB_Y) return null
  for (let col = 0; col < 7; col++) {
    if (x < colX(col) - GAP / 2 || x > colX(col) + CARD_W + GAP / 2) continue
    const n = d.tab[col]?.length ?? 0
    if (n === 0) return null
    const last = n - 1
    if (y > cardY(h, d, col, last) + CARD_H) return null
    // The card on top at this height is the highest one whose top edge is above the finger.
    for (let idx = last; idx >= 0; idx--) {
      if (y < cardY(h, d, col, idx)) continue
      if (idx < (d.down[col] ?? 0)) return null
      return { kind: 'src', src: { from: 'tab', col, idx } }
    }
    return null
  }
  return null
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const

/** A heart around (cx, cy), radius r; `flip` turns it upside down (the spade's body). */
function heartPath(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, flip = 1): void {
  const Y = (v: number) => cy + v * r * flip
  c.moveTo(cx, Y(0.95))
  c.bezierCurveTo(cx - r * 0.2, Y(0.72), cx - r * 1.08, Y(0.2), cx - r * 1.0, Y(-0.32))
  c.bezierCurveTo(cx - r * 0.92, Y(-0.98), cx - r * 0.12, Y(-1.02), cx, Y(-0.46))
  c.bezierCurveTo(cx + r * 0.12, Y(-1.02), cx + r * 0.92, Y(-0.98), cx + r * 1.0, Y(-0.32))
  c.bezierCurveTo(cx + r * 1.08, Y(0.2), cx + r * 0.2, Y(0.72), cx, Y(0.95))
  c.closePath()
}

/** The stem under a spade or a club. */
function stem(g: Draw, cx: number, cy: number, r: number, color: string): void {
  g.path((c) => {
    c.moveTo(cx, cy + r * 0.15)
    c.quadraticCurveTo(cx + r * 0.08, cy + r * 0.8, cx + r * 0.42, cy + r * 1.02)
    c.lineTo(cx - r * 0.42, cy + r * 1.02)
    c.quadraticCurveTo(cx - r * 0.08, cy + r * 0.8, cx, cy + r * 0.15)
    c.closePath()
  }, color)
}

/** A suit as a filled shape (0 ♠, 1 ♥, 2 ♦, 3 ♣), centred on (cx, cy), radius r. */
export function suitShape(
  g: Draw,
  suit: number,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  if (suit === 1) {
    g.path((c) => heartPath(c, cx, cy + r * 0.05, r), color)
  } else if (suit === 2) {
    g.path((c) => {
      c.moveTo(cx, cy - r)
      c.quadraticCurveTo(cx + r * 0.35, cy - r * 0.35, cx + r * 0.78, cy)
      c.quadraticCurveTo(cx + r * 0.35, cy + r * 0.35, cx, cy + r)
      c.quadraticCurveTo(cx - r * 0.35, cy + r * 0.35, cx - r * 0.78, cy)
      c.quadraticCurveTo(cx - r * 0.35, cy - r * 0.35, cx, cy - r)
      c.closePath()
    }, color)
  } else if (suit === 0) {
    g.path((c) => heartPath(c, cx, cy - r * 0.18, r * 0.86, -1), color)
    stem(g, cx, cy, r, color)
  } else {
    const b = r * 0.43
    g.circle(cx, cy - r * 0.5, b, color)
    g.circle(cx - r * 0.5, cy + r * 0.1, b, color)
    g.circle(cx + r * 0.5, cy + r * 0.1, b, color)
    g.circle(cx, cy - r * 0.05, b * 0.6, color)
    stem(g, cx, cy, r, color)
  }
}

/** A little crown for kings and queens. */
function crown(g: Draw, cx: number, cy: number, r: number, color: string, points: number): void {
  const pts: number[] = [cx - r, cy + r * 0.45]
  for (let i = 0; i <= points * 2; i++) {
    const x = cx - r + (i * 2 * r) / (points * 2)
    const up = i % 2 === 0
    pts.push(x, up ? cy - r * 0.55 : cy + r * 0.05)
  }
  pts.push(cx + r, cy + r * 0.45)
  g.poly(pts, color)
  for (let i = 0; i <= points; i++) {
    g.circle(cx - r + (i * 2 * r) / points, cy - r * 0.6, r * 0.14, color)
  }
}

/** Rank and suit in one corner. `strip` is the one-line form for cards that only show their top edge. */
function corner(g: Draw, x: number, y: number, card: number, ink: string, strip: boolean): void {
  const label = RANKS[rankOf(card) - 1] as string
  const size = strip ? 40 : 46
  if (strip) {
    g.text(label, x, y + 19, { size, weight: 700, align: 'left', color: ink })
    const w = g.measure(label, size, 700)
    suitShape(g, suitOf(card), x + w + 16, y + 19, 13, ink)
  } else {
    g.text(label, x + (label === '10' ? -3 : 0), y + 24, {
      size,
      weight: 700,
      align: 'left',
      color: ink,
    })
    suitShape(g, suitOf(card), x + 14, y + 72, 14, ink)
  }
}

/** A face-up card. A strip shows only its top corner; a full card shows both corners and a pip. */
export function face(g: Draw, x: number, y: number, card: number, strip = false): void {
  const ink = isRed(card) ? C.redDark : C.ink
  g.tile(x, y, CARD_W, CARD_H, 16, C.white, 7)
  corner(g, x + 14, y + 8, card, ink, strip)
  if (strip) return
  const rank = rankOf(card)
  if (rank > 10) {
    // Court cards: a tinted panel, a crown for kings and queens, the big letter.
    const px = x + 48
    const py = y + 22
    const pw = CARD_W - 58
    const ph = CARD_H - 46
    const cx = px + pw / 2
    g.rrect(px, py, pw, ph, 12, alpha(isRed(card) ? C.red : C.blue, 0.12), alpha(ink, 0.25), 3)
    if (rank > 11) crown(g, cx, py + 34, rank === 13 ? 22 : 17, C.yellow, rank === 13 ? 3 : 2)
    g.text(RANKS[rank - 1] as string, cx, py + ph - 38, { size: 52, weight: 700, color: ink })
  } else {
    suitShape(g, suitOf(card), x + 80, y + 110, 31, ink)
  }
}

/** A face-down card: the back in the side's colour, with the side's mark. */
export function back(g: Draw, x: number, y: number, side: Side, count?: number): void {
  const col = SIDE[side]
  g.tile(x, y, CARD_W, CARD_H, 16, col.main, 7)
  g.clip(x + 10, y + 10, CARD_W - 20, CARD_H - 27, 9, () => {
    g.rect(x + 10, y + 10, CARD_W - 20, CARD_H - 27, shade(col.main, -0.12))
    for (let k = -CARD_H; k < CARD_W; k += 22) {
      g.line(x + k, y, x + k + CARD_H, y + CARD_H, alpha(C.white, 0.12), 6)
      g.line(x + k + CARD_H, y, x + k, y + CARD_H, alpha(C.white, 0.08), 6)
    }
  })
  g.rrect(x + 10, y + 10, CARD_W - 20, CARD_H - 27, 9, undefined, alpha(C.white, 0.35), 3)
  if (count !== undefined) {
    g.rrect(x + CARD_W / 2 - 38, y + (CARD_H - 7) / 2 - 30, 76, 60, 24, alpha(C.ink, 0.55))
    g.text(count, x + CARD_W / 2, y + (CARD_H - 7) / 2 + 2, {
      size: 42,
      weight: 700,
      color: C.white,
    })
  } else g.sideMark(side, x + CARD_W / 2, y + (CARD_H - 7) / 2, 13, alpha(C.white, 0.45))
}

/** An empty place: a socket to put a card on. */
function slot(g: Draw, x: number, y: number): void {
  g.rrect(x, y, CARD_W, CARD_H - 7, 16, alpha('#000000', 0.28), alpha(C.white, 0.1), 4)
}

export interface Fly {
  /** Key of the (first) card at its new place. */
  key: number
  /** How many cards moved with it. */
  n: number
  /** Where it came from (table units, top-left). */
  x: number
  y: number
  at: number
  /** Seconds the trip takes. */
  dur: number
  /** 1 when it turns face up on the way (a draw from the stock). */
  flip: number
  /** Angle it leaves with (a dragged card keeps the finger's tilt). */
  tilt: number
  /** 0..1 how hard it travels: scales the landing. */
  k: number
  /** The landing has had its sound and sparks. */
  done: boolean
}

/** Card(s) held under a finger. Positions in table units, top-left of the first card. */
export interface Drag {
  id: number
  src: Src
  key: number
  x: number
  y: number
  /** Grab offset: finger minus card corner. */
  gx: number
  gy: number
  /** Where the finger went down. */
  sx: number
  sy: number
  /** Smoothed finger velocity (table units / s). */
  vx: number
  vy: number
  /** Travelled past the tap slop: a drag, not a tap. */
  moved: boolean
  at: number
}

export interface PanelView {
  side: Side
  deal: Deal
  /** Key of the card that moved last, and when. */
  last: number
  lastAt: number
  fly: Fly | null
  drag: Drag | null
  /** A card that just turned face up in the tableau. */
  flipKey: number
  flipAt: number
  /** A tap that could not go anywhere: that card shakes. */
  nopeKey: number
  nopeAt: number
  recycleAt: number
  hint: boolean
  /** This phone belongs to the board's player (online, the rival's cues are not drawn). */
  own: boolean
  /** Game time the board ran out of moves, or -1. */
  stuckAt: number
  now: number
}

/** Is `key` the first card of a move (`first`) or one of the run riding on it? */
function inRun(first: number, key: number): boolean {
  if (key === first) return true
  return (
    first < WASTE_KEY &&
    key < WASTE_KEY &&
    Math.floor(key / 24) === Math.floor(first / 24) &&
    key % 24 > first % 24
  )
}

/**
 * Squash of a card that just landed: flattened on touchdown, then a damped
 * wobble back to rest. Harder throws squash more. [sx, sy].
 */
function landing(v: PanelView, key: number): [number, number] {
  const fl = v.fly
  if (!fl || !inRun(fl.key, key)) return [1, 1]
  const u = (v.now - fl.at - fl.dur) / SETTLE
  if (u < 0 || u >= 1) return [1, 1]
  const amp = (0.05 + 0.08 * fl.k) * (1 - u) * (1 - u) * Math.cos(u * Math.PI * 2.5)
  return [1 + amp, 1 - amp]
}

function nopeX(v: PanelView, key: number): number {
  if (v.nopeKey !== key) return 0
  const k = prog(v.now - v.nopeAt, 0, 0.3)
  return k < 1 ? Math.sin(k * Math.PI * 6) * 9 * (1 - k) : 0
}

function scaled(
  g: Draw,
  x: number,
  y: number,
  sx: number,
  sy: number,
  fn: () => void,
  angle = 0,
): void {
  if (sx === 1 && sy === 1 && !angle) fn()
  else
    g.at(
      x + CARD_W / 2,
      y + CARD_H / 2,
      angle,
      () => g.at(-x - CARD_W / 2, -y - CARD_H / 2, 0, fn),
      sx,
      sy,
    )
}

/** A card's soft drop shadow, further and softer the higher it is lifted. */
function lifted(g: Draw, x: number, y: number, lift: number): void {
  g.rrect(
    x + 6 + lift * 0.25,
    y + 14 + lift * 0.6,
    CARD_W,
    CARD_H - 7,
    16,
    alpha('#000000', clamp(0.3 - lift * 0.0012, 0.12, 0.3)),
  )
}

/** The cards a move carries, with their places relative to the first. */
function carried(h: number, d: Deal, key: number): { card: number; dy: number; strip: boolean }[] {
  if (key >= FOUND_KEY && key < STOCK_KEY) {
    const suit = key - FOUND_KEY
    return [{ card: suit * 13 + (d.found[suit] ?? 1) - 1, dy: 0, strip: false }]
  }
  if (key === WASTE_KEY) {
    const c = d.waste[d.waste.length - 1]
    return c === undefined ? [] : [{ card: c, dy: 0, strip: false }]
  }
  const col = Math.floor(key / 24)
  const cards = d.tab[col] ?? []
  const i0 = key % 24
  const y0 = cardY(h, d, col, i0)
  const out: { card: number; dy: number; strip: boolean }[] = []
  for (let idx = i0; idx < cards.length; idx++) {
    out.push({
      card: cards[idx] as number,
      dy: cardY(h, d, col, idx) - y0,
      strip: idx < cards.length - 1,
    })
  }
  return out
}

/** A soft pool of team-coloured light under the play area: the floodlit table. */
function floodlight(g: Draw, side: Side, x: number, y: number, r: number): void {
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 0, r, [
      [0, alpha(SIDE[side].main, 0.2)],
      [0.55, alpha(SIDE[side].main, 0.07)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
}

export function drawPanel(g: Draw, h: number, v: PanelView): void {
  const d = v.deal
  floodlight(g, v.side, 500, TOP_Y + (h - TOP_Y) * 0.42, 680)
  const fl = v.fly && v.now - v.fly.at < v.fly.dur ? v.fly : null
  const dr = v.drag
  /** Cards drawn elsewhere this frame: in flight, or under the finger. */
  const away = (key: number): boolean =>
    (fl !== null && inRun(fl.key, key)) || (dr !== null && inRun(dr.key, key))

  // Stock: pops when the waste is turned back into it.
  const rec = prog(v.now - v.recycleAt, 0, 0.3)
  const rs = rec < 1 ? 1 + 0.14 * (1 - rec) * (1 - rec) * Math.cos(rec * Math.PI * 2) : 1
  if (d.stock.length) {
    const x = colX(0) + nopeX(v, STOCK_KEY)
    if (d.stock.length > 1) back(g, x + 4, TOP_Y - 5, v.side)
    scaled(g, x, TOP_Y, rs, rs, () => back(g, x, TOP_Y, v.side, d.stock.length))
  } else {
    slot(g, colX(0), TOP_Y)
    const cx = colX(0) + CARD_W / 2
    const cy = TOP_Y + CARD_H / 2 - 4
    const c = d.waste.length ? alpha(C.white, 0.6) : alpha(C.white, 0.18)
    g.arc(cx, cy, 28, -Math.PI * 0.15, Math.PI * 1.35, c, 9)
    g.poly([cx + 26, cy - 22, cx + 44, cy + 4, cx + 14, cy + 4], c)
  }
  // Waste: the top card, and the one under it while the top is away.
  const wTop = d.waste.length - (away(WASTE_KEY) ? 2 : 1)
  if (wTop >= 0) {
    const x = colX(1) + nopeX(v, WASTE_KEY)
    const [sx, sy] = wTop === d.waste.length - 1 ? landing(v, WASTE_KEY) : [1, 1]
    scaled(g, x, TOP_Y, sx, sy, () => face(g, x, TOP_Y, d.waste[wTop] as number))
  } else slot(g, colX(1), TOP_Y)

  // Home counter in the gap of the top row: it jumps when a card lands home.
  const n = home(d)
  const hx = colX(2) + CARD_W / 2
  let hs = 1
  if (v.fly && v.fly.key >= FOUND_KEY && v.fly.key < STOCK_KEY) {
    const u = (v.now - v.fly.at - v.fly.dur) / 0.35
    if (u >= 0 && u < 1) hs = 1 + 0.3 * (1 - u) * (1 - u)
  }
  g.text(n, hx, TOP_Y + CARD_H / 2 - 22, {
    size: 64 * hs,
    weight: 700,
    color: n > 0 ? C.white : alpha(C.white, 0.4),
    drop: alpha('#000000', 0.35),
  })
  g.text('/52 home', hx, TOP_Y + CARD_H / 2 + 36, {
    size: 34,
    weight: 600,
    color: alpha(C.white, 0.6),
    maxWidth: CARD_W + GAP,
  })

  // Foundations.
  for (let s = 0; s < 4; s++) {
    const x = colX(3 + s)
    const top = (d.found[s] ?? 0) - (away(FOUND_KEY + s) ? 1 : 0)
    if (top > 0) {
      const [sx, sy] = top === d.found[s] ? landing(v, FOUND_KEY + s) : [1, 1]
      scaled(g, x, TOP_Y, sx, sy, () => face(g, x, TOP_Y, s * 13 + top - 1))
      if ((d.found[s] ?? 0) === 13) {
        g.alpha(0.75 + 0.25 * Math.sin(v.now * 3 + s), () =>
          g.rrect(x - 3, TOP_Y - 3, CARD_W + 6, CARD_H - 1, 18, undefined, C.yellow, 5),
        )
      }
    } else {
      slot(g, x, TOP_Y)
      suitShape(g, s, x + CARD_W / 2, TOP_Y + CARD_H / 2 - 4, 28, shade(SIDE[v.side].main, -0.45))
    }
  }

  // Tableau: each column bottom card first, so the cards on top overlap the ones beneath.
  const pulse = 0.5 + 0.5 * Math.sin(v.now * 6)
  for (let col = 0; col < 7; col++) {
    const cards = d.tab[col] ?? []
    if (cards.length === 0) {
      slot(g, colX(col), TAB_Y)
      g.text('K', colX(col) + CARD_W / 2, TAB_Y + CARD_H / 2 - 2, {
        size: 52,
        weight: 700,
        color: alpha(C.white, 0.16),
      })
      continue
    }
    const down = d.down[col] ?? 0
    cards.forEach((card, idx) => {
      const key = keyOf(col, idx)
      if (away(key)) return
      const y = cardY(h, d, col, idx)
      const x = colX(col) + nopeX(v, key)
      if (idx < down) {
        back(g, x, y, v.side)
        return
      }
      // A strip while a card lies on it; full again once the cards above are lifted away.
      const strip = idx < cards.length - 1 && !away(keyOf(col, idx + 1))
      if (key === v.flipKey) {
        const k = prog(v.now - v.flipAt, 0, FLIP)
        if (k < 1) {
          const sx = Math.max(0.02, Math.abs(Math.cos(k * Math.PI)))
          scaled(g, x, y, sx, 1 + 0.06 * Math.sin(k * Math.PI), () =>
            k < 0.5 ? back(g, x, y, v.side) : face(g, x, y, card, strip),
          )
          return
        }
      }
      const [sx, sy] = landing(v, key)
      scaled(g, x, y, sx, sy, () => face(g, x, y, card, strip))
      if (v.hint && !strip && destinationFor(d, { from: 'tab', col, idx })) {
        g.alpha(0.3 + 0.4 * pulse, () =>
          g.rrect(x - 4, y - 4, CARD_W + 8, CARD_H - 1, 19, undefined, C.yellow, 5),
        )
      }
    })
  }

  // Dragging: every legal place glows, the one under the card brightest.
  if (dr && dr.moved && v.own) {
    const hover = dropAt(h, d, dr.src, dr.x + CARD_W / 2, dr.y + CARD_H / 2)
    const first = run(d, dr.src)[0] ?? 0
    for (let p = -1; p < 7; p++) {
      const dst: Dst = p < 0 ? { to: 'found', suit: suitOf(first) } : { to: 'tab', col: p }
      if (!canDrop(d, dr.src, dst)) continue
      const on =
        hover !== null &&
        (dst.to === 'found' ? hover.to === 'found' : hover.to === 'tab' && hover.col === dst.col)
      let x: number
      let y: number
      if (dst.to === 'found') {
        x = colX(3 + dst.suit)
        y = TOP_Y
      } else {
        const cards = d.tab[dst.col] ?? []
        x = colX(dst.col)
        y = cards.length ? cardY(h, d, dst.col, cards.length - 1) : TAB_Y
      }
      g.alpha(on ? 0.85 + 0.15 * pulse : 0.25 + 0.15 * pulse, () =>
        g.rrect(x - 5, y - 5, CARD_W + 10, CARD_H + 1, 20, undefined, C.yellow, on ? 7 : 4),
      )
    }
  }

  // Cards in flight, on top of everything: an arc, a swing, a lift.
  if (fl) {
    const e = outCubic(prog(v.now - fl.at, 0, fl.dur))
    const to = keyPos(h, d, fl.key)
    const dist = Math.hypot(to.x - fl.x, to.y - fl.y)
    const arc = Math.sin(e * Math.PI)
    const lift = arc * Math.min(130, 24 + dist * 0.12)
    const x = to.x + (fl.x - to.x) * (1 - e)
    const y = to.y + (fl.y - to.y) * (1 - e) - lift
    const swing = clamp((to.x - fl.x) / 1600, -0.25, 0.25)
    const angle = fl.tilt * (1 - e) + swing * arc
    const s = 1 + arc * (0.06 + 0.06 * fl.k)
    const cards = carried(h, d, fl.key)
    for (const c of cards) lifted(g, x, y + c.dy, lift + 10)
    const sx = fl.flip ? Math.max(0.02, Math.abs(Math.cos(e * Math.PI))) * s : s
    scaled(
      g,
      x,
      y,
      sx,
      s,
      () => {
        for (const c of cards) {
          if (fl.flip && e < 0.5) back(g, x, y + c.dy, v.side)
          else face(g, x, y + c.dy, c.card, c.strip)
        }
      },
      angle,
    )
  }

  // Under the finger: lifted, tilted by the drag's speed.
  if (dr) {
    const cards = carried(h, d, dr.key)
    const lift = dr.moved ? 30 : 14
    const angle = clamp(dr.vx * 0.00022, -0.3, 0.3)
    for (const c of cards) lifted(g, dr.x, dr.y + c.dy, lift)
    scaled(
      g,
      dr.x,
      dr.y,
      1.06,
      1.06,
      () => {
        for (const c of cards) face(g, dr.x, dr.y + c.dy, c.card, c.strip)
      },
      angle,
    )
  }

  if (v.stuckAt >= 0) {
    const a = prog(v.now - v.stuckAt, 0, 0.3)
    const cy = TAB_Y + (h - TAB_Y) * 0.45
    g.alpha(a, () => {
      g.rrect(200, cy - 56, 600, 112, 56, alpha(C.ink, 0.88))
      g.text('No moves left', 500, cy + 2, { size: 52, weight: 700, color: C.white })
    })
  }

  if (v.hint) {
    g.text('Tap or drag a card · tap the deck to draw', 500, h - 40, {
      size: 36,
      maxWidth: 940,
      weight: 600,
      color: alpha(C.white, 0.85),
    })
  }
}

/** Panel-local centre of a card given by key. */
export function keyCentre(v: TableView, d: Deal, key: number): { x: number; y: number } {
  const p = keyPos(v.h, d, key)
  return fromTable(v, p.x + CARD_W / 2, p.y + CARD_H / 2)
}

/** A small chip with an emoji, e.g. the solo record under the table. */
export function chip(g: Draw, x: number, y: number, label: string, side: Side, icon: string): void {
  const w = g.measure(label, 34, 600) + 104
  g.rrect(x - w / 2, y - 26, w, 52, 26, alpha(shade(SIDE[side].main, -0.6), 0.9))
  g.emoji(icon, x - w / 2 + 44, y, 32)
  g.text(label, x + 22, y + 2, { size: 34, weight: 600, color: alpha(C.white, 0.8) })
}
