import type { Side } from '../../core/game.ts'
import { inFrame, textAngle } from '../../core/frame.ts'
import { banner, bigScore, clock, namePill, pips } from '../../core/hud.ts'
import { outBack, type Ease } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  type Ball,
  type Board,
  type Brick,
  BALL_R,
  brickRect,
  GRID_TOP,
  COLS,
  LIVES,
  MAX_ROWS,
  type Match,
  PADDLE_H,
  PADDLE_HALF,
  PADDLE_Y,
  remaining,
} from './rules.ts'

export interface Look {
  names: [string, string]
  /** Recent ball positions per side, in that side's frame. Cosmetic. */
  trails: { x: number; y: number }[][]
  /** Paddle squash per side (1 = rest). */
  squash: [number, number]
  /** Show the "tap to launch" hint on a side's stuck ball. */
  hint: [boolean, boolean]
  /** Match length in seconds. */
  limit: number
  /** The decided match (stamped in state), for the ending. */
  end: { at: number; winner: Side | 'draw'; why: string } | null
}

export const ROW_COLORS = [C.pink, C.orange, C.yellow, C.green, C.cyan, C.purple, C.teal]
export const JUNK_COLOR = '#8d88a6'
const JUNK_TEXT = '#d6d0ec'
/** Wall status line: between the midline wall and the top brick row. */
const GRID_LABEL_Y = MID + 50
const DROP = 0.45
const drop: Ease = outBack

function drawBrick(g: Draw, br: Brick, now: number): void {
  const rc = brickRect(br.c, br.r)
  const age = now - br.at
  const dy = br.junk && age < DROP ? (1 - drop(Math.max(0, age / DROP))) * -150 : 0
  const col = br.junk ? JUNK_COLOR : (ROW_COLORS[br.r % ROW_COLORS.length] ?? C.white)
  g.tile(rc.x, rc.y + dy, rc.w, rc.h, 12, col, 9)
  if (br.junk) {
    // Grey junk gets rivets so it never reads as a normal brick.
    for (const [x, y] of [
      [rc.x + 14, rc.y + 14],
      [rc.x + rc.w - 14, rc.y + 14],
      [rc.x + 14, rc.y + rc.h - 18],
      [rc.x + rc.w - 14, rc.y + rc.h - 18],
    ] as const)
      g.circle(x, y + dy, 4, alpha(C.ink, 0.45))
  }
}

function drawBall(g: Draw, ball: Ball, trail: { x: number; y: number }[]): void {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]
    if (!t) continue
    const k = (i + 1) / (trail.length + 1)
    g.alpha(k * 0.35, () => g.circle(t.x, t.y, BALL_R * (0.4 + 0.6 * k), C.yellow))
  }
  // A soft glow: the ball is the one bright thing on the board.
  g.circle(
    ball.x,
    ball.y,
    BALL_R * 2.6,
    g.rad(ball.x, ball.y, BALL_R * 0.8, BALL_R * 2.6, [
      [0, alpha(C.yellow, 0.35)],
      [1, alpha(C.yellow, 0)],
    ]),
  )
  g.shadow(ball.x + 5, ball.y + 12, BALL_R * 0.9, BALL_R * 0.55, 0.35)
  g.ball(ball.x, ball.y, BALL_R, C.yellow, 1)
}

function drawBoard(g: Draw, side: Side, b: Board, look: Look, now: number): void {
  const col = SIDE[side].main
  inFrame(g, side, () => {
    // The player's pitch: a dark tint of their colour, the same on both halves.
    const px = -14
    const pw = W + 28
    const py = MID + 18
    const ph = H - MID + 40
    g.rrect(
      px,
      py,
      pw,
      ph,
      36,
      g.lin(0, py, 0, py + ph, [
        [0, shade(col, -0.84)],
        [1, shade(col, -0.7)],
      ]),
    )
    // Floodlight on the wall, and the danger strip behind the paddle.
    g.clip(px, py, pw, ph, 36, () => {
      g.fillView(
        g.rad(W / 2, GRID_TOP + 160, 30, 620, [
          [0, alpha('#ffffff', 0.07)],
          [1, alpha('#ffffff', 0)],
        ]),
      )
      g.rect(
        px,
        PADDLE_Y + 30,
        pw,
        H - PADDLE_Y,
        g.lin(0, PADDLE_Y + 30, 0, H, [
          [0, alpha(col, 0)],
          [1, alpha(col, 0.22)],
        ]),
      )
    })
    g.rrect(px, py, pw, ph, 36, undefined, alpha(col, 0.4), 5)
    // Empty wall cells stay faintly visible so junk has somewhere to land.
    for (let r = 0; r < MAX_ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const rc = brickRect(c, r)
        g.rrect(rc.x, rc.y, rc.w, rc.h, 12, alpha(C.white, 0.04))
      }
    for (const br of b.bricks) drawBrick(g, br, now)
    const trail = look.trails[side] ?? []
    if (!b.ball.stuck) drawBall(g, b.ball, trail)
    g.at(
      b.px,
      PADDLE_Y,
      0,
      () => {
        g.shadow(0, 34, PADDLE_HALF * 1.02, 16, 0.4)
        g.tile(-PADDLE_HALF, -PADDLE_H / 2, PADDLE_HALF * 2, PADDLE_H + 22, 22, col, 14)
        // Bumper lights at both ends and the side mark in the middle.
        for (const sx of [-1, 1]) g.circle(sx * (PADDLE_HALF - 24), 2, 7, alpha(C.white, 0.75))
        g.sideMark(side, 0, 2, 10, C.white)
      },
      2 - (look.squash[side] ?? 1),
      look.squash[side] ?? 1,
    )
    if (b.ball.stuck) {
      drawBall(g, b.ball, [])
      if (look.hint[side]) {
        g.text('TAP TO LAUNCH', W / 2, PADDLE_Y - 118, {
          size: 44,
          weight: 700,
          color: alpha(C.white, 0.85),
          angle: textAngle(g, side),
        })
      }
    }
    // Wall status in the two top corners of this player's board, clear of the clock.
    g.text(`${remaining(b)} LEFT`, 240, GRID_LABEL_Y, {
      size: 40,
      weight: 700,
      color: alpha(C.white, 0.8),
      angle: textAngle(g, side),
    })
    if (b.queue > 0)
      g.text(`+${b.queue} JUNK`, W - 220, GRID_LABEL_Y, {
        size: 40,
        weight: 700,
        color: JUNK_TEXT,
        angle: textAngle(g, side),
      })
  })
}

export function render(g: Draw, m: Match, look: Look): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.85)],
      [0.5, C.ink],
      [1, shade(C.red, -0.85)],
    ]),
  )
  for (const side of [0, 1] as Side[]) drawBoard(g, side, m.boards[side], look, m.t)
  // The midline is a solid wall: the ball bounces off it.
  const v = g.stage.view
  g.rect(v.x, MID - 14, v.w, 28, C.ink3)
  g.rect(v.x, MID - 14, v.w, 4, alpha(C.white, 0.18))
  for (const side of [0, 1] as Side[]) {
    const b = m.boards[side]
    const last = b.lives === 1 && !look.end
    namePill(g, side, look.names[side], {
      x: W / 2,
      active: last,
      text: last ? 'LAST BALL!' : undefined,
    })
    // Score on the player's left: world left for red, world right for blue.
    bigScore(g, side, b.broken, { x: side === 0 ? 130 : W - 130 })
    pips(g, side, b.lives, LIVES)
  }
  if (!look.end) clock(g, look.limit - m.t, MID)
  const end = look.end
  if (end) {
    const k = Math.min(1, (m.t - end.at) / 0.35)
    if (end.winner === 'draw') banner(g, undefined, end.why, MID, { alpha: k })
    else
      banner(g, end.winner, end.why, end.winner === 0 ? MID + 420 : MID - 420, {
        alpha: k,
        size: 64 + (1 - k) * 30,
        color: C.yellow,
      })
  }
}
