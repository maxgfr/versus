import { outBack, prog } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import {
  drawDice,
  drawRollButton,
  drawRollsLeft,
  drawSheet,
  drawTotal,
  drawTray,
  inFrame,
  rolling,
  sheetLayout,
  textAngle,
  trayLayout,
} from '../../engines/dice/index.ts'
import type { State } from './index.ts'
import { CATS, MAX_ROLLS, score, total, turnsPlayed } from './rules.ts'

/** Layout, written in red's frame (bottom half); blue's is the same turned 180°. */
export const TRAY = trayLayout(5, 900, 122)
export const SHEET = sheetLayout(3, 3, 1062, 122)
export const ROLL = { x: W / 2, y: 1548, w: 400, h: 124 }
const TOTAL_X = 140
const LEFT_X = 860
/** Beat between the last score landing and the closing plaques. */
const END_DELAY = 0.35

export function renderYazy(
  g: Draw,
  s: State,
  now: number,
  over: boolean,
  isBot: (side: Side) => boolean,
  rounds: number,
): void {
  for (const side of [0, 1] as Side[]) {
    const mine = s.turn === side && !over
    const canScore = mine && s.rolls > 0 && !rolling(s, now)
    const turns = turnsPlayed(s.sheets[side])
    const sub = turns >= rounds ? 'Finished' : `Turn ${turns + 1} of ${rounds}`
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
      sub,
    })
    g.alpha(mine ? 1 : 0.45, () => drawRollsLeft(g, side, LEFT_X, ROLL.y, left))
    drawTotal(g, side, TOTAL_X, ROLL.y, total(s.sheets[side]))
  }
  drawTray(g, TRAY, over ? null : s.turn)
  drawDice(g, TRAY, s, now, { turn: s.turn, dim: s.rolls === 0 && !over })
  drawEnding(g, s, now)
}

/** The closing moment: each sheet dims under a plaque with its final total, the winner's in gold. */
function drawEnding(g: Draw, s: State, now: number): void {
  if (!s.end) return
  const t = now - s.end.at - END_DELAY
  if (t < 0) return
  for (const side of [0, 1] as Side[]) {
    const ta = textAngle(g, side)
    const won = s.end.winner === side
    const draw = s.end.winner === 'draw'
    const k = outBack(prog(t - (won ? 0 : 0.15), 0, 0.45))
    if (k <= 0) continue
    const cy = SHEET.y + SHEET.h / 2
    inFrame(g, side, () => {
      g.alpha(0.55 * prog(t, 0, 0.3), () =>
        g.rrect(SHEET.x - 14, SHEET.y - 14, SHEET.w + 28, SHEET.h + 28, 34, C.ink),
      )
      g.at(
        W / 2,
        cy,
        0,
        () => {
          const w = 600
          const h = 230
          const face = won ? C.yellow : draw ? C.ink4 : shade(SIDE[side].main, -0.5)
          if (won) {
            g.alpha(0.35 + 0.2 * Math.sin(now * 6), () =>
              g.rrect(-w / 2 - 18, -h / 2 - 18, w + 36, h + 36, 70, C.yellow),
            )
          }
          g.tile(-w / 2, -h / 2, w, h, 56, face, 16)
          g.at(0, -8, ta, () => {
            g.text(won ? 'Winner!' : draw ? 'Draw' : 'Final', 0, -46, {
              size: 50,
              weight: 700,
              color: won ? C.ink : alpha(C.white, 0.8),
            })
            g.text(total(s.sheets[side]), 0, 34, {
              size: 96,
              weight: 700,
              color: won ? C.ink : C.white,
              drop: alpha('#000000', won ? 0.15 : 0.35),
            })
          })
          if (won) {
            for (let i = 0; i < 3; i++) {
              const a = now * 1.4 + (i * Math.PI * 2) / 3
              g.star(Math.cos(a) * (w / 2 + 10), Math.sin(a) * (h / 2 + 4), 24, C.white, 5, 0.45, a)
            }
          }
        },
        k,
      )
    })
  }
}
