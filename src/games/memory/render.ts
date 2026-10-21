import type { Side } from '../../core/game.ts'
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

/** The grid keeps clear of the pause button (left edge, mid-height: world x < 110). */
export const CARDS = cardGrid(COLS, ROWS, { x: 130, y: 240, w: 740, h: 1320 }, 20, 1.12)

/** The felt tray under the cards: hugs the grid with a lip. */
const TRAY = (() => {
  const pad = 26
  const x0 = Math.min(...CARDS.map((c) => c.x - c.w / 2)) - pad
  const x1 = Math.max(...CARDS.map((c) => c.x + c.w / 2)) + pad
  const y0 = Math.min(...CARDS.map((c) => c.y - c.h / 2)) - pad
  const y1 = Math.max(...CARDS.map((c) => c.y + c.h / 2)) + pad + 10
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: 44 }
})()

/**
 * The tray the cards lie on: a dark felt inset whose rim glows in the colour
 * of the player whose turn it is (`turn` null = nobody's, e.g. between rounds).
 */
function renderTray(g: Draw, turn: Side | null): void {
  const { x, y, w, h, r } = TRAY
  g.shadow(x + w / 2, y + h + 6, w * 0.5, 40, 0.4)
  g.rrect(x, y + 14, w, h, r, shade(C.ink, -0.2))
  g.rrect(
    x,
    y,
    w,
    h,
    r,
    g.lin(0, y, 0, y + h, [
      [0, shade(C.ink3, 0.08)],
      [0.5, C.ink2],
      [1, shade(C.ink3, 0.02)],
    ]),
  )
  g.rrect(x + 10, y + 10, w - 20, h - 20, r - 10, undefined, alpha('#000000', 0.35), 6)
  if (turn !== null) {
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 4)
    const col = SIDE[turn].main
    // The rim nearest the player to move takes their colour.
    g.rrect(
      x,
      y,
      w,
      h,
      r,
      undefined,
      g.lin(0, y, 0, y + h, [
        [0, alpha(col, turn === 1 ? 0.9 : 0.08)],
        [0.5, alpha(col, 0.3)],
        [1, alpha(col, turn === 0 ? 0.9 : 0.08)],
      ]),
      6 + 3 * pulse,
    )
  } else g.rrect(x, y, w, h, r, undefined, alpha(C.white, 0.1), 4)
}

export function renderCards(g: Draw, s: State, now: number, turn: Side | null): void {
  renderTray(g, turn)
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
