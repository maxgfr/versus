import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { LANE_H, LANE_W } from '../../engines/runner/index.ts'
import { counterPill, laneCard } from './hud.ts'
import {
  BASE_Y,
  CRUMBLE,
  type Climber,
  metres,
  type Plat,
  PLAT_W,
  platformsBetween,
  platX,
  solidFor,
} from './rules.ts'

export interface LaneView {
  climber: Climber
  /** Interpolated height, x and camera for this frame. */
  h: number
  x: number
  cam: number
  rival: Climber
  seed: number
  time: number
  phase: 'wait' | 'fly' | 'end'
  since: number
  name: string
  bot: boolean
  winner: Side | 'draw' | null
  cause: 'out' | 'time' | null
  /** Counter at the lane's top (the computer's lane in 1P) rather than its bottom edge. */
  hudTop: boolean
}

type View = { x0: number; y0: number; x1: number; y1: number }

/** Screen y of a height, given the lane's camera. */
const yOf = (h: number, cam: number): number => BASE_Y - (h - cam)

/**
 * The sky by altitude, per team: day, dusk, night, deep night, so the climb
 * reads as a climb. Red climbs through a sunset, blue through a cool evening.
 */
const SKIES: [[string, string][], [string, string][]] = [
  [
    ['#ffb59a', '#ffe9c9'],
    ['#ff7f7a', '#ffc08f'],
    ['#5a1f4a', '#b2405f'],
    ['#140a1c', '#3a1430'],
  ],
  [
    ['#7cc6ff', '#e4f6ff'],
    ['#4f8cff', '#9fe0ff'],
    ['#1c2a74', '#3b6bd0'],
    ['#070b22', '#16234f'],
  ],
]

function skyAt(side: Side, alt: number): [string, string] {
  const skies = SKIES[side]
  const f = Math.max(0, Math.min(skies.length - 1.001, alt / 2600))
  const k = Math.floor(f)
  const t = f - k
  const a = skies[k] as [string, string]
  const b = skies[k + 1] as [string, string]
  return [mix(a[0], b[0], t), mix(a[1], b[1], t)]
}

function backdrop(g: Draw, side: Side, v: View, cam: number, time: number): void {
  const [top, bottom] = skyAt(side, cam)
  g.rect(
    v.x0,
    v.y0,
    v.x1 - v.x0,
    v.y1 - v.y0,
    g.lin(0, v.y0, 0, v.y1, [
      [0, top],
      [1, bottom],
    ]),
  )
  const night = Math.max(0, Math.min(1, (cam - 3000) / 1600))
  if (night > 0) {
    for (let k = 0; k < 46; k++) {
      // Stars sit far away: they drift down slowly as the climber rises.
      const y = ((((k * 211 + cam * 0.08) % 1100) + 1100) % 1100) - 100
      const x = (k * 383) % 1000
      const tw = 0.5 + 0.5 * Math.sin(time * 2.5 + k)
      g.circle(x, y, 2 + (k % 3), alpha(C.white, (0.4 + 0.5 * tw) * night))
    }
    // A big moon in the team's light.
    const my = 220 + (cam % 6000) * 0.01
    g.circle(800, my, 110, alpha(SIDE[side].light, 0.12 * night))
    g.circle(800, my, 64, alpha('#fff6dc', 0.9 * night))
    g.circle(780, my - 14, 14, alpha('#e9dcbc', 0.8 * night))
    g.circle(822, my + 18, 9, alpha('#e9dcbc', 0.8 * night))
  }
  // Hills at the start, sinking out of view as the climb begins.
  const hy = yOf(0, cam) + 80
  if (hy < v.y1 + 300) {
    const hill = mix(SIDE[side].main, C.grass, 0.8)
    g.circle(160, hy + 160, 300, shade(hill, -0.1))
    g.circle(820, hy + 200, 340, hill)
  }
  // Clouds are anchored to altitude, so they slide down as the climber rises.
  g.alpha(0.9 * (1 - night), () => {
    for (let k = 0; k < 40; k++) {
      const y = BASE_Y - (k * 330 + 120 - cam) * 0.6 - 60
      if (y < -80 || y > LANE_H + 80) continue
      const x = 150 + ((k * 383) % 700)
      g.ellipse(x + 30, y + 14, 120, 26, alpha('#000000', 0.04))
      g.ellipse(x, y, 90, 34, '#ffffff')
      g.ellipse(x + 60, y - 18, 60, 40, '#ffffff')
      g.ellipse(x + 110, y + 2, 50, 28, '#ffffff')
    }
  })
}

/** Altitude marks every 100 m: a dashed rung and its label. */
function marks(g: Draw, cam: number, v: View): void {
  const lo = Math.ceil((cam - 200) / 1000)
  const hi = Math.floor((cam + 900) / 1000)
  for (let k = Math.max(1, lo); k <= hi; k++) {
    const y = yOf(k * 1000, cam)
    if (y < v.y0 - 40 || y > v.y1 + 40) continue
    g.dashed(v.x0, y, v.x1, y, alpha(C.white, 0.35), 4, [18, 16])
    const label = `${k * 100} m`
    const w = g.measure(label, 36, 700) + 36
    g.rrect(LANE_W - 140 - w / 2, y - 26, w, 52, 26, alpha(C.ink, 0.55))
    g.text(label, LANE_W - 140, y + 2, { size: 36, weight: 700, color: alpha(C.white, 0.9) })
  }
}

function chevron(g: Draw, x: number, y: number, dir: 1 | -1): void {
  g.poly(
    [x - 8 * dir, y - 10, x + 6 * dir, y, x - 8 * dir, y + 10, x - 2 * dir, y],
    alpha(C.white, 0.95),
  )
}

function platform(g: Draw, p: Plat, time: number, c: Climber, cam: number): void {
  const y = yOf(p.h, cam)
  const x = platX(p, time)
  const w = p.i === 0 ? 260 : PLAT_W
  const solid = solidFor(c, p, time)
  const crumble = c.crumble.find(([i]) => i === p.i)
  if (p.kind === 'break' && crumble && !solid) {
    // Crumbled: the two halves tip and fall away.
    const t = time - crumble[1] - CRUMBLE
    if (t > 0.7) return
    const drop = 900 * t * t + 80 * t
    g.alpha(1 - t / 0.7, () => {
      for (const k of [-1, 1]) {
        g.at(x + k * (w / 4 + t * 60), y + drop, k * t * 3, () =>
          g.tile(-w / 4, -20, w / 2 - 4, 44, 12, C.wood, 10),
        )
      }
    })
    return
  }
  // Wobble while it is about to crumble.
  const shake = crumble ? Math.sin(time * 70) * 4 : 0
  const xx = x + shake
  g.shadow(xx, y + 44, w * 0.42, 9, 0.12)
  if (p.kind === 'move') {
    g.tile(xx - w / 2, y - 24, w, 50, 22, C.teal, 12)
    chevron(g, xx - w / 2 + 26, y - 2, -1)
    chevron(g, xx + w / 2 - 26, y - 2, 1)
    const blink = Math.sin(time * 6 + p.i) > 0
    g.circle(xx, y - 4, 7, blink ? C.white : alpha(C.white, 0.35))
  } else if (p.kind === 'break') {
    g.tile(xx - w / 2, y - 24, w, 50, 14, C.wood, 12)
    for (let k = 1; k < 3; k++) {
      g.rect(xx - w / 2 + (k * w) / 3 - 2, y - 22, 4, 36, alpha(C.woodDark, 0.6))
    }
    g.line(xx - 30, y - 18, xx - 10, y - 2, C.woodDark, 4)
    g.line(xx - 10, y - 2, xx - 18, y + 10, C.woodDark, 4)
    g.line(xx + 20, y - 20, xx + 32, y + 6, C.woodDark, 4)
  } else if (p.i === 0) {
    g.tile(xx - w / 2, y - 24, w, 64, 20, C.sand, 14)
    g.text('START', xx, y + 4, { size: 34, weight: 700, color: alpha(C.woodDark, 0.6) })
  } else {
    // Grassy toy block: dirt body, a thick grass cap with tufts.
    g.tile(xx - w / 2, y - 14, w, 44, 16, '#b47a45', 10)
    g.tile(xx - w / 2 - 4, y - 26, w + 8, 30, 15, C.grass, 8)
    for (let k = 0; k < 4; k++) {
      const sx = xx - w / 2 + 20 + (k * (w - 40)) / 3
      g.poly([sx - 7, y - 24, sx, y - 38, sx + 7, y - 24], shade(C.grass, 0.15))
    }
  }
}

/** The kangaroo: procedural, with a team-coloured bandana. Faces the way it moves. */
function kangaroo(g: Draw, owner: Side, c: Climber, o: LaneView, cam: number): void {
  const time = o.time
  const col = SIDE[owner]
  const tan = '#e7a861'
  const tanDark = shade(tan, -0.22)
  const since = time - c.landAt
  // Squash on each bounce, deeper on a centred one, with a little rebound wobble.
  const lk = 0.14 + 0.14 * c.landK
  const squash =
    c.alive && since < 0.3
      ? since < 0.12
        ? Math.sin((since / 0.12) * Math.PI * 0.5) * lk
        : Math.cos(((since - 0.12) / 0.18) * Math.PI) * lk * 0.45 * (1 - (since - 0.12) / 0.18)
      : 0
  const cx = o.x
  const stretch = c.alive && c.vh > 0 ? Math.min(0.14, c.vh / 10000) : 0
  const face = c.vx < -30 ? -1 : 1
  const tilt = c.alive
    ? Math.max(-0.25, Math.min(0.25, c.vx / 2200))
    : Math.min(Math.PI * 1.5, (time - c.deadAt) * 6)
  // The winner hops in place while the ending plays.
  const cheer = o.phase === 'end' && o.winner === owner && c.alive
  const hop = cheer ? Math.abs(Math.sin(o.since * 7)) * 40 : 0
  const feet = yOf(o.h, cam) - hop
  const falling = c.alive && c.vh < -200
  const legs = falling ? 1 : 0
  // Speed lines while it shoots upward.
  if (c.alive && c.vh > 700) {
    for (const dx of [-30, 0, 30]) {
      g.line(cx + dx, feet + 20, cx + dx, feet + 60 + (c.vh - 700) * 0.08, alpha(C.white, 0.4), 5)
    }
  }
  g.at(
    cx,
    feet - 56,
    tilt,
    () => {
      // Tail.
      g.ellipse(-56, 26, 36, 12, tanDark, -0.35)
      g.ellipse(-84, 14, 18, 9, shade(tanDark, -0.1), -0.6)
      // Hind leg and long foot: tucked when rising, reaching down when falling.
      g.ellipse(-12, 44 + legs * 6, 24, 15, tanDark)
      g.ellipse(14 - legs * 6, 54 + legs * 14, 32, 10, shade(tanDark, -0.1), legs * 0.3)
      // Body with a soft light.
      g.ellipse(
        0,
        4,
        42,
        46,
        g.rad(-12, -14, 4, 56, [
          [0, shade(tan, 0.25)],
          [0.7, tan],
          [1, tanDark],
        ]),
      )
      g.ellipse(9, 16, 25, 21, '#f6d6a4')
      g.ellipse(9, 22, 16, 6, alpha(tanDark, 0.4))
      // Arm.
      g.ellipse(30, -6 + legs * 6, 13, 7, tanDark, -0.4 - legs * 0.6)
      // Head and long ears.
      g.circle(
        34,
        -44,
        27,
        g.rad(26, -54, 2, 32, [
          [0, shade(tan, 0.25)],
          [1, tan],
        ]),
      )
      const flop = c.vh > 0 ? 0.12 : -0.12
      g.ellipse(20, -94, 10, 28, tan, -0.14 - flop)
      g.ellipse(42, -96, 10, 28, tan, 0.08 - flop)
      g.ellipse(20, -92, 4, 18, '#f2a7a0', -0.14 - flop)
      g.ellipse(42, -94, 4, 18, '#f2a7a0', 0.08 - flop)
      // Team bandana with its knot tails flapping.
      const wave = Math.sin(time * 16) * 6
      g.poly([12, -60, -16, -70 + wave, -14, -54 + wave], shade(col.main, -0.2))
      g.poly([12, -56, -12, -50 - wave, -4, -44 - wave], shade(col.main, -0.2))
      g.rrect(10, -66, 40, 16, 7, col.main)
      g.rrect(14, -64, 30, 5, 2, alpha('#ffffff', 0.45))
      // Face.
      if (c.alive) {
        g.circle(46, -48, 7, '#ffffff')
        g.circle(48, -48, 5, C.ink)
        g.circle(49, -50, 2, '#ffffff')
      } else {
        g.line(42, -52, 52, -42, C.ink, 4)
        g.line(52, -52, 42, -42, C.ink, 4)
      }
      g.ellipse(64, -38, 8, 6, C.ink)
      g.arc(54, -32, 8, 0.2, Math.PI - 0.6, C.ink, 3)
      g.alpha(0.45, () => g.ellipse(36, -36, 9, 5, C.pink))
    },
    face * (1 + squash * 0.5 - stretch * 0.3),
    1 - squash + stretch,
  )
  if (cheer) {
    const s = outBack(prog(o.since, 0, 0.35))
    g.emoji('👑', cx + face * 30, feet - 190 + Math.sin(o.since * 5) * 6, 60 * s, 0.1 * face)
  }
}

/** Where the rival is: a tab on the lane's edge at its height, or an arrow when out of view. */
function rivalTab(g: Draw, owner: Side, rival: Climber, cam: number, time: number): void {
  if (!rival.alive) return
  const rs: Side = owner === 0 ? 1 : 0
  const col = SIDE[rs]
  const y = yOf(rival.h, cam) - 56
  const clamped = Math.max(240, Math.min(850, y))
  const x = LANE_W - 34
  const off = y !== clamped
  g.rrect(x - 30, clamped - 30, 64, 60, 18, alpha(C.ink, 0.6))
  g.sideMark(rs, x, clamped, 15, col.main)
  if (off) {
    const up = y < clamped ? -1 : 1
    const bob = Math.sin(time * 6) * 4
    g.poly(
      [
        x - 14,
        clamped + up * (40 + bob),
        x,
        clamped + up * (56 + bob),
        x + 14,
        clamped + up * (40 + bob),
      ],
      col.light,
    )
  }
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const c = o.climber
  const cam = o.cam
  backdrop(g, side, v, cam, o.time)
  marks(g, cam, v)
  for (const p of platformsBetween(o.seed, cam - 160, cam + 1000)) platform(g, p, o.time, c, cam)
  rivalTab(g, side, o.rival, cam, o.time)
  kangaroo(g, side, c, o, cam)

  // The counter sits at the player's own edge, clear of the platforms ahead
  // (the computer's lane in 1P keeps it at the top, away from the midline clock).
  counterPill(
    g,
    side,
    `${metres(c)} m`,
    o.bot ? 'Computer' : o.name,
    40,
    o.hudTop ? 70 : 838,
    o.time - c.scoreAt,
    true,
  )
  const cx = LANE_W / 2
  const cy = LANE_H * 0.52
  if (o.phase === 'wait') {
    // Online, each phone only coaches its own player: the rival's lane just says Ready.
    const coach = !o.bot && (g.viewer === null || g.viewer === side)
    laneCard(g, coach ? 'Hold to steer' : 'Ready…', cx, cy, {
      t: o.since,
      sub: coach ? 'Left or right of your half' : '',
      accent: SIDE[side].main,
    })
    if (coach) {
      const k = Math.sin(o.time * 4)
      g.emoji('👈', 330 - Math.max(0, -k) * 30, cy + 170, 70)
      g.emoji('👉', 670 + Math.max(0, k) * 30, cy + 170, 70)
    }
  } else if (o.phase === 'end') {
    const w = o.winner
    const won = w === side
    const title = w === 'draw' ? 'Draw!' : won ? 'Winner!' : c.alive ? 'Out-climbed!' : 'Splat!'
    const sub = o.cause === 'time' ? `Time! ${metres(c)} m` : `${metres(c)} m`
    laneCard(g, title, cx, cy, {
      t: o.since - 0.15,
      sub,
      color: w === 'draw' ? C.white : won ? C.yellow : SIDE[side].light,
      accent: won ? C.yellow : SIDE[side].main,
      emoji: won ? '🏆' : w === 'draw' ? '🤝' : c.alive ? '⏱️' : '💫',
      big: true,
    })
  } else if (!c.alive) {
    laneCard(g, 'Splat!', cx, cy, {
      t: o.time - c.deadAt,
      sub: `${metres(c)} m`,
      color: SIDE[side].light,
      accent: SIDE[side].main,
      emoji: '💫',
    })
  }
}
