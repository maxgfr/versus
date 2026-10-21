import type { Side } from '../../core/game.ts'
import { outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { LANE_W, repeatX } from '../../engines/runner/index.ts'
import { counterPill, laneCard, winPips } from './hud.ts'
import { type Chicken, eggsIn, GROUND, obstaclesIn, type Obstacle, RUN_X, TARGET } from './rules.ts'

export interface LaneView {
  chicken: Chicken
  seed: number
  time: number
  phase: 'wait' | 'fly' | 'end'
  since: number
  wins: number
  rivalWins: number
  round: number
  roundWinner: Side | 'draw' | null
  name: string
  bot: boolean
  matchOver: boolean
}

type View = { x0: number; y0: number; x1: number; y1: number }

/** Cards sit high in the lane, clear of the jumps. */
const CARD_Y = 260

/** Farm skies: sunset for red, midday for blue. */
const SKY: [readonly [string, string, string], readonly [string, string, string]] = [
  ['#ffc59a', '#ffb08e', '#ff8f86'],
  ['#a8dcff', '#8cc6ff', '#5b9dff'],
]

function backdrop(g: Draw, side: Side, v: View, dist: number, time: number): void {
  const [top, mid, bottom] = SKY[side]
  g.rect(
    v.x0,
    v.y0,
    v.x1 - v.x0,
    GROUND - v.y0,
    g.lin(0, v.y0, 0, GROUND, [
      [0, top],
      [0.55, mid],
      [1, bottom],
    ]),
  )
  // The sun, with slow rays.
  const sx = 780 - dist * 0.02
  const sy = 230
  g.at(sx, sy, time * 0.15, () => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      g.poly(
        [
          Math.cos(a - 0.08) * 90,
          Math.sin(a - 0.08) * 90,
          Math.cos(a) * 170,
          Math.sin(a) * 170,
          Math.cos(a + 0.08) * 90,
          Math.sin(a + 0.08) * 90,
        ],
        alpha('#ffffff', 0.16),
      )
    }
  })
  g.circle(sx, sy, 100, alpha('#ffffff', 0.22))
  g.circle(sx, sy, 70, side === 0 ? '#fff1b8' : '#fffbe6')
  // Clouds drift.
  repeatX(dist * 0.1 + time * 12, 560, v.x0, v.x1, (x, i) => {
    const y = 120 + ((i * 53) % 3) * 50
    g.alpha(0.92, () => {
      g.ellipse(x + 110, y + 8, 92, 30, alpha('#000000', 0.04))
      g.ellipse(x + 110, y, 84, 32, '#ffffff')
      g.ellipse(x + 170, y - 20, 62, 42, '#ffffff')
      g.ellipse(x + 225, y + 2, 52, 28, '#ffffff')
    })
  })
  // Far hills in a team-tinted haze, with tiny barns and silos.
  const far = mix(SIDE[side].main, side === 0 ? '#ffb08e' : '#8cc6ff', 0.55)
  repeatX(dist * 0.12, 640, v.x0, v.x1, (x, i) => {
    const h = 170 + ((i * 71) % 3) * 36
    g.ellipse(x + 320, GROUND - 20, 400, h, alpha(far, 0.85))
    if (i % 2 === 0) {
      const bx = x + 296
      const by = GROUND - 20 - h - 34
      g.rect(bx, by, 54, 46, alpha(shade('#b8413c', 0.2), 0.9))
      g.poly([bx - 6, by, bx + 27, by - 26, bx + 60, by], alpha(shade('#7d2a2a', 0.25), 0.9))
      g.rect(bx + 20, by + 22, 14, 24, alpha('#fff1d6', 0.7))
      g.rrect(bx + 64, by - 34, 24, 82, 12, alpha('#e9e0d0', 0.9))
      g.ellipse(bx + 76, by - 34, 12, 8, alpha('#bdb3a3', 0.9))
    }
  })
  // Near hills: the farm's green, rolling past.
  const near = mix(C.grass, SIDE[side].main, 0.1)
  repeatX(dist * 0.35, 420, v.x0, v.x1, (x, i) => {
    const r = 150 + ((i * 31) % 3) * 40
    g.circle(x + 210, GROUND + r * 0.55, r, shade(near, -0.08))
    g.alpha(0.25, () => g.circle(x + 170, GROUND + r * 0.55 - r * 0.2, r * 0.6, '#ffffff'))
  })
}

/** Solid spans of the ground between pits, in local x. */
function groundSpans(pits: Obstacle[], dist: number, x0: number, x1: number): [number, number][] {
  const spans: [number, number][] = []
  let x = x0
  for (const p of pits) {
    const a = p.x - dist
    const b = a + p.w
    if (a > x) spans.push([x, a])
    x = Math.max(x, b)
  }
  if (x < x1) spans.push([x, x1])
  return spans
}

function ground(g: Draw, v: View, dist: number, pits: Obstacle[]): void {
  for (const pit of pits) {
    const a = pit.x - dist
    // The pit: a dark shaft with dirt walls.
    g.rect(
      a,
      GROUND,
      pit.w,
      v.y1 - GROUND,
      g.lin(0, GROUND, 0, GROUND + 160, [
        [0, '#3a2414'],
        [1, '#0b0610'],
      ]),
    )
    g.rect(a, GROUND, 14, v.y1 - GROUND, alpha('#000000', 0.35))
    g.rect(a + pit.w - 14, GROUND, 14, v.y1 - GROUND, alpha('#ffffff', 0.06))
    // Roots dangling into it.
    g.line(a + 22, GROUND + 20, a + 30, GROUND + 70, alpha('#7a4a25', 0.8), 5)
    g.line(a + pit.w - 26, GROUND + 22, a + pit.w - 36, GROUND + 58, alpha('#7a4a25', 0.8), 5)
  }
  for (const [a, b] of groundSpans(pits, dist, v.x0 - 30, v.x1 + 30)) {
    if (b - a < 30) continue
    g.rrect(
      a,
      GROUND,
      b - a,
      v.y1 - GROUND + 20,
      18,
      g.lin(0, GROUND, 0, v.y1, [
        [0, '#d79b5a'],
        [0.25, '#b87a43'],
        [1, '#6a3e1f'],
      ]),
    )
    g.clip(a, GROUND, b - a, v.y1 - GROUND + 20, 18, () => {
      // Furrows and pebbles slide past to sell the speed.
      repeatX(dist, 90, a - 90, b + 90, (x, i) => {
        g.poly(
          [x, GROUND + 50, x + 34, GROUND + 50, x + 10, GROUND + 110, x - 24, GROUND + 110],
          alpha('#5c3618', 0.35),
        )
        g.ellipse(x + 50, GROUND + 140 + ((i * 37) % 40), 9, 6, alpha('#ffffff', 0.12))
      })
    })
    // Thick grass band with a glossy top and tufts.
    g.rrect(a - 4, GROUND - 20, b - a + 8, 44, 18, C.grassDark)
    g.rrect(a - 4, GROUND - 22, b - a + 8, 36, 18, C.grass)
    g.rrect(a + 10, GROUND - 17, b - a - 20, 8, 4, alpha('#ffffff', 0.3))
    repeatX(dist, 64, a + 10, b - 30, (x, i) => {
      if (x < a + 8 || x > b - 28) return
      const h = 16 + ((i * 13) % 3) * 6
      g.poly([x, GROUND - 18, x + 8, GROUND - 18 - h, x + 16, GROUND - 18], shade(C.grass, 0.12))
      if (i % 5 === 0) g.circle(x + 30, GROUND - 24, 7, i % 10 === 0 ? '#ffffff' : C.pink)
    })
  }
}

/** A painted farm fence: pointed posts, two rails, a cast shadow. */
function fence(g: Draw, x: number, w: number, h: number): void {
  g.shadow(x + w / 2, GROUND + 4, w / 2 + 14, 9, 0.28)
  const paint = '#fff4e4'
  const dark = shade(paint, -0.3)
  for (const px of [x + 2, x + w - 22]) {
    g.rrect(px + 3, GROUND - h + 18, 20, h - 14, 5, alpha(C.ink, 0.35))
    g.rect(px, GROUND - h + 14, 20, h - 14, paint)
    g.poly([px, GROUND - h + 14, px + 10, GROUND - h, px + 20, GROUND - h + 14], paint)
    g.rect(px + 13, GROUND - h + 14, 7, h - 14, dark)
  }
  for (const ry of [GROUND - h + 34, GROUND - 46]) {
    g.rrect(x - 8, ry + 5, w + 16, 22, 8, alpha(C.ink, 0.3))
    g.rrect(x - 8, ry, w + 16, 22, 8, C.wood)
    g.rrect(x - 4, ry + 3, w + 8, 6, 3, alpha('#ffffff', 0.35))
  }
}

/** A round hay bale: straw gradient, twine bands, loose strands. */
function haystack(g: Draw, x: number, w: number, h: number): void {
  g.shadow(x + w / 2, GROUND + 4, w / 2 + 14, 10, 0.3)
  const top = GROUND - h
  g.rrect(
    x - 6,
    top,
    w + 12,
    h + 6,
    26,
    g.lin(0, top, 0, GROUND, [
      [0, '#ffe58f'],
      [0.45, '#f5c04f'],
      [1, '#b97b24'],
    ]),
  )
  for (let k = 0; k < 7; k++) {
    const sx = x + 6 + k * ((w - 12) / 6)
    g.line(sx, top + 12, sx + 4, GROUND - 8, alpha('#a86d1c', 0.4), 3)
  }
  g.rect(x + w * 0.28, top + 2, 9, h + 2, alpha('#8a4a1c', 0.75))
  g.rect(x + w * 0.66, top + 2, 9, h + 2, alpha('#8a4a1c', 0.75))
  g.rrect(x + 4, top + 6, w - 8, 12, 6, alpha('#ffffff', 0.4))
  g.line(x + 20, top + 2, x + 6, top - 14, '#f5c04f', 4)
  g.line(x + w - 30, top + 2, x + w - 14, top - 12, '#f5c04f', 4)
}

function obstacle(g: Draw, o: Obstacle, dist: number): void {
  const x = o.x - dist
  if (o.kind === 'fence') fence(g, x, o.w, o.h)
  else if (o.kind === 'hay') haystack(g, x, o.w, o.h)
}

function chicken(g: Draw, owner: Side, c: Chicken, o: LaneView): void {
  const col = SIDE[owner]
  const time = o.time
  const airborne = c.alive && !c.grounded
  const running = c.alive && c.grounded && o.phase === 'fly'
  const run = running ? Math.sin(c.dist * 0.075) : 0
  const flapT = airborne ? Math.sin(time * 26) : 0
  const tilt = c.alive
    ? Math.max(-0.3, Math.min(0.35, -c.vh / 1600))
    : Math.min(Math.PI * 0.75, (time - c.deadAt) * 5)
  // Squash on landing, stretch on take-off.
  const sl = time - c.landAt
  const sj = time - c.flipAt
  const land = c.alive && sl < 0.18 ? Math.sin((sl / 0.18) * Math.PI) * 0.2 : 0
  const jump = c.alive && sj < 0.2 ? Math.sin((sj / 0.2) * Math.PI) * 0.16 : 0
  const sx = 1 + land - jump
  const sy = 1 - land + jump
  const bob = running ? Math.abs(run) * 5 : 0
  const cy = GROUND - c.h - 58 - bob
  const hgt = Math.max(0, c.h)
  if (c.h > -20) g.shadow(RUN_X, GROUND + 6, 50 * Math.max(0.3, 1 - hgt / 500), 10, 0.3)
  // Dust kicked up while running.
  if (running) {
    for (let k = 0; k < 3; k++) {
      const p = (c.dist * 0.012 + k / 3) % 1
      g.alpha((1 - p) * 0.5, () =>
        g.circle(RUN_X - 40 - p * 110, GROUND - 8 - p * 20, 8 + p * 16, '#f4e3c9'),
      )
    }
  }
  g.at(
    RUN_X,
    cy,
    tilt,
    () => {
      // Legs, stepping while running, tucked in the air.
      for (const k of [-1, 1]) {
        const step = airborne ? 0 : run * k * 14
        const foot = airborne ? 52 : 66
        g.line(k * 10, 30, k * 10 + step, foot, shade(C.orange, -0.1), 8)
        g.line(k * 10 + step - 9, foot, k * 10 + step + 13, foot, shade(C.orange, -0.1), 8)
      }
      // Tail feathers.
      for (const [dx, dy, a] of [
        [-42, -22, -0.7],
        [-48, -6, -0.3],
        [-42, 8, 0.1],
      ] as const) {
        g.ellipse(dx, dy, 20, 10, shade(C.white, -0.14), a)
      }
      // Body: a soft glossy egg shape.
      g.ellipse(0, 4, 48, 42, shade(C.white, -0.22))
      g.ellipse(
        -2,
        -2,
        46,
        40,
        g.rad(-14, -18, 4, 52, [
          [0, '#ffffff'],
          [0.7, C.white],
          [1, shade(C.white, -0.12)],
        ]),
      )
      g.alpha(0.7, () => g.ellipse(-14, -24, 16, 8, '#ffffff', -0.3))
      // Wing: flaps hard in the air.
      g.ellipse(-8, -2 + flapT * 16, 28, 15, shade(C.cream, -0.12), -0.35 - flapT * 0.6)
      // Team scarf with tails streaming behind.
      const wave = Math.sin(time * 18) * 6
      g.poly([22, -18, -14, -12 + wave, -20, -2 + wave, 20, -4], shade(col.main, -0.15))
      g.rrect(16, -24, 28, 22, 10, col.main)
      g.rrect(20, -22, 18, 6, 3, alpha('#ffffff', 0.4))
      // Head.
      g.circle(40, -46, 27, shade(C.white, -0.12))
      g.circle(39, -48, 25, C.white)
      g.circle(30, -70, 10, C.red)
      g.circle(42, -76, 11, C.red)
      g.circle(55, -68, 9, C.red)
      g.circle(40, -78, 4, alpha('#ffffff', 0.5))
      g.poly([62, -52, 88, -43, 62, -34], C.orange)
      g.poly([62, -42, 84, -43, 62, -34], shade(C.orange, -0.25))
      g.ellipse(58, -28, 7, 11, C.red)
      if (!c.alive) {
        g.line(43, -57, 53, -47, C.ink, 4)
        g.line(53, -57, 43, -47, C.ink, 4)
      } else {
        const wide = airborne ? 8 : 7
        g.circle(48, -51, wide, '#ffffff')
        g.circle(50, -51, 5, C.ink)
        g.circle(51, -53, 2, '#ffffff')
      }
      g.alpha(0.4, () => g.ellipse(34, -36, 8, 5, C.pink))
    },
    sx,
    sy,
  )
}

function eggs(g: Draw, c: Chicken, seed: number, dist: number, v: View, time: number): void {
  for (const e of eggsIn(seed, dist + v.x0 - 40, dist + v.x1 + 40)) {
    if (c.taken.includes(e.id) || e.id < c.cursor) continue
    const x = e.x - dist
    const y = GROUND - e.h + Math.sin(time * 4 + e.id) * 6
    const glow = 0.5 + 0.5 * Math.sin(time * 5 + e.id * 1.3)
    g.circle(
      x,
      y,
      52,
      g.rad(x, y, 0, 52, [
        [0, alpha(C.yellow, 0.45 + glow * 0.2)],
        [1, alpha(C.yellow, 0)],
      ]),
    )
    g.emoji('🥚', x, y, 56, Math.sin(time * 3 + e.id) * 0.15)
    // A twinkle that hops around the egg.
    const tw = (time * 1.4 + e.id * 0.37) % 1
    if (tw < 0.3) {
      const s = Math.sin((tw / 0.3) * Math.PI)
      g.star(x + 24, y - 26, 12 * s, '#ffffff', 4, 0.35, 0)
    }
  }
}

function crown(g: Draw, c: Chicken, t: number): void {
  const s = outCubic(prog(t, 0, 0.35))
  g.emoji('👑', RUN_X + 36, GROUND - c.h - 168 + Math.sin(t * 5) * 8, 60 * s, 0.15)
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const c = o.chicken
  const dist = c.dist
  backdrop(g, side, v, dist, o.time)
  const lo = dist + v.x0 - 120
  const hi = dist + v.x1 + 120
  const obs = obstaclesIn(o.seed, lo, hi)
  const pits = obs.filter((x) => x.kind === 'pit')
  ground(g, v, dist, pits)
  for (const ob of obs) if (ob.kind !== 'pit') obstacle(g, ob, dist)
  eggs(g, c, o.seed, dist, v, o.time)
  chicken(g, side, c, o)

  const won = o.phase === 'end' && o.roundWinner === side
  if (won) crown(g, c, o.since)

  counterPill(g, side, c.eggs, o.bot ? 'Computer' : o.name, LANE_W / 2 - 60, 70, o.time - c.scoreAt)
  winPips(g, side, o.wins, TARGET, LANE_W - 200, 66, won ? o.since : 9)

  const cx = LANE_W / 2 + 90
  if (o.phase === 'wait') {
    const label = o.round > 1 ? `Round ${o.round}` : o.bot ? 'Ready…' : 'Tap to jump!'
    laneCard(g, label, cx, CARD_Y, {
      t: o.since,
      sub: o.bot ? '' : o.round > 1 ? `${o.wins} – ${o.rivalWins}` : 'Hold for a higher jump',
      accent: SIDE[side].main,
    })
    if (!o.bot) g.emoji('👆', RUN_X + 150, GROUND - 120 + Math.sin(o.time * 8) * 14, 84)
  } else if (o.phase === 'end') {
    const w = o.roundWinner
    const done = o.matchOver
    const text =
      w === 'draw'
        ? 'Draw!'
        : w === side
          ? done
            ? 'Winner!'
            : 'Round won!'
          : done
            ? 'Beaten!'
            : 'Crashed!'
    const col = w === 'draw' ? C.white : w === side ? C.yellow : SIDE[side].light
    laneCard(g, text, cx, CARD_Y, {
      t: o.since - 0.15,
      sub: `${o.wins} – ${o.rivalWins}`,
      color: col,
      accent: w === side ? C.yellow : SIDE[side].main,
      emoji: w === side ? (done ? '🏆' : '⭐') : w === 'draw' ? '🤝' : '💫',
      big: done,
    })
  }
}
