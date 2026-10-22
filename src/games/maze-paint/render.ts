import type { Side } from '../../core/game.ts'
import { inCubic, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { fmtTime, HEADER } from '../../engines/puzzle/index.ts'
import { DX, DY, impactOf, neighbour, paintTime, roll } from './rules.ts'

/** Board geometry for a panel of w × h, an n × n maze. */
export interface Layout {
  n: number
  /** Tile size. */
  c: number
  /** Board side length. */
  size: number
  x0: number
  y0: number
}

export function layout(w: number, h: number, n: number): Layout {
  // Below the header: the level row (84), then the board, then the restart pill (130).
  const availH = h - HEADER - 224
  // Clear of the pause button on the left edge.
  const availW = w - 260
  // Solo has the whole stage: bigger tiles.
  const cap = h > 1000 ? 170 : 132
  const c = Math.min(cap, Math.floor(Math.min(availW, availH) / n))
  const size = c * n
  return {
    n,
    c,
    size,
    x0: (w - size) / 2,
    y0: HEADER + 84 + (availH - size) / 2,
  }
}

/** The restart pill, in panel-local coordinates. */
export function resetRect(w: number, h: number): { x: number; y: number; w: number; h: number } {
  return { x: w / 2 - 170, y: h - 98, w: 340, h: 76 }
}

/** How long a cleared board celebrates before the next level pops in. */
export const CLEAR_SECONDS = 0.85

export interface PanelView {
  side: Side
  walls: readonly number[]
  start: number
  painted: readonly number[]
  pos: number
  /** The last roll: where it began, its direction, the tiles it entered, when it began. */
  from: number
  dir: number
  len: number
  rollAt: number
  /** How long the last roll lasts, and how hard its swipe was (0..1). */
  dur: number
  pow: number
  /** A swipe into a wall: the ball nudges that way and back. */
  bumpAt: number
  bumpDir: number
  /** Tiles the last roll painted for the first time (they splash in as the ball passes). */
  newly: readonly number[]
  /** 1-based level number and the total. */
  levelNo: number
  levels: number
  /** When the current level appeared (pop-in). */
  levelAt: number
  /** When this board was cleared (celebration wave), or a negative time. */
  clearAt: number
  now: number
  /** Show the how-to line. */
  hint: boolean
  /** The rival finished first: the clock to beat, shown instead of the level label. */
  chase: number | null
  /** Draw the controls (restart pill, arrows, how-to)? Online, only on the viewer's own board. */
  controls: boolean
  /** Show yellow arrows around the ball for the rolls that move (0..1 opacity). */
  arrows: number
  /** No roll can finish this board: the restart pill glows. */
  stuck: boolean
  restartCost: number
}

/** Which levels are done / current, as glossy pips beside the level label. */
function levelRow(g: Draw, w: number, l: Layout, v: PanelView): void {
  const col = SIDE[v.side]
  const label =
    v.chase !== null
      ? `Beat ${fmtTime(v.chase)}!`
      : v.hint && v.controls
        ? 'Swipe to roll'
        : `Level ${v.levelNo}`
  const size = 40
  const tw = g.measure(label, size, 700)
  const gap = 40
  const pipsW = (v.levels - 1) * gap + 26
  const total = tw + 30 + pipsW
  const x = w / 2 - total / 2
  const y = Math.max(HEADER + 36, l.y0 - 62)
  const urgent = v.chase !== null ? 0.5 + 0.5 * Math.sin(v.now * 8) : 0
  g.text(label, x, y, {
    size,
    weight: 700,
    align: 'left',
    color: v.chase !== null ? mix(C.yellow, C.white, urgent * 0.4) : C.white,
  })
  for (let i = 0; i < v.levels; i++) {
    const px = x + tw + 30 + 13 + i * gap
    const done = i < v.levelNo - 1
    const cur = i === v.levelNo - 1
    if (done) {
      g.ball(px, y, 14, col.main, 1)
    } else if (cur) {
      const pulse = 0.5 + 0.5 * Math.sin(v.now * 6)
      g.circle(px, y, 14, alpha(C.white, 0.12))
      g.ring(px, y, 15 + pulse * 2, alpha(C.yellow, 0.7 + pulse * 0.3), 4)
    } else {
      g.circle(px, y, 12, alpha(C.white, 0.12))
    }
  }
}

/** The tray the board sits in: a team-tinted rim around a dark well. */
function tray(g: Draw, l: Layout, side: Side): void {
  const col = SIDE[side]
  const pad = 18
  const x = l.x0 - pad
  const y = l.y0 - pad
  const s = l.size + pad * 2
  g.rrect(x - 4, y + 16, s + 8, s + 8, 40, alpha('#000000', 0.4))
  g.rrect(x - 6, y - 6, s + 12, s + 18, 40, shade(col.main, -0.45))
  g.rrect(
    x - 6,
    y - 6,
    s + 12,
    s + 6,
    40,
    g.lin(0, y - 6, 0, y + s, [
      [0, shade(col.main, -0.2)],
      [0.06, shade(col.main, -0.5)],
      [1, shade(col.main, -0.62)],
    ]),
  )
  g.rrect(x + 4, y + 4, s - 8, s - 8, 30, shade(C.ink, -0.2))
}

/** One floor tile: cream until painted, then wet team paint. `paint` 0..1 splashes it in. */
function floor(
  g: Draw,
  x: number,
  y: number,
  s: number,
  side: Side,
  paint: number,
  glow: number,
): void {
  const col = SIDE[side]
  const r = s * 0.16
  if (paint < 1) {
    g.rrect(x, y, s, s, r, C.cream)
    // A soft inner shadow along the top: the floor sits below the walls.
    g.rrect(
      x,
      y,
      s,
      s * 0.3,
      r,
      g.lin(0, y, 0, y + s * 0.3, [
        [0, 'rgba(60,30,10,0.16)'],
        [1, 'rgba(60,30,10,0)'],
      ]),
    )
  }
  if (paint <= 0) return
  const k = outBack(paint)
  const ps = s * k
  const o = (s - ps) / 2
  g.rrect(
    x + o,
    y + o,
    ps,
    ps,
    r * k,
    g.lin(0, y + o, 0, y + o + ps, [
      [0, shade(col.main, 0.18)],
      [1, shade(col.main, -0.12)],
    ]),
  )
  // Wet sheen.
  g.rrect(
    x + o + ps * 0.12,
    y + o + ps * 0.1,
    ps * 0.5,
    ps * 0.14,
    ps * 0.07,
    alpha('#ffffff', 0.32),
  )
  if (glow > 0) g.alpha(glow, () => g.rrect(x, y, s, s, r, mix(SIDE[side].light, C.white, 0.6)))
}

/** The board: walls, floor, paint, and a celebration wave once cleared. */
function board(g: Draw, l: Layout, v: PanelView): void {
  const { n, c, x0, y0 } = l
  const gap = c * 0.04
  const ts = c - gap * 2
  const wallCol = mix(C.ink4, SIDE[v.side].main, 0.1)
  const pr = Math.floor(v.pos / n)
  const pc = v.pos % n
  // Where each newly painted tile sits along the last roll.
  const fr = Math.floor(v.from / n)
  const fc = v.from % n
  const cleared = v.clearAt >= 0 && v.now >= v.clearAt
  // The wall the ball just hit gives a little, harder for a harder hit.
  const hitWall = v.len > 0 && v.dir >= 0 ? neighbour(n, v.pos, v.dir) : -1
  const hitT = v.now - v.rollAt - v.dur
  const give =
    hitWall >= 0 && v.walls[hitWall] && hitT >= 0 && hitT < 0.3
      ? impactOf(v.len, v.pow) * Math.sin((hitT / 0.3) * Math.PI) * (1 - hitT / 0.3)
      : 0
  const hdx = DX[v.dir] ?? 0
  const hdy = DY[v.dir] ?? 0
  for (let i = 0; i < v.walls.length; i++) {
    const row = Math.floor(i / n)
    const colI = i % n
    const pop = v.now - v.levelAt - (row + colI) * 0.025
    const s = pop <= 0 ? 0 : outBack(prog(pop, 0, 0.3))
    if (s <= 0.001) continue
    const shove = i === hitWall ? give * c * 0.1 : 0
    const cx = x0 + colI * c + c / 2 + hdx * shove
    const cy = y0 + row * c + c / 2 + hdy * shove
    g.at(
      cx,
      cy,
      0,
      () => {
        const x = -ts / 2
        if (v.walls[i]) {
          g.tile(x, x - c * 0.06, ts, ts + c * 0.06, c * 0.18, wallCol, c * 0.16)
          return
        }
        let paint = v.painted[i] ? 1 : 0
        if (paint && v.newly.includes(i)) {
          const k = Math.abs(row - fr) + Math.abs(colI - fc) - 1
          const at = paintTime(v.rollAt, v.dur, v.len, k)
          paint = prog(v.now, at, at + 0.2)
        }
        let glow = 0
        if (cleared) {
          const d = Math.abs(row - pr) + Math.abs(colI - pc)
          const t = v.now - v.clearAt - d * 0.06
          glow = t > 0 ? Math.max(0, 1 - t * 4) * 0.85 : 0
        }
        floor(g, x, x, ts, v.side, paint, glow)
      },
      s,
      s,
    )
  }
}

/** Yellow chevrons on the sides of the ball where a roll would move. */
function arrows(g: Draw, l: Layout, v: PanelView, bx: number, by: number, r: number): void {
  if (v.arrows <= 0) return
  const lv = { n: l.n, walls: v.walls }
  const bob = Math.sin(v.now * 6) * 6
  g.alpha(v.arrows, () => {
    for (let d = 0; d < 4; d++) {
      if (roll(lv, v.pos, d).path.length === 0) continue
      const dx = DX[d] ?? 0
      const dy = DY[d] ?? 0
      const dist = r + 26 + bob
      const ax = bx + dx * dist
      const ay = by + dy * dist
      const s = 16
      // Tip points along (dx, dy); the base is across it.
      g.poly(
        [
          ax + dx * s,
          ay + dy * s,
          ax - dx * s * 0.4 - dy * s,
          ay - dy * s * 0.4 + dx * s,
          ax - dx * s * 0.4 + dy * s,
          ay - dy * s * 0.4 - dx * s,
        ],
        C.yellow,
        shade(C.yellow, -0.45),
        4,
      )
    }
  })
}

/** The player's piece: red a glossy ball, blue a glossy rounded cube. */
function piece(g: Draw, side: Side, r: number): void {
  const col = SIDE[side]
  const face = mix(col.light, C.white, 0.15)
  if (side === 0) {
    g.circle(0, 0, r + 7, C.ink)
    g.ball(0, 0, r, face, 1)
    return
  }
  const s = r * 0.95
  g.rrect(-s - 7, -s - 7, (s + 7) * 2, (s + 7) * 2, r * 0.5, C.ink)
  g.rrect(
    -s,
    -s,
    s * 2,
    s * 2,
    r * 0.42,
    g.rad(
      0,
      0,
      r * 0.1,
      r * 1.4,
      [
        [0, shade(face, 0.35)],
        [0.6, face],
        [1, shade(face, -0.3)],
      ],
      -r * 0.35,
      -r * 0.4,
    ),
  )
  g.alpha(0.7, () => g.rrect(-s * 0.7, -s * 0.78, s * 0.6, s * 0.3, s * 0.15, '#ffffff'))
}

function ball(g: Draw, l: Layout, v: PanelView): void {
  const { n, c, x0, y0 } = l
  const r = c * 0.3
  const duration = v.dur
  const since = v.now - v.rollAt
  const hit = impactOf(v.len, v.pow)
  const rolling = v.len > 0 && since < duration
  const base = v.len > 0 ? v.from : v.pos
  const dx = DX[v.dir] ?? 0
  const dy = DY[v.dir] ?? 0
  const at = (t: number) => {
    const e = v.len > 0 ? outCubic(prog(t, 0, duration)) : 1
    return {
      x: x0 + ((base % n) + dx * v.len * e + 0.5) * c,
      y: y0 + (Math.floor(base / n) + dy * v.len * e + 0.5) * c,
    }
  }
  const p = at(since)
  // Motion trail while it slides: longer and brighter for a harder swipe.
  if (rolling) {
    const steps = 4 + Math.round(v.pow * 3)
    for (let k = steps; k >= 1; k--) {
      const q = at(since - k * 0.02)
      g.alpha((0.6 + 0.4 * v.pow) * (1 - k / (steps + 1)) * 0.75, () =>
        g.circle(q.x, q.y, r * (1 - k * 0.09), SIDE[v.side].light),
      )
    }
  }
  // Stretch along the roll while fast, squash against the wall it stops at:
  // both scale with how hard it was launched.
  const tt = prog(since, 0, duration)
  const stretch = rolling ? (0.16 + 0.16 * v.pow) * (1 - tt) ** 2 : 0
  const stop = v.len > 0 ? since - duration : 1
  const squash =
    v.len > 0 && stop >= 0 && stop < 0.3 ? (0.12 + 0.2 * hit) * Math.max(0, 1 - stop * 5) : 0
  const along = 1 + stretch - squash
  const across = 1 - stretch * 0.5 + squash * 0.6
  const horiz = v.dir % 2 === 1
  const idle = rolling ? 0 : Math.sin(v.now * 4) * 0.03
  const sx = (horiz ? along : across) + idle
  const sy = (horiz ? across : along) - idle
  // Shift toward the wall while squashed so it reads as pressed against it.
  const push = squash * r * 0.5
  // A swipe into a wall: the ball nudges that way and comes back.
  const bt = (v.now - v.bumpAt) / 0.16
  const bump = bt >= 0 && bt < 1 ? Math.sin(bt * Math.PI) * c * 0.12 : 0
  const bx = p.x + dx * push + (DX[v.bumpDir] ?? 0) * bump
  const by = p.y + dy * push + (DY[v.bumpDir] ?? 0) * bump
  g.shadow(bx, p.y + r * 0.9, r * 0.95, r * 0.3, 0.45)
  g.at(bx, by, 0, () => piece(g, v.side, r), sx, sy)
  if (!rolling && v.controls) arrows(g, l, v, p.x, p.y, r)
}

/** A "Level 2" card that pops over the board as it appears. */
function levelCard(g: Draw, l: Layout, v: PanelView): void {
  if (v.levelNo <= 1) return
  const t = v.now - v.levelAt
  if (t < -0.05 || t > 1.1) return
  const s = outBack(prog(t, -0.05, 0.25))
  const a = 1 - inCubic(prog(t, 0.75, 1.1))
  const col = SIDE[v.side]
  g.alpha(a, () =>
    g.at(
      l.x0 + l.size / 2,
      l.y0 + l.size / 2,
      0,
      () => {
        g.rrect(-210, -76, 420, 160, 54, shade(col.main, -0.6))
        g.rrect(-210, -86, 420, 160, 54, col.main)
        g.text(`Level ${v.levelNo}`, 0, -2, { size: 80, weight: 700, drop: alpha('#000000', 0.3) })
      },
      s,
    ),
  )
}

/** A small circular-arrow icon. */
function restartIcon(g: Draw, x: number, y: number, r: number, color: string): void {
  g.arc(x, y, r, -Math.PI * 0.35, Math.PI * 1.25, color, 7)
  const a = -Math.PI * 0.35
  const tx = x + Math.cos(a) * r
  const ty = y + Math.sin(a) * r
  g.poly([tx - 11, ty - 9, tx + 11, ty - 3, tx - 3, ty + 13], color)
}

function restartPill(g: Draw, w: number, h: number, v: PanelView): void {
  const rr = resetRect(w, h)
  const col = SIDE[v.side]
  const pulse = v.stuck ? 0.5 + 0.5 * Math.sin(v.now * 7) : 0
  if (v.stuck) {
    g.alpha(0.35 + pulse * 0.4, () =>
      g.rrect(rr.x - 10, rr.y - 10, rr.w + 20, rr.h + 20, (rr.h + 20) / 2, C.yellow),
    )
  }
  const face = v.stuck
    ? mix(shade(col.main, -0.25), C.yellow, 0.15 + pulse * 0.1)
    : shade(col.main, -0.4)
  g.tile(rr.x, rr.y, rr.w, rr.h, rr.h / 2, face, 10)
  const label = v.stuck ? `Stuck? +${v.restartCost}s` : `Restart +${v.restartCost}s`
  const tw = g.measure(label, 34, 700)
  const ix = rr.x + rr.w / 2 - (tw + 46) / 2 + 14
  const cy = rr.y + (rr.h - 10) / 2
  restartIcon(g, ix, cy, 14, C.white)
  g.text(label, ix + 30, cy + 2, { size: 34, weight: 700, align: 'left', color: C.white })
}

export function drawPanel(g: Draw, w: number, h: number, v: PanelView): void {
  const n = Math.round(Math.sqrt(v.walls.length))
  const l = layout(w, h, n)
  // A soft floodlight on the board.
  const cx = w / 2
  const cy = l.y0 + l.size / 2
  g.circle(
    cx,
    cy,
    l.size * 0.95,
    g.rad(cx, cy, 0, l.size * 0.95, [
      [0, alpha(SIDE[v.side].main, 0.16)],
      [1, alpha(SIDE[v.side].main, 0)],
    ]),
  )
  tray(g, l, v.side)
  levelRow(g, w, l, v)
  board(g, l, v)
  ball(g, l, v)
  levelCard(g, l, v)
  if (v.controls) restartPill(g, w, h, v)
}
