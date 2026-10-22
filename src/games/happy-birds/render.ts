import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { LANE_H, LANE_W, repeatX } from '../../engines/runner/index.ts'
import { counterPill, laneCard, winPips } from './hud.ts'
import { BIRD_R, BIRD_X, type Bird, GROUND, pipe, PIPE_W, SPACING, FIRST } from './rules.ts'

/** The bird's recent path, as a ring buffer of (height, scroll) samples. */
export interface Trail {
  y: Float32Array
  d: Float32Array
  n: number
  head: number
}

export interface LaneView {
  bird: Bird
  /** Interpolated height and scroll for this frame. */
  y: number
  dist: number
  /** Body squash spring (1 at rest, above 1 stretched tall). */
  squash: number
  trail: Trail
  /** Scroll speed (units/s): the faster, the longer the speed streaks. */
  speed: number
  course: number
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
  /** Round wins needed to take the match. */
  target: number
  /** Game time this lane's bird last cleared a pipe (the counter pops). */
  passAt: number
}

type View = { x0: number; y0: number; x1: number; y1: number }

/** Each team flies its own sky: red at sunset, blue at noon. */
const SKY: [readonly [string, string], readonly [string, string]] = [
  ['#ffd08f', '#ff8f86'],
  ['#9fdcff', '#5b9dff'],
]

function backdrop(g: Draw, side: Side, v: View, scroll: number): void {
  const [top, bottom] = SKY[side]
  g.rect(
    v.x0,
    v.y0,
    v.x1 - v.x0,
    GROUND - v.y0,
    g.lin(0, v.y0, 0, GROUND, [
      [0, top],
      [1, bottom],
    ]),
  )
  // Sun: barely moves.
  const sx = 760 - scroll * 0.02
  g.circle(sx, GROUND - 330, 110, alpha('#ffffff', 0.25))
  g.circle(sx, GROUND - 330, 78, side === 0 ? '#fff1b8' : '#fffbe6')
  // Far range.
  const far = shade(SIDE[side].main, side === 0 ? -0.15 : -0.05)
  repeatX(scroll * 0.12, 520, v.x0, v.x1, (x, i) => {
    const h = 170 + ((i * 97) % 5) * 26
    g.poly(
      [x - 60, GROUND, x + 200, GROUND - h, x + 330, GROUND - h + 40, x + 520, GROUND],
      alpha(far, 0.55),
    )
  })
  // Clouds.
  repeatX(scroll * 0.3, 640, v.x0, v.x1, (x, i) => {
    const y = 110 + ((i * 53) % 4) * 60
    g.alpha(0.9, () => {
      g.ellipse(x + 120, y, 90, 40, '#ffffff')
      g.ellipse(x + 190, y - 22, 70, 46, '#ffffff')
      g.ellipse(x + 250, y + 2, 60, 32, '#ffffff')
    })
  })
  // Near hills.
  const near = mix(C.grass, SIDE[side].main, 0.12)
  repeatX(scroll * 0.55, 380, v.x0, v.x1, (x, i) => {
    const r = 120 + ((i * 31) % 3) * 40
    g.circle(x + 190, GROUND + r * 0.45, r, shade(near, -0.18))
  })
}

function drawPipe(g: Draw, x: number, y0: number, y1: number, capAtTop: boolean): void {
  const w = PIPE_W
  const body = g.lin(x, 0, x + w, 0, [
    [0, '#7fe39a'],
    [0.35, C.green],
    [1, '#1f9a57'],
  ])
  g.rect(x, y0, w, y1 - y0, body)
  g.rect(x + 18, y0, 12, y1 - y0, alpha('#ffffff', 0.35))
  const capH = 58
  const cy = capAtTop ? y0 : y1 - capH
  const cx = x - 14
  const cw = w + 28
  g.rrect(cx, cy + 8, cw, capH, 14, '#178049')
  g.rrect(
    cx,
    cy,
    cw,
    capH - 6,
    14,
    g.lin(cx, 0, cx + cw, 0, [
      [0, '#8ff0aa'],
      [0.4, '#4fe08e'],
      [1, '#22a660'],
    ]),
  )
  g.rect(cx + 20, cy + 8, 12, capH - 22, alpha('#ffffff', 0.4))
}

function ground(g: Draw, v: View, scroll: number): void {
  g.rect(v.x0, GROUND, v.x1 - v.x0, v.y1 - GROUND + 4, '#d9a35f')
  // Scrolling stripes sell the speed.
  repeatX(scroll, 70, v.x0, v.x1, (x) => {
    g.poly([x, GROUND + 26, x + 34, GROUND + 26, x + 4, v.y1 + 4, x - 30, v.y1 + 4], '#c98d4a')
  })
  g.rect(v.x0, GROUND, v.x1 - v.x0, 26, C.grass)
  g.rect(v.x0, GROUND + 22, v.x1 - v.x0, 8, C.grassDark)
}

function drawBird(
  g: Draw,
  side: Side,
  b: Bird,
  y: number,
  squash: number,
  time: number,
  phase: LaneView['phase'],
): void {
  const col = SIDE[side].main
  const dead = !b.alive
  const angle = dead
    ? Math.min(Math.PI * 0.6, (time - b.deadAt) * 4)
    : Math.max(-0.45, Math.min(1.1, b.vy / 1100))
  const sinceFlap = time - b.flapAt
  // Squash & stretch: the spring, kicked by flaps, crashes and wins.
  const sq = Math.max(0.6, Math.min(1.5, squash))
  const r = BIRD_R * 1.28
  // Ground shadow, smaller the higher it flies.
  const hgt = Math.max(0, GROUND - y)
  g.shadow(BIRD_X, GROUND + 8, r * Math.max(0.3, 1 - hgt / 900), 9, 0.25)
  g.at(BIRD_X, y, angle, () => {
    // Wing behind the body, flapping fast after a flap and gliding otherwise.
    const beat =
      phase === 'wait' ? Math.sin(time * 14) : sinceFlap < 0.3 ? Math.cos(sinceFlap * 30) : 0.2
    g.ellipse(
      -r * 0.3,
      r * 0.05 - beat * r * 0.45,
      r * 0.72,
      r * 0.36,
      shade(col, -0.3),
      -0.3 - beat * 0.5,
    )
    g.blob(0, 0, r, col, {
      mood: dead ? 'dizzy' : sinceFlap < 0.25 ? 'grin' : 'happy',
      look: [0.9, 0.1],
      sx: 1 / sq,
      sy: sq,
      cheeks: true,
    })
    // Beak pointing forward.
    g.poly([r * 0.72, -r * 0.14, r * 1.42, r * 0.12, r * 0.72, r * 0.38], C.orange)
    g.poly([r * 0.72, r * 0.13, r * 1.34, r * 0.13, r * 0.72, r * 0.38], shade(C.orange, -0.25))
    // Front wing tip over the body.
    g.ellipse(
      -r * 0.12,
      r * 0.38 - beat * r * 0.3,
      r * 0.5,
      r * 0.25,
      shade(col, 0.3),
      -0.2 - beat * 0.4,
    )
  })
}

/** A crown bobs over the round's winner. */
function crown(g: Draw, y: number, t: number): void {
  const k = outBack(prog(t, 0, 0.35))
  if (k <= 0.01) return
  g.emoji('👑', BIRD_X + 6, y - BIRD_R * 2.4 + Math.sin(t * 5) * 8, 62 * k, 0.15)
}

/** A fading dotted wake along the path the bird just flew. */
function wake(g: Draw, side: Side, o: LaneView): void {
  const t = o.trail
  const len = t.y.length
  for (let i = 1; i < t.n; i++) {
    const j = (t.head - 1 - i + len * 2) % len
    const x = BIRD_X - 30 - (o.dist - (t.d[j] ?? 0))
    const k = 1 - i / len
    g.alpha(0.35 * k, () => g.circle(x, t.y[j] ?? 0, 4 + 10 * k, SIDE[side].light))
  }
}

/** Speed streaks past the bird: longer and brighter as the round speeds up. */
function streaks(g: Draw, o: LaneView): void {
  const k = Math.max(0, (o.speed - 330) / 170)
  if (k <= 0.02) return
  repeatX(o.dist * 1.6, 260, 0, LANE_W, (x, i) => {
    const y = 160 + ((i * 137) % 9) * 52
    g.alpha(0.12 + 0.18 * k, () => g.line(x, y, x + 40 + 90 * k, y, '#ffffff', 5))
  })
}

/** Round sockets x: a long match packs them toward the lane's right edge (the hud does the packing). */
const PIPS_X = LANE_W - 200
/** Centre cards sit right of the bird, mid-sky. */
const CARD_X = LANE_W / 2 + 110

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const b = o.bird
  const scroll = o.dist
  backdrop(g, side, v, scroll)
  if (o.phase === 'fly') streaks(g, o)
  // Pipes in view.
  const first = Math.max(0, Math.floor((scroll + v.x0 - FIRST - PIPE_W - 20) / SPACING))
  const last = Math.ceil((scroll + v.x1 - FIRST + 20) / SPACING)
  for (let i = first; i <= last; i++) {
    const p = pipe(o.course, i)
    const x = p.x - scroll
    drawPipe(g, x, v.y0 - 10, p.gapY - p.gapH / 2, false)
    drawPipe(g, x, p.gapY + p.gapH / 2, GROUND + 4, true)
  }
  ground(g, v, scroll)
  wake(g, side, o)
  drawBird(g, side, b, o.y, o.squash, o.time, o.phase)

  const won = o.phase === 'end' && o.roundWinner === side
  if (won) crown(g, o.y, o.since)

  counterPill(g, side, b.pipes, o.bot ? 'Computer' : o.name, LANE_W / 2 - 60, 70, o.time - o.passAt)
  winPips(g, side, o.wins, o.target, PIPS_X, 66, won ? o.since : 9)

  const cy = LANE_H * 0.47
  if (o.phase === 'wait') {
    // Online, each phone only coaches its own player: the rival's lane just says Ready.
    const coach = !o.bot && (g.viewer === null || g.viewer === side)
    const label = o.round > 1 ? `Round ${o.round}` : coach ? 'Tap to flap!' : 'Ready…'
    laneCard(g, label, CARD_X, cy, {
      t: o.since,
      sub: o.round > 1 ? (o.bot ? '' : `${o.wins} – ${o.rivalWins}`) : coach ? 'Tap your half' : '',
      accent: SIDE[side].main,
    })
    if (coach) g.emoji('👆', BIRD_X, 530 + Math.sin(o.time * 8) * 16, 84)
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
    laneCard(g, text, CARD_X, cy, {
      t: o.since - 0.15,
      sub: `${o.wins} – ${o.rivalWins}`,
      color: col,
      accent: w === side ? C.yellow : SIDE[side].main,
      emoji: w === side ? (done ? '🏆' : '⭐') : w === 'draw' ? '🤝' : '💫',
      big: done,
    })
  }
}
