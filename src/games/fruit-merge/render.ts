import type { Side } from '../../core/game.ts'
import { inCubic, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, mix, shade } from '../../core/render/palette.ts'
import { fmtTime, HEADER } from '../../engines/puzzle/index.ts'
import { type Body, type Geo, type Jar, landingY, previewY, radius } from './rules.ts'

export const GLYPH = ['🍒', '🍓', '🍇', '🍊', '🍎', '🍐', '🍑', '🍍', '🍈', '🍉']
export const FRUIT_COLOR = [
  C.red,
  C.pink,
  C.purple,
  C.orange,
  C.redLight,
  C.green,
  C.sand,
  C.yellow,
  C.teal,
  C.grass,
]

export interface HeaderView {
  name: string
  score: number
  /** Game time the score last went up (it pops). */
  scoreAt: number
  remaining: number
  now: number
}

/**
 * Name, countdown and score along the panel's top band. Everything stays
 * inside x 150..850: the pause button sits on the midline at the left edge,
 * which is the right end of blue's band.
 */
export function drawHeader(g: Draw, w: number, side: Side, v: HeaderView): void {
  const col = SIDE[side]
  g.rect(-20, -400, w + 40, HEADER + 400, shade(col.main, -0.55))
  g.rect(-20, HEADER - 6, w + 40, 6, shade(col.main, -0.68))
  const cy = HEADER / 2
  g.sideMark(side, 170, cy, 13, col.light)
  g.text(v.name, 196, cy + 2, {
    size: 34,
    weight: 600,
    align: 'left',
    color: alpha(C.white, 0.85),
    maxWidth: 150,
  })
  const urgent = v.remaining <= 10
  // In the last ten seconds the clock thumps on every new second.
  const frac = v.remaining - Math.floor(v.remaining)
  const beat = urgent && v.remaining > 0 ? 1 + 0.6 * Math.max(0, frac - 0.75) : 1
  g.at(
    480,
    cy + 3,
    0,
    () =>
      g.text(fmtTime(Math.ceil(Math.max(0, v.remaining))), 0, 0, {
        size: 52,
        weight: 700,
        color: urgent ? C.yellow : C.white,
      }),
    beat,
  )
  // The score: the thing this race is about. It pops on every merge.
  const pop = 1 + 0.4 * (1 - outCubic(prog(v.now - v.scoreAt, 0, 0.4)))
  g.at(
    845,
    cy + 4,
    0,
    () =>
      g.text(v.score, 0, 0, {
        size: 60,
        weight: 700,
        align: 'right',
        color: pop > 1.05 ? mix(C.white, C.yellow, 0.6) : C.white,
        drop: alpha('#000000', 0.35),
      }),
    pop,
  )
}

/** Two fruit that just fused, sliding together as the new one pops (cosmetic). */
export interface Ghost {
  k: number
  ax: number
  ay: number
  bx: number
  by: number
  x: number
  y: number
  t0: number
}

/** How long the fused pair takes to slide together. */
const GHOST = 0.13

export interface JarView {
  jar: Jar
  /** Interpolated aim for this frame. */
  aim: number
  /** Pendulum tilt (radians) of the fruit in hand. */
  swing: number
  /** Vertical jolt of the jar after a hard landing. */
  wobble: number
  ghosts: readonly Ghost[]
  /** Interpolated position of a fruit for this frame, written into `out`. */
  pos: (b: Body, out: [number, number]) => void
  next: number
  /** The kind after the one in hand. */
  after: number
  /** Game time of the last drop (the claw springs back). */
  dropAt: number
  /** The jar is still taking drops (no preview once it is over). */
  live: boolean
  /** Seconds a fruit may rest over the line right now (it shrinks as the match runs). */
  danger: number
  /** Show the how-to line. */
  hint: boolean
  /** Draw the aiming aids (drop line, landing ghost)? Online, only on the viewer's own jar. */
  controls: boolean
}

/** A fruit: a tinted glass bubble with the fruit inside, a gloss on top. */
export function fruit(
  g: Draw,
  k: number,
  x: number,
  y: number,
  r: number,
  scale = 1,
  sq = 0,
  spin = 0,
): void {
  const sx = scale * (1 + sq * 0.14)
  const sy = scale * (1 - sq * 0.14)
  const col = FRUIT_COLOR[k] ?? C.white
  g.at(
    x,
    y,
    0,
    () => {
      g.circle(
        0,
        0,
        r,
        g.rad(
          0,
          0,
          r * 0.1,
          r,
          [
            [0, alpha(shade(col, 0.25), 0.45)],
            [0.7, alpha(shade(col, -0.25), 0.55)],
            [1, alpha(shade(col, -0.55), 0.9)],
          ],
          -r * 0.3,
          -r * 0.35,
        ),
      )
      g.ring(0, 0, r - 2, alpha(shade(col, -0.55), 0.7), Math.max(3, r * 0.07))
      g.emoji(GLYPH[k] ?? '🍒', 0, r * 0.04, r * 2 * 0.86, spin)
      g.alpha(0.45, () => g.ellipse(-r * 0.4, -r * 0.5, r * 0.3, r * 0.15, '#ffffff', -0.6))
    },
    sx,
    sy,
  )
}

function jarOutline(geo: Geo): (c: CanvasRenderingContext2D) => void {
  const { left, right, top, floor } = geo
  const rad = 56 * geo.sc
  return (c) => {
    c.moveTo(left, top - 30 * geo.sc)
    c.lineTo(left, floor - rad)
    c.quadraticCurveTo(left, floor, left + rad, floor)
    c.lineTo(right - rad, floor)
    c.quadraticCurveTo(right, floor, right, floor - rad)
    c.lineTo(right, top - 30 * geo.sc)
  }
}

/** Floodlight and the glass behind the fruit. */
function jarBack(g: Draw, geo: Geo, side: Side, warn: number): void {
  const col = SIDE[side]
  const { left, right, top, floor, danger } = geo
  const cx = (left + right) / 2
  const cy = (top + floor) / 2
  const R = (floor - top) * 0.9
  g.circle(
    cx,
    cy,
    R,
    g.rad(cx, cy, 0, R, [
      [0, alpha(col.main, 0.2)],
      [1, alpha(col.main, 0)],
    ]),
  )
  g.shadow(cx, floor + 22 * geo.sc, (right - left) * 0.56, 28 * geo.sc, 0.45)
  g.path(
    jarOutline(geo),
    g.lin(0, top, 0, floor, [
      [0, alpha(col.dark, 0.18)],
      [1, alpha(col.dark, 0.42)],
    ]),
  )
  // The overflow zone above the danger line glows red as a fruit lingers there.
  g.rect(
    left,
    top - 30 * geo.sc,
    right - left,
    danger - top + 30 * geo.sc,
    alpha(C.red, 0.05 + warn * 0.22),
  )
}

/** Glass walls in front of the fruit: a team-coloured rim, highlights and reflections. */
function jarFront(g: Draw, geo: Geo, side: Side): void {
  const col = SIDE[side]
  const { left, right, top, floor } = geo
  const lw = 18 * geo.sc
  g.path(jarOutline(geo), undefined, shade(col.main, -0.15), lw)
  g.save()
  g.ctx.translate(0, -3)
  g.path(jarOutline(geo), undefined, alpha(col.light, 0.55), 5)
  g.restore()
  // Reflections down the glass.
  const y0 = geo.danger + 24 * geo.sc
  const y1 = floor - 90 * geo.sc
  g.rrect(left + 20 * geo.sc, y0, 16 * geo.sc, y1 - y0, 8 * geo.sc, alpha('#ffffff', 0.1))
  g.rrect(left + 46 * geo.sc, y0, 6 * geo.sc, (y1 - y0) * 0.6, 3 * geo.sc, alpha('#ffffff', 0.08))
  g.rrect(
    right - 34 * geo.sc,
    y0 + 40,
    10 * geo.sc,
    (y1 - y0) * 0.4,
    5 * geo.sc,
    alpha('#ffffff', 0.07),
  )
  // Rounded lips on the rim.
  for (const x of [left, right]) {
    g.ball(x, top - 30 * geo.sc, lw * 0.75, col.light, 0.8)
  }
}

function dangerLine(g: Draw, geo: Geo, warn: number, now: number): void {
  const { left, right, danger } = geo
  const pulse = warn > 0 ? 0.5 + 0.5 * Math.sin(now * 12) : 0
  g.dashed(left + 10, danger, right - 10, danger, alpha(C.red, 0.45 + pulse * 0.5), 6, [18, 14])
  g.text('DANGER', left + 30 * geo.sc, danger - 24, {
    size: 34,
    weight: 700,
    align: 'left',
    color: alpha(C.red, 0.45 + pulse * 0.5),
  })
}

/** The claw on the rail along the top, the fruit in hand, its drop line and landing ghost. */
function hand(g: Draw, geo: Geo, side: Side, v: JarView, now: number): void {
  const col = SIDE[side]
  const { left, right } = geo
  const railY = geo.header + 16
  g.rrect(left - 10, railY - 6, right - left + 20, 12, 6, alpha('#000000', 0.35))
  g.rrect(left - 10, railY - 7, right - left + 20, 6, 3, alpha(C.white, 0.12))
  if (!v.live) return
  const k = v.next
  const r = radius(k, geo)
  // A fresh fruit drops in from the rail.
  const fresh = outBack(prog(now - v.dropAt, 0.12, 0.3))
  const py = previewY(geo, k) + Math.sin(now * 4) * 3
  if (v.controls) {
    const landing = landingY(v.jar, geo, v.aim, k)
    g.dashed(v.aim, py + r + 10, v.aim, landing - r - 6, alpha(col.light, 0.45), 6, [14, 14])
    g.alpha(0.35, () => g.ring(v.aim, landing, r, col.light, 4))
  }
  // The fruit hangs from the claw and swings when the aim moves fast.
  const len = py - railY
  const fx = v.aim + Math.sin(v.swing) * len
  const fy = railY + Math.cos(v.swing) * len
  g.line(
    v.aim,
    railY,
    v.aim + Math.sin(v.swing) * (len - r * fresh),
    railY + Math.cos(v.swing) * (len - r * fresh) + 4,
    alpha(C.white, 0.5),
    5,
  )
  // The claw's jaws spring open as it lets go, then close on the next fruit.
  const open = 1 - prog(now - v.dropAt, 0, 0.22)
  const jaw = 10 + open * 16
  g.line(v.aim - 8, railY + 10, v.aim - jaw, railY + 30, C.yellow, 7)
  g.line(v.aim + 8, railY + 10, v.aim + jaw, railY + 30, C.yellow, 7)
  const pull = 1 + open * 0.12
  g.at(v.aim, railY + 1, 0, () => g.tile(-30, -16, 60, 32, 12, C.yellow, 8), pull, 2 - pull)
  if (fresh > 0.01) fruit(g, k, fx, fy, r, fresh, 0, v.swing * 0.6)
}

/** The next fruit, in a small bubble beside the opening. */
function nextBubble(g: Draw, geo: Geo, w: number, k: number, now: number, dropAt: number): void {
  const x = geo.right + (w - geo.right) / 2 + 4
  const y = geo.top + 10
  const s = outBack(prog(now - dropAt, 0, 0.3))
  g.text('Next', x, y - 68, { size: 34, weight: 600, color: alpha(C.white, 0.6) })
  g.circle(x, y, 44, alpha('#000000', 0.3))
  g.ring(x, y, 44, alpha(C.white, 0.16), 4)
  const r = Math.min(34, radius(k, geo) * 0.8)
  if (s > 0.01) fruit(g, k, x, y, r, s)
}

/** The glass jar, its danger line, the fruit in it, and the fruit in hand. */
export function drawJar(g: Draw, geo: Geo, side: Side, w: number, v: JarView, now: number): void {
  let worst = 0
  for (const b of v.jar.bodies) worst = Math.max(worst, b.hi)
  const warn = Math.min(1, worst / v.danger)
  g.save()
  // A hard landing jolts the whole jar a little.
  g.ctx.translate(0, v.wobble)
  jarBack(g, geo, side, warn)
  // Clip below the header band only, so a falling fruit is never cut as it enters.
  g.clip(
    geo.left - 40,
    geo.header,
    geo.right - geo.left + 80,
    geo.floor + 60 - geo.header,
    0,
    () => {
      // The fused pair slides together and shrinks into the new fruit.
      for (const gh of v.ghosts) {
        const t = (now - gh.t0) / GHOST
        if (t < 0 || t >= 1) continue
        const e = t * t
        const r = radius(gh.k, geo) * (1 - 0.5 * e)
        g.alpha(1 - e, () => {
          fruit(g, gh.k, gh.ax + (gh.x - gh.ax) * e, gh.ay + (gh.y - gh.ay) * e, r)
          fruit(g, gh.k, gh.bx + (gh.x - gh.bx) * e, gh.by + (gh.y - gh.by) * e, r)
        })
      }
      const at: [number, number] = [0, 0]
      for (const b of v.jar.bodies) {
        const age = now - b.born
        // Idle life: resting fruit breathe, each on its own beat.
        const s =
          age < 0.35 ? outBack(prog(age, 0, 0.35)) : 1 + 0.012 * Math.sin(now * 2.4 + b.x * 0.05)
        const r = radius(b.k, geo)
        v.pos(b, at)
        fruit(g, b.k, at[0], at[1], r, s, b.sq, b.a)
        if (b.hi > 0.15) {
          const t = Math.min(1, b.hi / v.danger)
          g.arc(at[0], at[1], r + 10, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2, C.red, 8)
        }
      }
    },
  )
  jarFront(g, geo, side)
  g.restore()
  dangerLine(g, geo, warn, now)
  hand(g, geo, side, v, now)
  if (v.live) nextBubble(g, geo, w, v.after, now, v.dropAt)
  if (v.hint && v.controls) {
    const cy = (geo.danger + geo.floor) / 2
    const bob = Math.sin(now * 3) * 40
    g.text('Drag to aim,', (geo.left + geo.right) / 2, cy - 30, {
      size: 38,
      weight: 600,
      color: alpha(C.white, 0.9),
    })
    g.text('let go to drop', (geo.left + geo.right) / 2, cy + 22, {
      size: 38,
      weight: 600,
      color: alpha(C.white, 0.9),
    })
    g.emoji('👆', (geo.left + geo.right) / 2 + bob, cy + 110, 64)
  }
}

/**
 * A card over a jar: "Jar full!" when it overflows, and the verdict when the
 * game ends. Pops in from `at`.
 */
export function drawCard(
  g: Draw,
  geo: Geo,
  side: Side,
  title: string,
  sub: string,
  o: { at: number; now: number; color?: string; crown?: boolean },
): void {
  const t = o.now - o.at
  if (t < 0) return
  const dim = prog(t, 0, 0.3) * 0.55
  g.alpha(dim, () => g.path(jarOutline(geo), C.ink))
  const s = outBack(prog(t, 0, 0.35))
  const cx = (geo.left + geo.right) / 2
  const cy = (geo.danger + geo.floor) / 2
  const col = o.color ?? SIDE[side].main
  g.at(
    cx,
    cy,
    Math.sin(t * 3) * 0.02 * (1 - inCubic(prog(t, 0, 2))),
    () => {
      g.tile(-290, -120, 580, 250, 54, col, 14)
      if (o.crown) g.emoji('👑', 0, -150, 96)
      g.text(title, 0, -38, { size: 76, weight: 700, drop: alpha('#000000', 0.3) })
      g.text(sub, 0, 44, { size: 50, weight: 600, color: alpha(C.white, 0.9) })
    },
    s,
  )
}
