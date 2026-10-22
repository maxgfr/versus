import { hudY, namePill } from '../../core/hud.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { clamp, inOutCubic, outBack } from '../../core/fx/ease.ts'
import { type ControlLook, drawStrip } from '../../engines/arena/index.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  angleTo,
  heatOf,
  BODY,
  BOX,
  type Knight,
  LANCE,
  type Pose,
  REST,
  SHIELD,
  type World,
} from './rules.ts'

const HORSE = '#8d5a33'
const HORSE_LIGHT = '#c08552'
/** After a touch the scene holds this long before the knights glide back. */
const HOLD = 0.5

function field(g: Draw, now: number): void {
  const { x0, x1, y0, y1 } = BOX
  const w = x1 - x0
  const h = y1 - y0
  g.fillView('#14201a')
  drawStrip(g, y0 - 40, y1 + 40)
  // Wooden rail fence round the lists, with a contact shadow.
  g.rrect(x0 - 30, y0 - 22, w + 68, h + 68, 46, alpha('#000000', 0.4))
  g.rrect(x0 - 34, y0 - 34, w + 68, h + 68, 46, '#6b4a2e')
  g.rrect(x0 - 34, y0 - 34, w + 68, 14, 7, alpha('#ffffff', 0.12))
  g.rrect(x0 - 24, y0 - 24, w + 48, h + 48, 38, '#3b2415')
  // Grass with mown stripes, lit from the middle.
  g.rrect(x0 - 20, y0 - 20, w + 40, h + 40, 34, '#2f6e41')
  for (let y = y0 - 20; y < y1 + 20; y += 120)
    g.rect(x0 - 20, y, w + 40, 60, alpha('#ffffff', 0.04))
  g.rrect(
    x0 - 20,
    y0 - 20,
    w + 40,
    h + 40,
    34,
    g.rad((x0 + x1) / 2, (y0 + y1) / 2, 100, 760, [
      [0, 'rgba(255,255,220,0.08)'],
      [1, 'rgba(0,0,0,0.3)'],
    ]),
  )
  // Team ends.
  g.rect(x0 - 20, y0 - 20, w + 40, (h + 40) / 2, alpha(SIDE[1].main, 0.08))
  g.rect(x0 - 20, y0 + (h + 40) / 2 - 20, w + 40, (h + 40) / 2, alpha(SIDE[0].main, 0.1))
  // Each end's heraldry painted on the grass: a big faint shield with the team's mark.
  for (const side of [0, 1] as const) {
    const cy = y0 + h * (side === 0 ? 0.85 : 0.15)
    g.forSide(side, (x0 + x1) / 2, cy, () => {
      g.ctx.scale(0.66, 0.66)
      const shield = (c: CanvasRenderingContext2D) => {
        c.moveTo(-120, -130)
        c.lineTo(120, -130)
        c.lineTo(120, 10)
        c.quadraticCurveTo(110, 110, 0, 150)
        c.quadraticCurveTo(-110, 110, -120, 10)
        c.closePath()
      }
      g.path(shield, alpha(SIDE[side].main, 0.1), alpha(C.white, 0.12), 8)
      g.sideMark(side, 0, 0, 52, alpha(SIDE[side].light, 0.16))
    })
  }
  g.ring((x0 + x1) / 2, (y0 + y1) / 2, 110, alpha(C.white, 0.14), 6)
  // The tilt line and end lines.
  g.dashed(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, alpha(C.white, 0.25), 6, [22, 18])
  g.rect(x0 + 60, y0 + 40, w - 120, 6, alpha(SIDE[1].light, 0.3))
  g.rect(x0 + 60, y1 - 46, w - 120, 6, alpha(SIDE[0].light, 0.3))
  // Bunting along the top and bottom rails, in each end's colour.
  for (const [y, side] of [
    [y0 - 28, 1],
    [y1 + 28, 0],
  ] as const) {
    const n = 14
    for (let i = 0; i < n; i++) {
      const x = x0 + 20 + ((w - 40) * (i + 0.5)) / n
      const sway = Math.sin(now * 2 + i) * 3
      const dir = side === 1 ? 1 : -1
      g.poly(
        [x - 16, y, x + 16, y, x + sway, y + dir * 30],
        i % 2 ? SIDE[side].main : C.cream,
        alpha('#000000', 0.25),
        2,
      )
    }
  }
  // Posts on the rails.
  for (const [px, py] of [
    [x0 - 28, y0 - 28],
    [x1 + 28, y0 - 28],
    [x0 - 28, y1 + 28],
    [x1 + 28, y1 + 28],
    [x1 + 28, (y0 + y1) / 2],
  ] as const) {
    g.circle(px, py + 4, 16, '#1d120a')
    g.circle(px, py, 16, '#4a2e19')
    g.circle(px - 4, py - 4, 5, alpha('#ffffff', 0.2))
  }
}

/** A horse seen from above, facing its heading (local +x). Its legs swing as it gallops. */
function horse(g: Draw, walk: number, side: Side, charging: boolean): void {
  const col = SIDE[side]
  const phase = walk * 0.09
  for (const [x, y, p] of [
    [30, 22, 0],
    [30, -22, Math.PI],
    [-28, 22, Math.PI],
    [-28, -22, 0],
  ] as const) {
    const s = Math.sin(phase + p) * 12
    g.line(x, y, x + s, y + Math.sign(y) * 20, shade(HORSE, -0.35), 10)
    g.circle(x + s, y + Math.sign(y) * 22, 5, '#2a1a10')
  }
  // Body and quarters.
  g.ellipse(-4, 4, 58, 34, shade(HORSE, -0.45))
  g.ellipse(
    -4,
    0,
    56,
    33,
    g.lin(-30, -30, 30, 30, [
      [0, HORSE_LIGHT],
      [1, HORSE],
    ]),
  )
  // Caparison (the saddle cloth in the side's colour) with a trim.
  g.ellipse(-8, 0, 32, 30, shade(col.main, -0.35))
  g.ellipse(-8, 0, 29, 27, col.main)
  g.ellipse(-12, -8, 20, 8, alpha('#ffffff', 0.22))
  // Neck and head.
  g.rrect(26, -15, 36, 30, 14, HORSE)
  g.ellipse(58, 0, 15, 12, shade(HORSE, 0.1))
  g.circle(66, -5, 3, '#1a0f08')
  g.circle(66, 5, 3, '#1a0f08')
  // Mane and tail.
  g.line(22, -12, -2, -18, '#2a1a10', 7)
  g.line(-46, 0, -76, 8 + Math.sin(phase) * 6, '#2a1a10', 9)
  if (charging)
    for (let i = 0; i < 3; i++)
      g.line(-80 - i * 18, -14 + i * 14, -112 - i * 18, -14 + i * 14, alpha(C.white, 0.55), 5)
}

/** The lance, at its true length (the tip is what scores). */
function lance(g: Draw, side: Side, charging: boolean, now: number): void {
  const col = SIDE[side]
  // From the right hand to the tip, a pennant near the point.
  g.line(4, 14, LANCE, 1, shade(C.cream, -0.25), 8)
  g.line(4, 12, LANCE, -1, C.cream, 4)
  g.poly([LANCE - 18, -5, LANCE - 18, 7, LANCE + 4, 0], '#e7ebf5', alpha(C.ink, 0.5), 2)
  const flap = Math.sin(now * 14) * 4
  g.poly([LANCE - 50, 2, LANCE - 50, 18 + flap, LANCE - 26, 8], col.main, alpha(C.ink, 0.4), 2)
  if (charging) {
    const p = 0.5 + 0.5 * Math.sin(now * 20)
    g.circle(LANCE, 0, 16 + p * 6, alpha(C.yellow, 0.35))
    g.circle(LANCE, 0, 7, C.yellow)
  }
}

/** The rider: helmet with a plume, tabard and the round shield. */
function rider(g: Draw, side: Side): void {
  const col = SIDE[side]
  // Tabard and shoulders.
  g.ellipse(-4, 0, 23, 20, shade(col.main, -0.2))
  g.ellipse(-4, -2, 15, 12, shade(col.main, 0.15))
  // Helmet with a plume.
  g.circle(0, 0, 13, '#c9ced9')
  g.circle(-2, -3, 5, alpha('#ffffff', 0.6))
  g.line(3, -6, 3, 6, '#5b6070', 3)
  g.poly([-8, -8, -26, -14, -10, -1], col.light)
  // Shield on the front-left.
  g.circle(14, -26, 25, shade(col.main, -0.45))
  g.circle(14, -27, 21, col.main)
  g.sideMark(side, 14, -27, 9, alpha('#ffffff', 0.92))
  g.ring(14, -27, 22, alpha('#ffffff', 0.7), 3)
}

/** The guarded front: a faint arc on the ground where a lance only clashes. */
function guardArc(g: Draw, k: Pose, side: Side): void {
  g.path(
    (c) => c.arc(k.x, k.y, BODY + 22, k.a - SHIELD, k.a + SHIELD),
    undefined,
    alpha(SIDE[side].light, 0.35),
    8,
  )
}

function knight(
  g: Draw,
  k: Pose,
  walk: number,
  side: Side,
  charging: boolean,
  dazed: boolean,
  now: number,
  speed = 0,
): void {
  g.shadow(k.x + 8, k.y + 16, BODY * 1.95, BODY * 1.15, 0.38)
  guardArc(g, k, side)
  const wobble = dazed ? Math.sin(now * 18) * 0.12 : 0
  // A charge stretches the pair along the run; a gallop bobs with the stride.
  const run = Math.min(1, Math.abs(speed) / 640)
  const stride = 1 + Math.sin(walk * 0.09) * 0.03 * Math.min(1, Math.abs(speed) / 230)
  const sx = 1 + run * 0.1
  const sy = (1 - run * 0.06) * stride
  g.at(
    k.x,
    k.y,
    k.a + wobble,
    () => {
      g.at(0, 0, 0, () => horse(g, walk, side, charging), 1.22)
      lance(g, side, charging, now)
      g.at(0, 0, 0, () => rider(g, side), 1.18)
    },
    sx,
    sy,
  )
  if (dazed)
    for (let i = 0; i < 3; i++) {
      const a = now * 5 + (i * Math.PI * 2) / 3
      g.star(k.x + Math.cos(a) * 34, k.y + Math.sin(a) * 18 - 36, 11, C.yellow)
    }
}

/** Dust behind a charging horse. */
function dust(g: Draw, k: Pose): void {
  const bx = k.x - Math.cos(k.a) * 64
  const by = k.y - Math.sin(k.a) * 64
  g.circle(bx, by, 18, alpha('#e8dcc0', 0.35))
  g.circle(bx - Math.cos(k.a) * 28, by - Math.sin(k.a) * 28, 26, alpha('#e8dcc0', 0.22))
  g.circle(bx - Math.cos(k.a) * 62, by - Math.sin(k.a) * 62, 32, alpha('#e8dcc0', 0.12))
}

function pad(g: Draw, c: ControlLook, glyph: string): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.5), alpha(col.light, 0.55), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
  const ready = c.ready >= 1
  const face = ready ? col.main : shade(col.main, -0.35)
  const depth = c.fr * 0.16
  const p = c.pressed ? depth : 0
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
      alpha(C.white, 0.7),
      7,
    )
  g.alpha(ready ? 1 : 0.55, () =>
    g.forSide(c.side, c.fx, c.fy + p, () => g.emoji(glyph, 0, 0, c.fr * 1.1)),
  )
}

/** Points as pips above the name pill (between the stick and the button). */
function points(g: Draw, side: Side, n: number, target: number): void {
  const gap = Math.min(46, 300 / Math.max(1, target))
  const rr = Math.min(15, gap * 0.36)
  g.forSide(side, W / 2, hudY(g, side, 150), () => {
    const x0 = -((target - 1) * gap) / 2
    for (let i = 0; i < target; i++) {
      const on = i < n
      g.circle(x0 + i * gap, 0, rr + 3, alpha(C.ink, 0.6))
      g.circle(x0 + i * gap, 0, rr, on ? SIDE[side].main : alpha(C.white, 0.14))
      if (on) g.circle(x0 + i * gap - rr * 0.3, -rr * 0.3, rr * 0.33, alpha(C.white, 0.6))
    }
  })
}

/** A big word that pops in for both players (two copies in local 2P), stamped by state time. */
function stamp(g: Draw, title: string, sub: string, age: number, color: string, y = MID): void {
  if (age < 0) return
  const k = outBack(clamp(age / 0.34, 0, 1))
  const one = (angle: number, cy: number) =>
    g.at(W / 2, cy, angle, () =>
      g.at(
        0,
        0,
        -0.05 * (1 - k),
        () => {
          const tw = Math.max(g.measure(title, 92, 700), g.measure(sub, 38, 600)) + 110
          const h = sub ? 190 : 150
          g.rrect(-tw / 2, -h / 2 + 8, tw, h, 44, alpha('#000000', 0.4))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, alpha(C.ink, 0.92))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, undefined, alpha(color, 0.9), 6)
          g.text(title, 0, sub ? -22 : 4, {
            size: 92,
            weight: 700,
            color,
            drop: alpha('#000000', 0.45),
            maxWidth: 820,
          })
          if (sub)
            g.text(sub, 0, 52, {
              size: 38,
              weight: 600,
              color: alpha(C.white, 0.85),
              maxWidth: 820,
            })
        },
        k,
      ),
    )
  g.alpha(clamp(age * 6, 0, 1), () => {
    if (g.flipTop) {
      one(g.orient(0), y + 150)
      one(g.orient(1), y - 150)
    } else one(g.orient(), y)
  })
}

/** Cosmetic extras from the game (never in the state). */
export interface Look {
  alpha: number
  /** Last step's pose of each knight, for interpolation. */
  prev: readonly (Pose | undefined)[]
}

/** Where a knight is drawn: at the touch for a moment, then gliding back to its spawn. */
function poseOf(w: World, side: Side, look: Look): Pose {
  const k: Knight = w.k[side]
  const gl = w.glide
  if (!gl || w.t - gl.t > REST) {
    const p = look.prev[side]
    // Blend between the last two steps (not across a jump back to the spawn).
    if (!p || Math.hypot(p.x - k.x, p.y - k.y) > 60) return k
    const t = look.alpha
    return { x: p.x + (k.x - p.x) * t, y: p.y + (k.y - p.y) * t, a: p.a + angleTo(p.a, k.a) * t }
  }
  const from = gl.from[side]
  const e = inOutCubic(clamp((w.t - gl.t - HOLD) / (REST - HOLD - 0.15), 0, 1))
  return {
    x: from.x + (k.x - from.x) * e,
    y: from.y + (k.y - from.y) * e,
    a: from.a + angleTo(from.a, k.a) * e,
  }
}

export function renderJoust(
  g: Draw,
  s: State,
  names: [string, string],
  target: number,
  over: boolean,
  now: number,
  look: Look,
): void {
  const w: World = s.w
  field(g, now)
  const hit = w.hit
  const fresh = hit !== null && w.t - hit.t < REST
  const poses = [poseOf(w, 0, look), poseOf(w, 1, look)] as const
  // A pass that drags on heats up: the field glows warmer.
  const heat = heatOf(w)
  if (heat > 0.05 && w.rest < 0)
    g.alpha(heat * (0.12 + 0.05 * Math.sin(g.t * 6)), () => g.fillView(C.orange))
  for (const side of [0, 1] as Side[]) if (w.t < w.k[side].charge) dust(g, poses[side])
  for (const side of [0, 1] as Side[]) {
    const k = w.k[side]
    const struck = (fresh || over) && hit !== null && hit.side !== side
    knight(
      g,
      poses[side],
      k.walk,
      side,
      w.t < k.charge,
      w.t < k.stun || (struck && (over || w.t - (hit?.t ?? 0) < HOLD + 0.3)),
      now,
      k.v,
    )
  }
  // Online, each phone shows only its own player's stick and button.
  for (const c of s.ctl) if (g.viewer === null || c.side === g.viewer) pad(g, c, '🐎')
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, names[side], { active: (fresh || over) && hit?.side === side })
    points(g, side, w.pts[side], target)
  }
  if (hit && (fresh || over)) {
    const col = SIDE[hit.side].light
    const sub = over ? `${names[hit.side]} wins the joust` : `${names[hit.side]} scores`
    stamp(g, over ? 'Victory!' : 'Touché!', sub, w.t - hit.t - 0.12, col)
  } else if (!over && w.rest >= 0 && w.t < w.rest) {
    stamp(g, 'Ride again!', '', w.t - (w.rest - REST), C.white)
  }
}
