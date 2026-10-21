import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { W } from '../../core/stage.ts'
import {
  drawDice,
  drawRollButton,
  drawRollsLeft,
  drawSheet,
  drawTotal,
  drawTray,
  rolling,
  sheetLayout,
  trayLayout,
} from '../../engines/dice/index.ts'
import type { State } from './index.ts'
import { CATS, MAX_ROLLS, score, total } from './rules.ts'

/** Layout, written in red's frame (bottom half); blue's is the same turned 180°. */
export const TRAY = trayLayout(5, 900, 122)
export const SHEET = sheetLayout(3, 3, 1062, 122)
export const ROLL = { x: W / 2, y: 1548, w: 400, h: 124 }
const TOTAL_X = 140
const LEFT_X = 860

export function renderYazy(
  g: Draw,
  s: State,
  now: number,
  over: boolean,
  isBot: (side: Side) => boolean,
): void {
  for (const side of [0, 1] as Side[]) {
    const mine = s.turn === side && !over
    const canScore = mine && s.rolls > 0 && !rolling(s, now)
    drawSheet(
      g,
      side,
      SHEET,
      CATS.map((c, i) => ({
        label: c.label,
        value: s.sheets[side][i] ?? null,
        preview: canScore ? score(s.dice, i) : null,
      })),
      {
        active: canScore,
        now,
        ...(s.last && s.last.side === side ? { flashAt: s.last.at, flashCell: s.last.cat } : {}),
      },
    )
    const left = mine ? MAX_ROLLS - s.rolls : MAX_ROLLS
    const canRoll = mine && s.rolls < MAX_ROLLS && !isBot(side)
    const label = mine && s.rolls >= MAX_ROLLS ? 'Pick a row' : 'Roll'
    drawRollButton(g, side, ROLL, label, {
      enabled: mine && (s.rolls < MAX_ROLLS || isBot(side)),
      pulse: canRoll && s.rolls === 0,
    })
    g.alpha(mine ? 1 : 0.45, () => drawRollsLeft(g, side, LEFT_X, ROLL.y, left))
    drawTotal(g, side, TOTAL_X, ROLL.y, total(s.sheets[side]))
  }
  drawTray(g, TRAY, over ? null : s.turn)
  drawDice(g, TRAY, s, now, { turn: s.turn, dim: s.rolls === 0 && !over })
}
