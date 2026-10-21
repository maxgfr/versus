import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import {
  cardGrid,
  drawCard,
  emojiFace,
  faceAngle,
  flipAmount,
  matchPop,
} from '../../engines/cards/index.ts'
import type { State } from './index.ts'
import { COLS, ROWS } from './rules.ts'

export const CARDS = cardGrid(COLS, ROWS, { x: 60, y: 240, w: 880, h: 1320 }, 20, 1.12)

export function renderCards(g: Draw, s: State, now: number): void {
  const t = s.table
  CARDS.forEach((c, i) => {
    const owner = t.owner[i] ?? null
    const flip = flipAmount(now, s.flippedAt[i] ?? -10, !!t.faceUp[i])
    const glyph = s.glyphs[t.deck[i] ?? 0] ?? '❓'
    const pop = owner === null ? 1 : matchPop(now, s.matchedAt[i] ?? -10)
    const picked = t.up.includes(i)
    g.at(
      c.x,
      c.y,
      0,
      () =>
        drawCard(g, 0, 0, c.w, c.h, {
          flip,
          face: emojiFace(g, glyph, faceAngle(g, c.y)),
          faceColor: owner === null ? C.cream : shade(SIDE[owner].main, 0.55),
          ...(owner !== null
            ? { ring: SIDE[owner].main }
            : picked && flip > 0.5
              ? { ring: C.yellow }
              : {}),
          lift: picked ? 0.35 : 0,
        }),
      pop,
    )
    if (owner !== null) {
      // Owner mark in the corner: circle for red, square for blue (never colour alone).
      g.sideMark(owner, c.x + c.w / 2 - 22, c.y - c.h / 2 + 22, 11, SIDE[owner].main)
    }
  })
}

/** Soft spotlight on the table centre. */
export function backdropGlow(g: Draw): void {
  g.alpha(0.6, () =>
    g.fillView(
      g.rad(500, 900, 80, 900, [
        [0, alpha('#ffffff', 0.06)],
        [1, alpha('#000000', 0)],
      ]),
    ),
  )
}
