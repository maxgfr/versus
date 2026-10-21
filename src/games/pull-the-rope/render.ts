import { other, type Side } from '../../core/game.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { mashPulse } from '../../engines/reflex/index.ts'
import type { State } from './index.ts'

/** World distance from the centre to each team's line. */
export const LINE = 330
const ROPE_X = W / 2
const ROPE = '#dca36a'
const ROPE_DARK = '#7a4b22'

export const knotY = (pos: number): number => MID + pos * LINE

/** Where each team member stands, nearest the knot first. Teams slide with the rope. */
export function teamLayout(side: Side, pos: number): { x: number; y: number }[] {
  const dir = side === 0 ? 1 : -1
  const ky = knotY(pos)
  return [170, 270, 370].map((off, i) => ({
    x: ROPE_X + (i % 2 === 0 ? -86 : 86),
    y: ky + dir * off,
  }))
}

function field(g: Draw): void {
  // A floodlit pitch at night: dark mowed bands, each end owned by its team.
  const v = g.stage.view
  g.fillView(shade(C.grassDark, -0.6))
  const band = 120
  for (let y = Math.floor(v.y / band) * band; y < v.y + v.h; y += band * 2) {
    g.rect(v.x - 2, y, v.w + 4, band, alpha(shade(C.grass, -0.45), 0.5))
  }
  for (const side of [0, 1] as Side[]) {
    const y = knotY(side === 0 ? 1 : -1)
    const y0 = side === 0 ? y : v.y - 2
    const y1 = side === 0 ? v.y + v.h + 2 : y
    g.rect(
      v.x - 2,
      y0,
      v.w + 4,
      y1 - y0,
      g.lin(0, y, 0, side === 0 ? y1 : y0, [
        [0, alpha(SIDE[side].dark, 0.28)],
        [1, alpha(SIDE[side].dark, 0.6)],
      ]),
    )
  }
  g.fillView(
    g.rad(W / 2, MID, 80, 760, [
      [0, alpha('#fff4d8', 0.16)],
      [1, alpha('#fff4d8', 0)],
    ]),
  )
  g.vignette(0.4)
}

function mud(g: Draw, splash: number): void {
  const k = 1 + splash * 0.06
  g.ellipse(W / 2, MID + 10, 360 * k, 120 * k, alpha('#000000', 0.18))
  g.ellipse(W / 2, MID, 350 * k, 112 * k, '#7a5230')
  g.ellipse(W / 2, MID - 6, 300 * k, 86 * k, '#5e3d22')
  for (const [dx, dy, r] of [
    [-190, -20, 26],
    [150, 30, 18],
    [60, -40, 14],
    [-60, 44, 12],
    [230, -24, 10],
  ] as const) {
    g.ellipse(W / 2 + dx * k, MID + dy, r * 1.6, r, alpha('#a07040', 0.6))
  }
}

function teamLine(g: Draw, side: Side): void {
  const y = knotY(side === 0 ? 1 : -1)
  const col = SIDE[side].main
  const v = g.stage.view
  g.rect(v.x, y - 9, v.w, 18, alpha('#ffffff', 0.85))
  g.rect(v.x, y - 5, v.w, 10, col)
}

function rope(g: Draw, pos: number, wobble: number, now: number): void {
  const v = g.stage.view
  const top = v.y - 40
  const bot = v.y + v.h + 40
  const len = bot - top
  const pts: number[] = []
  for (let y = top; y <= bot; y += 22) {
    const env = Math.sin((Math.PI * (y - top)) / len)
    const x = ROPE_X + Math.sin(y * 0.03 - now * 24) * wobble * 16 * env
    pts.push(x, y)
  }
  const stroke = (col: string, lw: number, dy = 0) => {
    g.path(
      (c) => {
        c.moveTo(pts[0] ?? 0, (pts[1] ?? 0) + dy)
        for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] ?? 0, (pts[i + 1] ?? 0) + dy)
      },
      undefined,
      col,
      lw,
    )
  }
  stroke(alpha('#000000', 0.25), 30, 12)
  stroke(ROPE_DARK, 30)
  stroke(ROPE, 21)
  // Braid ticks travel with the rope.
  const off = (((pos * LINE) % 30) + 30) % 30
  for (let y = top + off; y < bot; y += 30) {
    const env = Math.sin((Math.PI * (y - top)) / len)
    const x = ROPE_X + Math.sin(y * 0.03 - now * 24) * wobble * 16 * env
    g.line(x - 9, y - 6, x + 9, y + 6, alpha(ROPE_DARK, 0.7), 4)
  }
}

function knot(g: Draw, pos: number, now: number, wobble: number): void {
  const y = knotY(pos)
  const flap = Math.sin(now * 9) * 10 * (0.4 + wobble)
  g.poly([ROPE_X, y - 14, ROPE_X - 120, y - 40 + flap, ROPE_X - 104, y + 4 + flap * 0.4], C.yellow)
  g.poly([ROPE_X, y - 14, ROPE_X + 120, y - 40 - flap, ROPE_X + 104, y + 4 - flap * 0.4], C.yellow)
  g.poly(
    [ROPE_X, y + 2, ROPE_X - 70, y + 30 + flap * 0.5, ROPE_X - 60, y + 6],
    shade(C.yellow, -0.2),
  )
  g.poly(
    [ROPE_X, y + 2, ROPE_X + 70, y + 30 - flap * 0.5, ROPE_X + 60, y + 6],
    shade(C.yellow, -0.2),
  )
  g.ball(ROPE_X, y, 26, '#a8692f')
}

function team(g: Draw, s: State, side: Side, now: number): void {
  const col = SIDE[side].main
  const r = s.rounds
  const strain = Math.min(1, s.mash[side].rate / 8)
  let mood: Mood = strain > 0.25 ? 'angry' : 'happy'
  if (r.phase === 'between')
    mood = r.last === side ? 'grin' : r.last === other(side) ? 'dizzy' : 'wow'
  const angle = g.orient(side)
  const members = teamLayout(side, s.rope.pos)
  // Draw the far ones first so nearer heads overlap them.
  for (let i = members.length - 1; i >= 0; i--) {
    const m = members[i] as { x: number; y: number }
    const delay = i * 0.05
    const p = mashPulse(s.mash[side], now - delay)
    const rad = 64 - i * 3
    const hx = ROPE_X + (m.x < ROPE_X ? -16 : 16)
    g.shadow(m.x, m.y + rad * 0.85, rad * 0.9, rad * 0.3)
    // Arms to the rope.
    g.line(m.x, m.y, hx, m.y - (side === 0 ? 1 : -1) * 6, shade(col, -0.25), 18)
    g.blob(m.x, m.y, rad, col, {
      mood,
      angle,
      sx: 1 + p * 0.14 + strain * 0.04,
      sy: 1 - p * 0.14,
      look: [m.x < ROPE_X ? 0.7 : -0.7, 0],
    })
    g.ball(hx, m.y - (side === 0 ? 1 : -1) * 6, 15, shade(col, 0.15), 0.6)
  }
}

export function renderRope(
  g: Draw,
  s: State,
  now: number,
  o: { teams: boolean; names: [string, string]; over: boolean },
): void {
  field(g)
  // Each half glows with its team's tapping.
  for (const side of [0, 1] as Side[]) {
    const p = mashPulse(s.mash[side], now, 0.18)
    if (p <= 0) continue
    const v = g.stage.view
    const y0 = side === 0 ? MID : v.y
    const y1 = side === 0 ? v.y + v.h : MID
    g.alpha(p * 0.18, () => g.rect(v.x - 2, y0, v.w + 4, y1 - y0, SIDE[side].main))
  }
  const splash = s.rounds.phase === 'between' ? Math.max(0, 1 - (now - s.rounds.at) * 2) : 0
  mud(g, splash)
  teamLine(g, 0)
  teamLine(g, 1)
  rope(g, s.rope.pos, s.wobble, now)
  team(g, s, 1, now)
  team(g, s, 0, now)
  knot(g, s.rope.pos, now, s.wobble)

  // "TAP!" hints at the start of each round.
  const since = now - s.rounds.at
  const hint = s.rounds.phase === 'play' ? 1 - Math.max(0, (since - 1.4) / 0.6) : 0
  if (hint > 0) {
    for (const side of [0, 1] as Side[]) {
      const y = side === 0 ? g.stage.edge(0) - 260 : g.stage.edge(1) + 260
      const xs = o.teams ? [W / 2 - 330, W / 2 + 330] : [W / 2 + 300]
      for (const x of xs) {
        g.alpha(hint, () =>
          g.sideText(side, 'TAP!', x, y, {
            size: 84 + Math.sin(now * 10) * 5,
            weight: 700,
            color: C.white,
            stroke: SIDE[side].dark,
            strokeWidth: 16,
          }),
        )
      }
    }
  }

  for (const side of [0, 1] as Side[])
    namePill(g, side, o.names[side], { x: 300, active: mashPulse(s.mash[side], now, 0.2) > 0 })
  rounds(g, s, now, o.over)
}

/**
 * Round pips at each edge, then the round banners. The pips sit on the right so
 * they never sit under the name pills, and a long row grows leftwards so it
 * stays on screen.
 */
function rounds(g: Draw, s: State, now: number, over: boolean): void {
  const r = s.rounds
  const x = Math.min(W - 150, W - 40 - ((r.target - 1) * 46) / 2 - 15)
  for (const side of [0, 1] as Side[]) pips(g, side, r.wins[side], r.target, { x, inset: 70 })
  if (over) return
  if (r.phase === 'between' && r.text) {
    banner(g, undefined, r.text, MID, { size: 56, alpha: Math.min(1, (now - r.at) * 4) })
  } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
    const a = 1 - Math.max(0, (now - r.at - 0.7) / 0.4)
    banner(g, undefined, `Round ${r.round}`, MID, { size: 64, alpha: a })
  }
}
