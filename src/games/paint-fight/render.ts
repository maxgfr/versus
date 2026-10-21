import type { Side } from '../../core/game.ts'
import { banner, clock } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { type ControlLook, drawStrip } from '../../engines/arena/index.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import { BOARD, BOARD_BOTTOM, ROLL_R, type Roller, shares } from './rules.ts'

const FLOOR_A = '#2b3050'
const FLOOR_B = '#262a47'
/** Seconds a freshly painted tile takes to splat into place. */
const POP_T = 0.24

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k))
const backOut = (k: number): number => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2

/** The floor slab: rim, checkered concrete, faint team tint toward each end. */
function slab(g: Draw): void {
  const { x0, y0, cell, cols, rows } = BOARD
  const w = cols * cell
  const h = rows * cell
  g.rrect(x0 - 18, y0 - 10, w + 36, h + 36, 30, alpha('#000000', 0.35))
  g.rrect(x0 - 16, y0 - 16, w + 32, h + 32, 28, shade(C.ink, 0.18))
  g.rrect(x0 - 16, y0 - 16, w + 32, h + 32, 28, undefined, alpha(C.white, 0.08), 3)
  g.rect(x0, y0, w, h, FLOOR_A)
  for (let r = 0; r < rows; r++)
    for (let c = r % 2; c < cols; c += 2) g.rect(x0 + c * cell, y0 + r * cell, cell, cell, FLOOR_B)
  g.rect(
    x0,
    y0,
    w,
    h,
    g.lin(0, y0, 0, y0 + h, [
      [0, alpha(C.blue, 0.12)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.12)],
    ]),
  )
}

/**
 * Painted tiles as wet paint: every tile is drawn a little oversized and
 * rounded, so a team's tiles melt into one glossy region. Fresh tiles splat in
 * (scale overshoot and a light flash), timed from the state so the online
 * guest sees the same thing.
 */
function paint(g: Draw, own: readonly number[], at: readonly number[], now: number): void {
  const { x0, y0, cell, cols, rows } = BOARD
  const n = cols * rows
  const size = (i: number) => {
    const k = clamp01((now - (at[i] ?? -9)) / POP_T)
    return k >= 1 ? 1 : 0.35 + 0.65 * backOut(k)
  }
  // Lips first (a darker rim under every region), then faces, then glints.
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < n; i++) {
      const o = own[i] ?? 0
      if (o === 0) continue
      const col = SIDE[(o - 1) as Side].main
      const c = i % cols
      const r = (i - c) / cols
      const k = size(i)
      const cx = x0 + (c + 0.5) * cell
      const cy = y0 + (r + 0.5) * cell
      const half = ((cell + 8) / 2) * k
      if (pass === 0)
        g.rrect(cx - half, cy - half + 5, half * 2, half * 2, 18 * k, shade(col, -0.42))
      else if (pass === 1) {
        const fresh = 1 - clamp01((now - (at[i] ?? -9)) / 0.5)
        g.rrect(cx - half, cy - half, half * 2, half * 2, 18 * k, mix(col, '#ffffff', fresh * 0.45))
      } else {
        // Scattered wet glints, fixed per tile.
        if ((c * 7 + r * 3) % 5 === 0)
          g.ellipse(cx - 12, cy - 14, 10 * k, 5 * k, alpha('#ffffff', 0.3), -0.4)
        else if ((c * 5 + r * 11) % 7 === 0)
          g.circle(cx + 14, cy + 10, 4 * k, alpha('#ffffff', 0.22))
      }
    }
}

/**
 * A roller and its painter: the roller is coated in team paint and lies across
 * the direction of travel; the blob behind it stays upright and looks where it goes.
 */
function roller(g: Draw, ro: Roller, now: number): void {
  const col = SIDE[ro.side]
  const fx = Math.cos(ro.a)
  const fy = Math.sin(ro.a)
  const bx = ro.x - fx * 38
  const by = ro.y - fy * 38
  const kick = clamp01(1 - (now - ro.splashT) / 0.35)
  const bob = Math.sin(now * 14 + ro.id) * 2
  g.shadow(ro.x + 6, ro.y + 12, ROLL_R + 16, ROLL_R * 0.7, 0.32)
  g.shadow(bx + 4, by + 24, 32, 12, 0.3)
  // The painter walks behind the roller; whichever is lower on screen is drawn in front.
  const painter = () =>
    g.blob(bx, by - 8 + bob, 32, col.main, {
      mood: kick > 0 ? 'grin' : 'happy',
      look: [fx, fy],
      sx: 1 + kick * 0.2,
      sy: 1 - kick * 0.2,
      outline: true,
    })
  if (fy >= 0) painter()
  g.at(ro.x, ro.y, ro.a, () => {
    // Handle from the painter to the roller's frame.
    g.line(-38, 0, 2, 0, '#4a4458', 8)
    g.line(2, -30, 2, 30, '#4a4458', 6)
    // The paint-soaked cylinder, its axis across the travel.
    const len = 50 * (1 + kick * 0.15)
    g.rrect(4, -len, 30, len * 2, 14, shade(col.main, -0.45))
    g.rrect(
      2,
      -len - 2,
      30,
      len * 2,
      14,
      g.lin(2, 0, 32, 0, [
        [0, shade(col.main, 0.3)],
        [0.5, col.main],
        [1, shade(col.main, -0.2)],
      ]),
    )
    // Turning texture lines on the cylinder.
    const spin = ((ro.x + ro.y) * 0.6) % 16
    for (let y = -len + 6 + spin; y < len - 4; y += 16)
      g.line(6, y, 28, y, alpha('#000000', 0.12), 3)
    g.rrect(8, -len + 4, 8, len * 2 - 8, 4, alpha('#ffffff', 0.3))
    g.circle(17, -len - 2, 6, '#5a5468')
    g.circle(17, len - 2, 6, '#5a5468')
  })
  // Red's circle / blue's square on the roller.
  g.sideMark(ro.side, ro.x + fx * 17, ro.y + fy * 17, 9, alpha(C.white, 0.9))
  if (fy < 0) painter()
  if (kick > 0) g.ring(ro.x, ro.y, ROLL_R + 40 * (1 - kick), alpha(col.light, kick), 8)
}

/** Joystick base and knob, then the splash button with its cooldown ring and paint-drop glyph. */
function controls(g: Draw, c: ControlLook): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.45), alpha(col.light, 0.45), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
  const ready = c.ready >= 1
  const depth = c.fr * 0.16
  const p = c.pressed ? depth : 0
  const face = ready ? col.main : mix(col.main, C.ink3, 0.55)
  if (ready) g.circle(c.fx, c.fy, c.fr + 10 + Math.sin(g.t * 6) * 3, alpha(col.light, 0.18))
  g.circle(c.fx, c.fy + depth, c.fr, shade(face, -0.45))
  g.circle(
    c.fx,
    c.fy + p,
    c.fr,
    g.rad(
      c.fx,
      c.fy,
      c.fr * 0.1,
      c.fr,
      [
        [0, shade(face, 0.3)],
        [1, face],
      ],
      c.fx - c.fr * 0.3,
      c.fy - c.fr * 0.4,
    ),
  )
  if (!ready)
    g.arc(
      c.fx,
      c.fy + p,
      c.fr + 10,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * c.ready,
      alpha(C.white, 0.75),
      7,
    )
  // A paint splat glyph, upright for its player.
  g.forSide(c.side, c.fx, c.fy + p, () => {
    const k = c.fr / 78
    const ink = ready ? C.white : alpha(C.white, 0.5)
    g.circle(0, 4 * k, 24 * k, ink)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3
      const d = (i % 2 ? 30 : 36) * k
      g.circle(Math.cos(a) * d, 4 * k + Math.sin(a) * d, (i % 2 ? 7 : 10) * k, ink)
    }
    g.path((q) => {
      q.moveTo(0, -42 * k)
      q.quadraticCurveTo(14 * k, -18 * k, 0, -12 * k)
      q.quadraticCurveTo(-14 * k, -18 * k, 0, -42 * k)
    }, ink)
  })
}

/** A player's share of the floor along their edge: name, a glossy fill and the live percentage. */
function shareBar(
  g: Draw,
  side: Side,
  share: number,
  other: number,
  name: string,
  y: number,
): void {
  const col = SIDE[side]
  const w = 780
  const lead = share > other
  g.forSide(side, W / 2, y, () => {
    g.rrect(-w / 2 - 6, -25, w + 12, 50, 25, alpha(C.ink, 0.85))
    g.rrect(-w / 2, -20, w, 40, 20, shade(col.main, -0.62))
    const fill = Math.max(40, w * Math.min(1, share))
    g.rrect(
      -w / 2,
      -20,
      fill,
      40,
      20,
      g.lin(0, -20, 0, 20, [
        [0, shade(col.main, 0.25)],
        [1, shade(col.main, -0.1)],
      ]),
    )
    g.rrect(-w / 2 + 10, -16, fill - 20, 9, 4, alpha('#ffffff', 0.25))
    g.sideMark(side, -w / 2 + 28, 0, 10, C.white)
    g.text(name, -w / 2 + 50, 2, {
      size: 34,
      weight: 700,
      color: C.white,
      align: 'left',
      drop: alpha('#000000', 0.45),
      maxWidth: 360,
    })
    g.text(`${Math.round(share * 100)}%`, w / 2 - 22, 2, {
      size: 40,
      weight: 700,
      color: lead ? C.yellow : C.white,
      align: 'right',
      drop: alpha('#000000', 0.45),
    })
  })
}

export interface View {
  names: [string, string]
  over: boolean
  duration: number
  /** Winner once the clock has run out. */
  winner: Side | 'draw' | null
}

/** The paint floor: painted regions, rollers, the controls, share bars, the clock and the final call. */
export function renderPaint(g: Draw, s: State, now: number, v: View): void {
  g.fillView(C.ink)
  drawStrip(g, BOARD.y0 - 16, BOARD_BOTTOM + 16)
  slab(g)
  paint(g, s.w.own, s.w.at, s.w.t)
  // Rollers further down the screen draw on top.
  const order = [...s.w.rollers].sort((a, b) => a.y - b.y)
  for (const ro of order) roller(g, ro, s.w.t)
  g.vignette(0.3)
  for (const c of s.ctl) controls(g, c)
  const [red, blue] = shares(s.w)
  // Snug against the slab, so the joystick ring below never runs under the bar.
  shareBar(g, 0, red, blue, v.names[0], BOARD_BOTTOM + 26)
  shareBar(g, 1, blue, red, v.names[1], BOARD.y0 - 26)
  if (!v.over) clock(g, v.duration - now, MID)
  else if (v.winner !== null) {
    const col = v.winner === 'draw' ? C.white : mix(C.white, SIDE[v.winner].light, 0.5)
    banner(g, undefined, 'Time!', MID, { size: 72, color: col })
  }
}
