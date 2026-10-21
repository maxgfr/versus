import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { drawPaddle, drawPuck, drawRink, rinkScore, type Disc } from '../../engines/puck/index.ts'
import { RINK, TARGET, type World } from './rules.ts'

export interface Look {
  /** Interpolated positions for this frame. */
  puck: Disc
  mallets: Disc[]
  trail: { x: number; y: number }[]
  squash: number[]
  pulse: [number, number]
  /** 0..1 fade-in of a freshly served puck. */
  serve: number
}

export function render(g: Draw, w: World, look: Look): void {
  drawRink(g, RINK)
  // Match point glow on the side that is one goal away.
  for (const side of [0, 1] as Side[]) {
    if (w.score[side] === TARGET - 1) {
      const y = side === 0 ? RINK.y1 : RINK.y0
      g.alpha(0.25 + 0.15 * Math.sin(g.t * 5), () =>
        g.ellipse(W / 2, y, RINK.goal * 0.75, 120, alpha(SIDE[side === 0 ? 1 : 0].main, 0.6)),
      )
    }
  }
  rinkScore(g, 0, w.score[0], RINK, look.pulse[0])
  rinkScore(g, 1, w.score[1], RINK, look.pulse[1])
  if (w.phase === 'play') {
    g.alpha(look.serve, () => drawPuck(g, look.puck, look.trail, C.yellow))
    if (look.serve < 1)
      g.ring(
        look.puck.x,
        look.puck.y,
        look.puck.r * (2.4 - look.serve * 1.3),
        alpha(C.yellow, 1 - look.serve),
        6,
      )
  }
  w.mallets.forEach((m, i) => {
    const p = look.mallets[i] ?? m
    drawPaddle(g, p, m.side, look.squash[i] ?? 1)
  })
  // A thin centre seam over everything so the split reads even under mallets.
  g.alpha(0.1, () => g.line(RINK.x0, MID, RINK.x1, MID, '#ffffff', 2))
}
