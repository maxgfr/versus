import type { Side } from '../../core/game.ts'
import { inOutCubic, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { HEADER } from '../../engines/puzzle/index.ts'
import { floodlight } from './ending.ts'
import { isFree, type Layout, type Tile, TRAY } from './rules.ts'

/** Seconds for a picked tile to fly into the tray. */
export const FLY = 0.24
/** After landing: a set squeezes together, then pops. */
export const SQUEEZE = 0.18
export const POP = 0.14

/**
 * Where everything sits in a panel of w × h (a half: 1000 × 900, or the whole
 * stage in solo). Solo has the whole height, so it stands the 14 × 10 slot
 * grid on its side (10 wide, 14 tall) with bigger tiles, narrow enough to stay
 * clear of the pause button on the left edge.
 */
export interface Geo {
  w: number
  h: number
  /** Slot size: a tile covers 2 × 2 slots. */
  u: number
  /** Stack origin, and whether the grid is turned on its side. */
  x0: number
  y0: number
  turned: boolean
  /** Tray: slot pitch, first slot left edge, top and height, tile size. */
  pitch: number
  tx0: number
  trayY: number
  trayH: number
  ts: number
}

/** Upper layers sit a little higher, so the stack reads as a pile. */
const LAYER_LIFT = 8
const TILE_GAP = 6

export function geometry(w: number, h: number): Geo {
  const solo = h > 1000
  const pitch = 128
  const trayH = solo ? 150 : 124
  const trayY = solo ? h - 250 : h - trayH - 14
  const ts = solo ? 112 : 100
  if (solo) {
    const u = 74
    const x0 = (w - 10 * u) / 2
    const y0 = HEADER + (trayY - 40 - HEADER - 14 * u) / 2
    return { w, h, u, x0, y0, turned: true, pitch, tx0: (w - pitch * TRAY) / 2, trayY, trayH, ts }
  }
  const u = 60
  return {
    w,
    h,
    u,
    x0: (w - 14 * u) / 2,
    y0: HEADER + 22,
    turned: false,
    pitch,
    tx0: (w - pitch * TRAY) / 2,
    trayY,
    trayH,
    ts,
  }
}

/** Centre and size of a tile in panel-local coordinates. */
export function tileCenter(g: Geo, t: Tile): { x: number; y: number; s: number } {
  const sx = g.turned ? t.y : t.x
  const sy = g.turned ? t.x : t.y
  return {
    x: g.x0 + (sx + 1) * g.u,
    y: g.y0 + (sy + 1) * g.u - t.l * LAYER_LIFT,
    s: g.u * 2 - TILE_GAP,
  }
}

/** Centre of a tray slot in panel-local coordinates. */
export function slotCenter(g: Geo, i: number): { x: number; y: number } {
  return { x: g.tx0 + (i + 0.5) * g.pitch, y: g.trayY + g.trayH / 2 }
}

/**
 * The tile under a panel-local point (topmost layer wins), or -1: only free
 * tiles unless `covered` is set (a press on a buried tile gets a nudge).
 */
export function tileAt(
  lay: Layout,
  taken: readonly boolean[],
  g: Geo,
  px: number,
  py: number,
  covered = false,
): number {
  let best = -1
  let bestL = -1
  const pad = TILE_GAP / 2 + 2
  lay.tiles.forEach((t, i) => {
    if (taken[i] || (!covered && !isFree(lay, taken, i)) || t.l < bestL) return
    const c = tileCenter(g, t)
    const half = c.s / 2 + pad
    if (Math.abs(px - c.x) <= half && Math.abs(py - c.y) <= half) {
      best = i
      bestL = t.l
    }
  })
  return best
}

const DEPTH = 12
const COVERED = mix(C.cream, C.ink3, 0.62)

/**
 * One tile face: cream and bright when free, a dim slate when covered. `lit`
 * (0..1) blends from covered to free, so a tile brightens as it is uncovered.
 */
export function face(
  g: Draw,
  cx: number,
  cy: number,
  s: number,
  glyph: string,
  lit: number,
  o: { tint?: string; shadow?: number; sx?: number; sy?: number; angle?: number } = {},
): void {
  const sx = o.sx ?? 1
  const sy = o.sy ?? 1
  if (sx !== 1 || sy !== 1 || o.angle) {
    // Squash, stretch or spin about the tile's centre.
    const { sx: _x, sy: _y, angle = 0, ...rest } = o
    g.at(cx, cy, angle, () => face(g, 0, 0, s, glyph, lit, rest), sx, sy)
    return
  }
  const x = cx - s / 2
  const y = cy - s / 2
  const depth = DEPTH * (s / 114)
  if (o.shadow) g.rrect(x + 5, y + 9, s, s, s * 0.17, alpha('#000000', o.shadow))
  const base = lit >= 1 ? C.cream : mix(COVERED, C.cream, lit)
  g.tile(x, y, s, s, s * 0.17, o.tint ? mix(base, o.tint, 0.55) : base, depth)
  const size = s * 0.6
  const ey = cy - depth / 2 + 1
  if (lit >= 1) g.emoji(glyph, cx, ey, size)
  else g.alpha(0.32 + 0.68 * lit, () => g.emoji(glyph, cx, ey, size))
}

export function drawStack(
  g: Draw,
  lay: Layout,
  taken: readonly boolean[],
  takenAt: readonly number[],
  geo: Geo,
  emoji: readonly string[],
  now: number,
  nudge = -1,
  nudgeAt = -10,
): void {
  // Floor first, then upper layers; tiles on one layer never overlap.
  const order = lay.tiles
    .map((_, i) => i)
    .sort((a, b) => (lay.tiles[a]?.l ?? 0) - (lay.tiles[b]?.l ?? 0))
  for (const i of order) {
    if (taken[i]) continue
    const t = lay.tiles[i]
    if (!t) continue
    const c = tileCenter(geo, t)
    let lit = 0
    let s = c.s
    let y = c.y
    let angle = 0
    let shadow = t.l ? 0.3 : 0.22
    if (isFree(lay, taken, i)) {
      // Uncovered when the last tile on top of it went: brighten, then rise
      // onto its toes with a springy pop. Free tiles stay a touch raised.
      let freedAt = -10
      for (const j of lay.above[i] ?? []) freedAt = Math.max(freedAt, takenAt[j] ?? -10)
      const age = now - freedAt
      lit = prog(age, 0, 0.2)
      const rise = outBack(prog(age, 0.05, 0.4))
      y -= 4 * rise
      shadow += 0.08 * rise
      if (age < 0.4) s *= 1 + Math.sin(prog(age, 0, 0.4) * Math.PI) * 0.08
    }
    if (i === nudge && now - nudgeAt < 0.3) {
      // A press on a buried tile: it shakes its head.
      const d = 1 - (now - nudgeAt) / 0.3
      angle = Math.sin((now - nudgeAt) * 55) * 0.09 * d
    }
    face(g, c.x, y, s, emoji[t.k] ?? '⭐', lit, { shadow, angle })
  }
}

/** A tile in the tray: kind, when it arrived and from where, and its last slide. */
export interface Shown {
  k: number
  at: number
  fx: number
  fy: number
  /** Slot it slides from, and when the slide starts. */
  ps: number
  mv: number
}

export interface Clear {
  k: number
  /** Slot of the first tile of the set. */
  slot: number
  at: number
  fx: number
  fy: number
  /** Combo intensity 0..1: a bigger squeeze and pop. */
  heat?: number
}

/** Where a flying tile is: an arc from where it was picked to its slot, shrinking to tray size. */
function flight(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  from: number,
  to: number,
  t: number,
) {
  // Anticipation: the tile hops up off the stack (bigger) before it heads for the tray.
  const hop = Math.sin(prog(t, 0, 0.3) * Math.PI)
  const e = inOutCubic(t)
  // Stretched along the flight while it is fast, round again as it lands.
  const v = Math.sin(t * Math.PI)
  return {
    x: fx + (tx - fx) * e,
    y: fy + (ty - fy) * e - v * 90 - hop * 18,
    s: (from + (to - from) * e) * (1 + hop * 0.12),
    sx: 1 - v * 0.1,
    sy: 1 + v * 0.14,
    angle: (tx > fx ? 1 : -1) * v * 0.35,
  }
}

/** A landing squash that rings out: wide and short, then a little tall, then still. */
function squash(age: number): { sx: number; sy: number } {
  if (age < 0 || age > 0.32) return { sx: 1, sy: 1 }
  const t = age / 0.32
  const w = Math.sin(t * Math.PI * 2.2) * (1 - t) * 0.16
  return { sx: 1 + w, sy: 1 - w }
}

export function drawTray(
  g: Draw,
  geo: Geo,
  side: Side,
  tray: readonly Shown[],
  clear: Clear | null,
  emoji: readonly string[],
  now: number,
  lostAt: number,
): void {
  const col = SIDE[side]
  const lost = lostAt >= 0 && now >= lostAt + FLY
  const filled = tray.length
  const danger = filled >= TRAY - 1 || lost
  // Danger: a heartbeat, two quick thumps a beat.
  const beat = (now * 1.6) % 1
  const pulse = danger ? Math.max(0, Math.sin(beat * Math.PI * 4)) * (beat < 0.5 ? 1 : 0) : 0
  const shake = lost
    ? Math.sin((now - lostAt) * 60) * 10 * Math.max(0, 1 - (now - lostAt - FLY) * 2)
    : 0
  const tw = geo.pitch * TRAY + 36
  const tx = geo.tx0 - 18 + shake
  g.rrect(tx, geo.trayY + 10, tw, geo.trayH, 42, alpha('#000000', 0.38))
  g.rrect(tx, geo.trayY, tw, geo.trayH, 42, shade(col.main, -0.45))
  g.rrect(tx + 8, geo.trayY + 8, tw - 16, geo.trayH - 16, 34, shade(C.ink, 0.06))
  if (danger)
    g.rrect(tx, geo.trayY, tw, geo.trayH, 42, undefined, alpha(C.red, 0.35 + pulse * 0.55), 7)
  const well = geo.pitch - 16
  for (let i = 0; i < TRAY; i++) {
    const c = slotCenter(geo, i)
    const wy = geo.trayY + (geo.trayH - well) / 2
    g.rrect(c.x - well / 2 + shake, wy, well, well, 26, alpha('#000000', 0.42))
    g.rrect(c.x - well / 2 + shake, wy + well - 10, well, 10, 5, alpha(C.white, 0.04))
  }
  const ts = geo.ts
  // A kind with two in the tray is one tile from a set: those two bob and glow.
  const count = new Map<number, number>()
  for (const it of tray) count.set(it.k, (count.get(it.k) ?? 0) + 1)
  tray.forEach((it, i) => {
    const c = slotCenter(geo, i)
    const age = now - it.at
    let x = c.x
    let y = c.y - 4
    let s = ts
    let o: { tint?: string; sx?: number; sy?: number; angle?: number } = {}
    if (age < FLY) {
      const p = flight(it.fx, it.fy, c.x, y, geo.u * 2 - TILE_GAP, ts, Math.max(0, age) / FLY)
      x = p.x
      y = p.y
      s = p.s
      o = { sx: p.sx, sy: p.sy, angle: p.angle }
    } else {
      o = squash(age - FLY)
      if (count.get(it.k) === 2 && !lost) {
        y -= 3 + Math.sin(now * 6 + it.k) * 3
        g.alpha(0.25 + 0.15 * Math.sin(now * 6 + it.k), () =>
          g.rrect(x - s / 2 - 6, y - s / 2 - 6, s + 12, s + 12, s * 0.22, C.yellow),
        )
      }
    }
    if (it.ps !== i && now < it.mv + 0.2) {
      const from = slotCenter(geo, it.ps)
      x = from.x + (x - from.x) * outBack(prog(now - it.mv, 0, 0.2))
    }
    if (lost) o.tint = C.red
    face(g, x + shake, y, s, emoji[it.k] ?? '⭐', 1, o)
  })
  if (clear) drawClear(g, geo, clear, emoji, now)
  if (filled === TRAY - 1 && !lost) {
    // The last empty well blinks a warning.
    const c = slotCenter(geo, TRAY - 1)
    const wy = geo.trayY + (geo.trayH - well) / 2
    g.rrect(c.x - well / 2, wy, well, well, 26, alpha(C.red, 0.12 + pulse * 0.2), C.red, 5)
    g.text('!', c.x, c.y + 2, { size: 64, weight: 700, color: alpha(C.red, 0.6 + pulse * 0.4) })
  }
}

/** A set of three: the third flies in, the three squeeze together, then pop. */
function drawClear(g: Draw, geo: Geo, c: Clear, emoji: readonly string[], now: number): void {
  const age = now - c.at
  if (age < 0 || age > FLY + SQUEEZE + POP) return
  const glyph = emoji[c.k] ?? '⭐'
  const ts = geo.ts
  const mid = slotCenter(geo, c.slot + 1)
  const k = c.heat ?? 0
  const sq = outCubic(prog(age - FLY, 0, SQUEEZE))
  const pop = prog(age - FLY - SQUEEZE, 0, POP)
  for (let n = 0; n < 3; n++) {
    const home = slotCenter(geo, c.slot + n)
    let x = home.x
    let y = home.y - 4
    let s = ts
    if (n === 2 && age < FLY) {
      const p = flight(c.fx, c.fy, home.x, y, geo.u * 2 - TILE_GAP, ts, age / FLY)
      x = p.x
      y = p.y
      s = p.s
    }
    x += (mid.x - x) * sq
    y -= sq * (16 + k * 14)
    s *= 1 + sq * (0.12 + k * 0.1) - pop * 1.1
    if (s <= 2) continue
    // The squeeze presses them flat and wide before the pop.
    const o =
      sq > 0 ? { tint: mix(C.yellow, C.cream, 1 - sq), sx: 1 + sq * 0.1, sy: 1 - sq * 0.12 } : {}
    face(g, x, y, s, glyph, 1, o)
  }
  if (sq > 0 && pop < 1) {
    g.alpha(1 - pop, () =>
      g.circle(mid.x, mid.y - 16, ts * (0.6 + pop * (0.9 + k * 0.8)), alpha(C.yellow, 0.35)),
    )
  }
}

/** Backdrop: a floodlight pool under the stack. */
export function backdrop(g: Draw, side: Side, geo: Geo): void {
  const cx = geo.w / 2
  const cy = geo.turned ? geo.y0 + 7 * geo.u : geo.y0 + 5 * geo.u
  floodlight(g, side, cx, cy, geo.turned ? 760 : 620)
}
