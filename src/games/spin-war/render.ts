import type { Side } from '../../core/game.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { BOWL, TOP_R, type Top, type World } from './rules.ts'

export interface Stick {
  bx: number
  by: number
  kx: number
  ky: number
}

export interface Look {
  names: [string, string]
  /** Rounds needed to win the match. */
  target: number
  sticks: (Stick | null)[]
  end: { at: number; winner: Side } | null
  /** Game time, for the ending banner. */
  time: number
  /** Per top: 0..1 white flash after a clash. */
  flash: number[]
  /** Which sides are people (they get the first-round coaching). */
  human?: [boolean, boolean]
}

const RIM = 46
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The bowl: a concave steel dish in a chunky rim, each half tinted for its owner. */
function drawBowl(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.8)],
      [0.5, C.ink],
      [1, shade(C.red, -0.8)],
    ]),
  )
  // Diamond-plate steel floor round the bowl, each end tinted for its player.
  const v = g.stage.view
  const step = 64
  for (let row = Math.floor(v.y / step) - 1; row * step < v.y + v.h; row++) {
    const py = row * step
    const tint = py < MID ? SIDE[1].light : SIDE[0].light
    const off = row % 2 ? step / 2 : 0
    for (let px = Math.floor(v.x / step) * step - step + off; px < v.x + v.w; px += step) {
      const a = (row + Math.round(px / step)) % 2 ? 0.6 : -0.6
      g.at(px, py, a, () => {
        g.rrect(-16, -4, 32, 8, 4, alpha('#000000', 0.22))
        g.rrect(-16, -5, 32, 6, 3, alpha(tint, 0.06))
      })
    }
  }
  // Floodlight on the table under the bowl.
  g.fillView(
    g.rad(W / 2, MID, BOWL.r * 0.6, BOWL.r * 1.9, [
      [0, alpha('#ffffff', 0.07)],
      [1, alpha('#ffffff', 0)],
    ]),
  )
  const { x, y, r } = BOWL
  g.shadow(x, y + r + 40, r * 1.05, 70, 0.5)
  // Rim: dark lip below, metal ring, bright top edge.
  g.circle(x, y + 16, r + RIM, shade(C.ink4, -0.5))
  g.circle(
    x,
    y,
    r + RIM,
    g.lin(0, y - r - RIM, 0, y + r + RIM, [
      [0, '#c9cfe6'],
      [0.5, '#7d84a6'],
      [1, '#4a4f6e'],
    ]),
  )
  g.ring(x, y, r + RIM - 6, alpha('#ffffff', 0.25), 4)
  // Rim bolts.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    g.circle(
      x + Math.cos(a) * (r + RIM / 2),
      y + Math.sin(a) * (r + RIM / 2),
      6,
      alpha(C.ink, 0.45),
    )
  }
  // Dish: lit centre, darker toward the wall.
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 0, r, [
      [0, shade(C.cyan, -0.38)],
      [0.45, shade(C.ink4, -0.05)],
      [0.85, shade(C.ink3, -0.25)],
      [1, shade(C.ink, -0.3)],
    ]),
  )
  g.clip(x - r, y - r, r * 2, r * 2, r, () => {
    // Concave shading: the far (top) wall is in the rim's shadow, the near wall catches light.
    g.rect(
      x - r,
      y - r,
      r * 2,
      r * 2,
      g.lin(0, y - r, 0, y + r, [
        [0, alpha('#000000', 0.35)],
        [0.35, alpha('#000000', 0)],
        [0.8, alpha('#ffffff', 0)],
        [1, alpha('#ffffff', 0.1)],
      ]),
    )
    // Team tint on each half of the dish.
    g.rect(x - r, y - r, r * 2, r, alpha(SIDE[1].main, 0.08))
    g.rect(x - r, y, r * 2, r, alpha(SIDE[0].main, 0.08))
  })
  // Machined grooves.
  for (let rr = 80; rr < r; rr += 72) g.ring(x, y, rr, alpha('#ffffff', 0.05), 3)
  // The danger band near the edge.
  g.ring(x, y, r - 8, alpha(C.orange, 0.22), 6)
  g.circle(x, y, 10, alpha('#ffffff', 0.25))
}

/** A spinning top seen from above: toothed attack ring, inner disc with blades, a cap. */
function drawTop(g: Draw, top: Top, flash: number, now: number): void {
  const col = SIDE[top.side].main
  const light = SIDE[top.side].light
  const s = top.out ? 0.85 : 1
  const r = TOP_R * s
  // Low spin wobbles: the body precesses around its tip.
  const wob = top.out ? 0 : (1 - top.spin) ** 2 * 14
  const wx = top.x + Math.cos(top.ang * 0.35) * wob
  const wy = top.y + Math.sin(top.ang * 0.35) * wob
  const tipped = top.out
  g.shadow(top.x + 8, top.y + 16, r * 1.0, r * 0.75, 0.45)
  g.at(
    wx,
    wy,
    0,
    () => {
      // Speed blur halo while spinning fast.
      if (!tipped && top.spin > 0.4)
        g.alpha((top.spin - 0.4) * 0.8, () => g.circle(0, 0, r * 1.08, alpha(light, 0.25)))
      // Attack ring: 6 teeth.
      g.at(0, 0, top.ang, () => {
        const pts: number[] = []
        const n = 6
        for (let i = 0; i < n * 4; i++) {
          const a = (i / (n * 4)) * Math.PI * 2
          const k = i % 4
          const rr = k === 0 || k === 1 ? r : r * 0.84
          pts.push(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        const lip = pts.map((v, i) => (i % 2 ? v + r * 0.12 : v))
        g.poly(lip, shade(col, -0.5))
        g.poly(
          pts,
          g.rad(0, 0, r * 0.2, r, [
            [0, shade(col, 0.35)],
            [0.7, col],
            [1, shade(col, -0.25)],
          ]),
          shade(col, -0.45),
          4,
        )
      })
      // Inner disc with blades; at speed the blades blur into rings.
      g.circle(0, 0, r * 0.66, shade(col, -0.3))
      const blur = !tipped && top.spin > 0.3 ? 3 : 1
      for (let b = 0; b < blur; b++) {
        g.alpha(1 / blur + (b === 0 ? 0.2 : 0), () =>
          g.at(0, 0, -top.ang * 1.0 - b * 0.18, () => {
            for (let k = 0; k < 3; k++) {
              g.at(0, 0, (k * Math.PI * 2) / 3, () =>
                g.path(
                  (p) => {
                    p.moveTo(0, -r * 0.18)
                    p.quadraticCurveTo(r * 0.36, -r * 0.3, r * 0.2, -r * 0.62)
                    p.quadraticCurveTo(r * 0.04, -r * 0.4, 0, -r * 0.18)
                  },
                  alpha(light, 0.9),
                ),
              )
            }
          }),
        )
      }
      g.ring(0, 0, r * 0.66, alpha('#000000', 0.25), 4)
      // Cap and side mark.
      g.ball(0, 0, r * 0.26, C.cream, 0.9)
      g.sideMark(top.side, 0, 0, r * 0.11, col)
      if (flash > 0) g.alpha(flash * 0.8, () => g.circle(0, 0, r * 1.02, C.white))
    },
    1,
    tipped ? 0.62 : 1,
  )
  if (tipped) {
    // Dizzy stars over a stopped top.
    for (let i = 0; i < 3; i++) {
      const a = now * 3 + (i * Math.PI * 2) / 3
      g.star(top.x + Math.cos(a) * r * 0.9, top.y - r * 0.2 + Math.sin(a) * r * 0.3, 14, C.yellow)
    }
    return
  }
  // Spin gauge ring: what is left, blinking when nearly spent.
  const low = top.spin < 0.25
  const gc = low ? (Math.sin(now * 14) > 0 ? C.orange : C.white) : light
  g.arc(wx, wy, r + 16, 0, Math.PI * 2, alpha(C.ink, 0.5), 11)
  if (top.spin > 0)
    g.arc(wx, wy, r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * top.spin, gc, 9)
}

function drawStick(g: Draw, side: Side, s: Stick | null): void {
  if (!s) return
  const col = SIDE[side]
  g.alpha(0.5, () => {
    g.circle(s.bx, s.by, 110, alpha(col.dark, 0.3), alpha(col.light, 0.5), 5)
    g.ball(s.kx, s.ky, 50, col.main, 0.6)
  })
}

export function render(g: Draw, w: World, look: Look): void {
  drawBowl(g)
  w.tops.forEach((t, i) => {
    if (t.side === 0 || t.side === 1) drawStick(g, t.side, look.sticks[i] ?? null)
  })
  // Knocked-out tops under the live ones.
  w.tops.forEach((t, i) => {
    if (t.out) drawTop(g, t, look.flash[i] ?? 0, look.time)
  })
  w.tops.forEach((t, i) => {
    if (!t.out) drawTop(g, t, look.flash[i] ?? 0, look.time)
  })
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, look.names[side], {
      x: W / 2,
      active: w.phase === 'over' && w.result === side,
    })
    pips(g, side, w.wins[side], look.target)
  }
  // First-round coaching for each person, in the floor space at their end.
  if (look.human && w.round === 1 && w.phase === 'play' && w.t < 5) {
    const a = clamp01((5 - w.t) / 0.5)
    for (const side of [0, 1] as Side[]) {
      if (!look.human[side]) continue
      g.alpha(a, () =>
        g.forSide(
          side,
          W / 2,
          side === 0 ? MID + BOWL.r + RIM + 150 : MID - BOWL.r - RIM - 150,
          () => {
            g.text('Drag in your half to steer', 0, -24, {
              size: 40,
              weight: 700,
              color: C.white,
              drop: alpha('#000000', 0.45),
            })
            g.text('Knock the other top out!', 0, 30, {
              size: 34,
              weight: 600,
              color: alpha(C.white, 0.75),
            })
          },
        ),
      )
    }
  }
  // Round call at the start of each round.
  if (w.phase === 'play' && w.t < 1.3) {
    const k = w.t < 1 ? 1 : 1 - (w.t - 1) / 0.3
    banner(g, undefined, w.t < 0.8 ? `ROUND ${w.round}` : 'SPIN!', MID, {
      alpha: k,
      color: w.t < 0.8 ? C.white : C.yellow,
      gap: 140,
    })
  }
  if (w.phase === 'over') {
    const end = look.end
    if (end) {
      const k = clamp01((look.time - end.at) / 0.35)
      banner(g, end.winner, 'SPIN CHAMPION!', end.winner === 0 ? MID + 330 : MID - 330, {
        alpha: k,
        size: 60 + (1 - k) * 30,
        color: C.yellow,
      })
    } else if (w.result === 'draw' || w.result === null) banner(g, undefined, 'DRAW', MID)
    else
      banner(g, w.result, 'ROUND WON!', w.result === 0 ? MID + 330 : MID - 330, {
        color: SIDE[w.result].light,
      })
  }
}
