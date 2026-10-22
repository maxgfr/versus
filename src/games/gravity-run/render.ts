import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { LANE_H, LANE_W, repeatX } from '../../engines/runner/index.ts'
import { counterPill, laneCard, winPips } from './hud.ts'
import {
  CEIL,
  FLOOR,
  type Hazard,
  hazardsOn,
  LAND_HI,
  LAND_LO,
  RUN_R,
  RUN_X,
  type Runner,
  runnerAngle,
  SPIKE_H,
  SPIKE_W,
} from './rules.ts'

export interface LaneView {
  runner: Runner
  /** Interpolated height and distance for this frame. */
  y: number
  dist: number
  seed: number
  time: number
  phase: 'wait' | 'fly' | 'end'
  since: number
  wins: number
  rivalWins: number
  round: number
  /** Round wins to take the match. */
  target: number
  roundWinner: Side | 'draw' | null
  name: string
  bot: boolean
  matchOver: boolean
}

type View = { x0: number; y0: number; x1: number; y1: number }

/** Thickness of the floor and ceiling slabs, and the block length along them. */
const SLAB = 70
const BLOCK = 120
const MIDY = (CEIL + FLOOR) / 2

/** Deep space tinted by the team, a lit corridor running through it. */
function background(g: Draw, side: Side, v: View, dist: number, time: number): void {
  const col = SIDE[side]
  const deep = mix(C.ink, col.dark, 0.22)
  g.rect(
    v.x0,
    v.y0,
    v.x1 - v.x0,
    v.y1 - v.y0,
    g.lin(0, v.y0, 0, v.y1, [
      [0, shade(C.ink, -0.3)],
      [0.5, deep],
      [1, shade(C.ink, -0.3)],
    ]),
  )
  // Nebula puffs in the voids, barely moving.
  repeatX(dist * 0.04, 700, v.x0, v.x1, (x, i) => {
    const y = i % 2 === 0 ? CEIL - SLAB - 40 : FLOOR + SLAB + 40
    g.circle(
      x + 300,
      y,
      240,
      g.rad(x + 300, y, 0, 240, [
        [0, alpha(col.main, 0.2)],
        [1, alpha(col.main, 0)],
      ]),
    )
  })
  // Two layers of stars.
  repeatX(dist * 0.08, 113, v.x0, v.x1, (x, i) => {
    const tw = 0.45 + 0.35 * Math.sin(time * 3 + i * 1.7)
    g.circle(x + 30, v.y0 + 18 + ((i * 131) % 110), 2.6, alpha(C.white, tw))
    g.circle(x + 71, FLOOR + SLAB + 14 + ((i * 89) % 130), 2.6, alpha(C.white, tw * 0.8))
  })
  repeatX(dist * 0.2, 167, v.x0, v.x1, (x, i) => {
    g.circle(x + 50, v.y0 + 30 + ((i * 47) % 90), 4, alpha(col.light, 0.5))
    g.circle(x + 120, FLOOR + SLAB + 30 + ((i * 61) % 100), 4, alpha(col.light, 0.4))
  })
  // The corridor: a lit tube with parallax panels and chevrons streaming past.
  g.rect(
    v.x0,
    CEIL,
    v.x1 - v.x0,
    FLOOR - CEIL,
    g.lin(0, CEIL, 0, FLOOR, [
      [0, mix(C.ink, col.dark, 0.55)],
      [0.5, mix(C.ink2, col.dark, 0.3)],
      [1, mix(C.ink, col.dark, 0.55)],
    ]),
  )
  repeatX(dist * 0.45, 300, v.x0, v.x1, (x, i) => {
    g.rrect(x + 24, CEIL + 54, 252, FLOOR - CEIL - 108, 30, alpha(col.main, 0.07))
    g.rrect(x + 24, CEIL + 54, 252, 10, 5, alpha(col.light, 0.1))
    // A window light that blinks now and then.
    const on = 0.5 + 0.5 * Math.sin(time * 2 + i * 2.3)
    g.circle(x + 150, MIDY, 10, alpha(col.light, 0.12 + 0.18 * on))
  })
  repeatX(dist, 220, v.x0, v.x1, (x) => {
    g.poly(
      [
        x,
        MIDY - 26,
        x + 26,
        MIDY,
        x,
        MIDY + 26,
        x + 12,
        MIDY + 26,
        x + 38,
        MIDY,
        x + 12,
        MIDY - 26,
      ],
      alpha(col.light, 0.1),
    )
  })
  // Floodlight on the runner's stretch of the corridor.
  g.rect(
    v.x0,
    CEIL,
    v.x1 - v.x0,
    FLOOR - CEIL,
    g.rad(RUN_X + 160, MIDY, 0, 560, [
      [0, alpha(col.light, 0.16)],
      [1, alpha(col.light, 0)],
    ]),
  )
}

/** The open spans of one surface in local x, given its gaps. */
function solidSpans(gaps: [number, number][], x0: number, x1: number): [number, number][] {
  const spans: [number, number][] = []
  let x = x0
  for (const [a, b] of gaps) {
    if (a > x) spans.push([x, Math.min(a, x1)])
    x = Math.max(x, b)
  }
  if (x < x1) spans.push([x, x1])
  return spans
}

/** A surface: chunky toy blocks in the owner's colour, a neon edge facing the corridor, open gaps. */
function surface(g: Draw, owner: Side, v: View, dist: number, side: Side, hz: Hazard[]): void {
  const col = SIDE[owner]
  const floor = side === 0
  const edge = floor ? FLOOR : CEIL
  const top = floor ? FLOOR : CEIL - SLAB
  const out = floor ? 1 : -1
  const gaps = hz
    .filter((h) => h.kind === 'gap')
    .map((h): [number, number] => [h.x - dist, h.x + h.w - dist])
    .sort((a, b) => a[0] - b[0])
  for (const [a, b] of gaps) {
    // The gap: the void glows in warning stripes falling away from the corridor.
    const far = floor ? v.y1 : v.y0
    g.rect(
      a,
      Math.min(edge, far),
      b - a,
      Math.abs(far - edge),
      g.lin(0, edge, 0, edge + out * 220, [
        [0, alpha(col.main, 0.32)],
        [1, alpha(col.main, 0)],
      ]),
    )
    for (let k = 0; k < 3; k++) {
      const y = edge + out * (34 + k * 46)
      const w = (b - a) * (0.5 - k * 0.1)
      g.alpha(0.5 - k * 0.14, () =>
        g.poly(
          [(a + b) / 2 - w / 2, y, (a + b) / 2 + w / 2, y, (a + b) / 2, y + out * 26],
          col.light,
        ),
      )
    }
  }
  const face = g.lin(0, top, 0, top + SLAB, [
    [0, floor ? shade(col.main, 0.1) : shade(col.dark, -0.45)],
    [floor ? 0.2 : 0.8, col.main],
    [1, floor ? shade(col.dark, -0.45) : shade(col.main, 0.1)],
  ])
  for (const [a, b] of solidSpans(gaps, v.x0 - 30, v.x1 + 30)) {
    // A sliver between two gaps cannot hold a runner anyway.
    if (b - a < 40) continue
    // Shadow cast into the void, then the slab with rounded, chunky ends.
    g.rrect(a, top + out * 10, b - a, SLAB, 18, alpha('#000000', 0.35))
    g.rrect(a, top, b - a, SLAB, 18, face)
    g.clip(a, top, b - a, SLAB, 18, () => {
      repeatX(dist, BLOCK, a - BLOCK, b + BLOCK, (x) => {
        g.rect(x, top, 4, SLAB, alpha(C.ink, 0.35))
        g.rect(x + 4, top, 3, SLAB, alpha('#ffffff', 0.12))
        g.circle(x + 26, top + SLAB / 2 + out * 8, 5, alpha(C.ink, 0.3))
        g.circle(x + BLOCK - 22, top + SLAB / 2 + out * 8, 5, alpha(C.ink, 0.3))
      })
      // Gloss along the length.
      g.rect(a, floor ? top + 12 : top + SLAB - 20, b - a, 8, alpha('#ffffff', 0.16))
    })
    // Neon edge facing the corridor, with a glow spilling in.
    g.rect(
      a + 10,
      floor ? edge - 30 : edge,
      b - a - 20,
      30,
      g.lin(0, edge, 0, edge - out * 30, [
        [0, alpha(col.light, 0.32)],
        [1, alpha(col.light, 0)],
      ]),
    )
    g.rrect(a + 4, floor ? edge - 3 : edge - 5, b - a - 8, 8, 4, col.light)
    g.rrect(a + 4, floor ? edge - 3 : edge - 5, b - a - 8, 3, 2, alpha('#ffffff', 0.7))
  }
}

/** Spike rows: polished steel teeth on a dark plate. */
function spikes(g: Draw, dist: number, hz: Hazard[]): void {
  for (const h of hz) {
    if (h.kind !== 'spike') continue
    const floor = h.side === 0
    const base = floor ? FLOOR : CEIL
    const tip = floor ? FLOOR - SPIKE_H : CEIL + SPIKE_H
    const x0 = h.x - dist
    // A faint glow behind the row.
    g.ellipse(x0 + h.w / 2, base, h.w / 2 + 30, SPIKE_H + 10, alpha('#ffffff', 0.07))
    const n = Math.round(h.w / SPIKE_W)
    for (let j = 0; j < n; j++) {
      const sx = x0 + SPIKE_W / 2 + j * SPIKE_W
      const l = sx - SPIKE_W / 2 + 1
      const r = sx + SPIKE_W / 2 - 1
      g.poly([l, base, sx, tip, r, base], alpha(C.ink, 0.9), alpha(C.ink, 0.9), 6)
      g.poly(
        [l + 3, base, sx, tip + (floor ? 5 : -5), r - 3, base],
        g.lin(l, 0, r, 0, [
          [0, '#ffffff'],
          [0.48, '#e4e0f2'],
          [0.52, '#a79fc6'],
          [1, '#6f6893'],
        ]),
      )
      g.circle(sx, tip + (floor ? 9 : -9), 3, alpha('#ffffff', 0.9))
    }
    const plateY = floor ? base - 4 : base - 8
    g.rrect(x0 - 4, plateY, h.w + 8, 12, 6, shade(C.ink3, -0.2))
  }
}

function runner(g: Draw, owner: Side, r: Runner, o: LaneView): void {
  const col = SIDE[owner]
  const time = o.time
  const grounded = r.alive && r.grounded
  const ry = o.y
  const rd = o.dist
  // Landing squash, deeper after a long fall, with a small rebound wobble.
  const sl = time - r.landAt
  const lk = 0.12 + 0.2 * Math.min(1, r.landV / 1700)
  const squash =
    grounded && sl < 0.34
      ? sl < 0.12
        ? Math.sin((sl / 0.12) * Math.PI * 0.5) * lk
        : Math.cos(((sl - 0.12) / 0.22) * Math.PI) * lk * 0.5 * (1 - (sl - 0.12) / 0.22)
      : 0
  const stretch = r.alive && !r.grounded ? Math.min(0.16, Math.abs(r.vy) / 6000) : 0
  const angle = r.alive
    ? runnerAngle(r, time)
    : runnerAngle(r, r.deadAt) + (time - r.deadAt) * 9 * r.g
  const surfaceY = r.g > 0 ? FLOOR : CEIL
  const running = grounded && o.phase === 'fly'
  // Ghost trail while flipping: where it was a few frames ago.
  if (r.alive && !r.grounded) {
    for (let k = 4; k >= 1; k--) {
      const y = ry - r.vy * k * 0.022
      g.alpha(0.32 - k * 0.06, () => g.circle(RUN_X - k * 20, y, RUN_R * (1 - k * 0.1), col.main))
    }
  }
  // Speed streaks while running.
  if (running) {
    for (let k = 0; k < 3; k++) {
      const len = 50 + ((rd * 0.7 + k * 37) % 60)
      const y = ry + (k - 1) * 18
      g.line(RUN_X - 52 - len, y, RUN_X - 52, y, alpha(col.light, 0.32), 5)
    }
  }
  // Contact glow on the surface it stands on.
  if (grounded) {
    g.ellipse(RUN_X, surfaceY, RUN_R * 1.3, 10, alpha(col.light, 0.4))
  }
  // A shock ring on each flip.
  const sf = time - r.flipAt
  if (r.alive && sf < 0.35) {
    g.alpha(1 - sf / 0.35, () => g.ring(RUN_X, ry, RUN_R + 10 + sf * 160, col.light, 6))
  }
  const bob = running ? Math.abs(Math.sin(rd * 0.05)) * 6 : 0
  const step = running ? Math.sin(rd * 0.05) : 0
  // Waiting to start: a little idle breathing.
  const idle = o.phase === 'wait' && r.alive ? Math.sin(time * 5) * 0.04 : 0
  const mood = !r.alive ? 'dizzy' : !r.grounded ? 'wow' : o.roundWinner === owner ? 'grin' : 'happy'
  g.at(RUN_X, ry, angle, () => {
    g.at(0, -bob, 0, () => {
      // Two chunky boots, stepping.
      for (const k of [-1, 1]) {
        const lift = running ? Math.max(0, step * k) * 10 : 0
        g.rrect(k * 18 - 15 + step * k * 6, RUN_R * 0.72 - lift, 30, 18, 9, shade(col.dark, -0.35))
        g.rrect(k * 18 - 12 + step * k * 6, RUN_R * 0.72 - lift, 24, 6, 3, alpha('#ffffff', 0.25))
      }
      g.blob(0, 0, RUN_R, col.main, {
        mood,
        look: [0.85, 0.1],
        sx: 1 + squash - stretch * 0.5 - idle,
        sy: 1 - squash + stretch + idle,
        eyes: 1.05,
        outline: true,
      })
      // A little antenna that lags behind the motion.
      const sway = r.alive ? -0.4 - Math.min(0.5, Math.abs(r.vy) / 2400) : 0.8
      g.at(0, -RUN_R * 0.92, sway, () => {
        g.line(0, 0, 0, -26, shade(col.dark, -0.3), 5)
        g.ball(0, -30, 9, C.white, 1)
      })
    })
  })
}

/** A crown floats over the round's winner. */
function crown(g: Draw, r: Runner, ry: number, t: number): void {
  const up = r.g > 0 ? -1 : 1
  const s = outBack(prog(t, 0, 0.35))
  const y = ry + up * (RUN_R + 74 + Math.sin(t * 5) * 8)
  g.emoji('👑', RUN_X, y, 62 * s, r.g > 0 ? 0 : Math.PI)
}

/** A hint during the wait: the runner's path up to the ceiling, with a finger. */
function flipHint(g: Draw, t: number): void {
  const k = (t * 1.2) % 1
  g.dashed(
    RUN_X,
    LAND_HI - RUN_R - 10,
    RUN_X,
    LAND_LO + RUN_R + 10,
    alpha(C.white, 0.35),
    6,
    [14, 14],
  )
  const y = LAND_HI - (LAND_HI - LAND_LO) * outCubic(k)
  g.alpha(1 - k, () => g.circle(RUN_X, y, 14, alpha(C.white, 0.6)))
  g.poly(
    [
      RUN_X - 22,
      LAND_LO + RUN_R + 34,
      RUN_X,
      LAND_LO + RUN_R + 8,
      RUN_X + 22,
      LAND_LO + RUN_R + 34,
    ],
    alpha(C.white, 0.6),
  )
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const r = o.runner
  const dist = o.dist
  background(g, side, v, dist, o.time)
  const lo = dist + v.x0 - 40
  const hi = dist + v.x1 + 40
  const floor = hazardsOn(o.seed, 0, lo, hi)
  const ceil = hazardsOn(o.seed, 1, lo, hi)
  surface(g, side, v, dist, 0, floor)
  surface(g, side, v, dist, 1, ceil)
  spikes(g, dist, [...floor, ...ceil])
  runner(g, side, r, o)

  const won = o.phase === 'end' && o.roundWinner === side
  if (won) crown(g, r, o.y, o.since)

  counterPill(g, side, r.seen, o.bot ? 'Computer' : o.name, LANE_W / 2 - 60, 70, o.time - r.scoreAt)
  winPips(g, side, o.wins, o.target, LANE_W - 200, 66, won ? o.since : 9)

  const cx = LANE_W / 2 + 90
  const cy = LANE_H * 0.5
  if (o.phase === 'wait') {
    // Online, each phone only coaches its own player: the rival's lane just says Ready.
    const coach = !o.bot && (g.viewer === null || g.viewer === side)
    if (coach && o.round === 1) flipHint(g, o.time)
    const label = o.round > 1 ? `Round ${o.round}` : coach ? 'Tap to flip!' : 'Ready…'
    laneCard(g, label, cx, cy, {
      t: o.since,
      sub:
        o.round > 1
          ? o.bot
            ? ''
            : `${o.wins} – ${o.rivalWins}`
          : coach
            ? 'Land, then tap to switch'
            : '',
      accent: SIDE[side].main,
    })
    if (coach) g.emoji('👆', RUN_X + 120, LAND_HI - 30 + Math.sin(o.time * 8) * 14, 84)
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
            : 'Wiped out!'
    const col = w === 'draw' ? C.white : w === side ? C.yellow : SIDE[side].light
    laneCard(g, text, cx, cy, {
      t: o.since - 0.15,
      sub: `${o.wins} – ${o.rivalWins}`,
      color: col,
      accent: w === side ? C.yellow : SIDE[side].main,
      emoji: w === side ? (done ? '🏆' : '⭐') : w === 'draw' ? '🤝' : '💫',
      big: done,
    })
  }
}
