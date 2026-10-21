import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { laneHud, LANE_H, LANE_W, repeatX } from '../../engines/runner/index.ts'
import { BIRD_R, BIRD_X, type Bird, GROUND, pipe, PIPE_W, SPACING, FIRST } from './rules.ts'

export interface LaneView {
  bird: Bird
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

function drawBird(g: Draw, side: Side, b: Bird, time: number, phase: LaneView['phase']): void {
  const col = SIDE[side].main
  const dead = !b.alive
  const angle = dead
    ? Math.min(Math.PI * 0.6, (time - b.deadAt) * 4)
    : Math.max(-0.45, Math.min(1.1, b.vy / 1100))
  const sinceFlap = time - b.flapAt
  // Squash & stretch on each flap.
  const sq = sinceFlap < 0.18 ? 1 + 0.18 * Math.sin((sinceFlap / 0.18) * Math.PI) : 1
  const r = BIRD_R * 1.28
  // Ground shadow, smaller the higher it flies.
  const hgt = Math.max(0, GROUND - b.y)
  g.shadow(BIRD_X, GROUND + 8, r * Math.max(0.3, 1 - hgt / 900), 9, 0.25)
  g.at(BIRD_X, b.y, angle, () => {
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

/**
 * Round pips beside the counter. The lane's outer-left corner near the midline is the pause button's.
 * Long matches shrink the pips and anchor the row to the lane's right edge, so they stay on screen.
 */
function winPips(g: Draw, side: Side, wins: number, target: number): void {
  const long = target > 4
  const r = long ? 11 : 19
  const gap = long ? 30 : 52
  const x0 = long ? LANE_W - 50 - (target - 1) * gap : LANE_W - 230
  // A dark plate behind the row, so the pips read over the pipes.
  const pad = 16
  const span = (target - 1) * gap
  g.rrect(
    x0 - r - pad,
    70 - r - pad,
    span + 2 * (r + pad),
    2 * (r + pad),
    r + pad,
    alpha(C.ink, 0.5),
  )
  for (let i = 0; i < target; i++) {
    const x = x0 + i * gap
    const on = i < wins
    g.circle(x, 70, r, on ? SIDE[side].main : alpha(C.ink, 0.35))
    if (on) g.circle(x - r * 0.26, 70 - r * 0.26, r * 0.32, alpha('#ffffff', 0.65))
    else g.ring(x, 70, r, alpha('#ffffff', 0.55), 4)
  }
}

function centreCard(g: Draw, text: string, sub: string, y: number, color: string, t: number): void {
  const s = outBack(prog(t, 0, 0.35))
  g.at(
    LANE_W / 2 + 110,
    y,
    0,
    () => {
      const w = Math.max(420, g.measure(text, 76, 700) + 120)
      g.rrect(-w / 2, -82, w, sub ? 176 : 150, 44, alpha(C.ink, 0.82))
      g.text(text, 0, -14, { size: 76, weight: 700, color })
      if (sub) g.text(sub, 0, 58, { size: 36, weight: 600, color: alpha(C.white, 0.8) })
    },
    s,
  )
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const b = o.bird
  const scroll = b.dist
  backdrop(g, side, v, scroll)
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
  drawBird(g, side, b, o.time, o.phase)

  laneHud(g, side, b.pipes, o.bot ? 'Computer' : o.name, LANE_W / 2 - 40, 70)
  winPips(g, side, o.wins, o.target)

  if (o.phase === 'wait') {
    const label = o.round > 1 ? `Round ${o.round}` : o.bot ? 'Ready…' : 'Tap to flap!'
    centreCard(
      g,
      label,
      o.bot ? '' : o.round > 1 ? 'Tap to flap!' : 'Tap your half',
      LANE_H * 0.47,
      C.white,
      o.since,
    )
    if (!o.bot) g.emoji('👆', BIRD_X, 530 + Math.sin(o.time * 8) * 16, 84)
  } else if (o.phase === 'end' && !o.matchOver) {
    const w = o.roundWinner
    const text = w === 'draw' ? 'Draw!' : w === side ? 'Round won!' : 'Crashed!'
    const col = w === 'draw' ? C.white : w === side ? C.yellow : SIDE[side].light
    centreCard(g, text, `${o.wins} – ${o.rivalWins}`, LANE_H * 0.45, col, o.since)
  }
}
