import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { tableBackdrop } from '../../engines/board/index.ts'
import { BUBBLES, COLS, ROWS, colOf, rowOf } from './rules.ts'
import type { State } from './index.ts'

/** Layout in world units. The tray sits on the midline; each player's Done is in their half. */
export const CELL = 116
export const BUB_R = 46
const X0 = W / 2 - (COLS * CELL) / 2
const Y0 = MID - (ROWS * CELL) / 2
const PAD = 44
export const TRAY = { x: X0 - PAD, y: Y0 - PAD, w: COLS * CELL + PAD * 2, h: ROWS * CELL + PAD * 2 }
const TRAY_R = 78
const TRAY_DEPTH = 30

/** Rainbow, top row to bottom row. */
export const ROW_COLORS: readonly string[] = [C.red, C.orange, C.yellow, C.green, C.blue, C.purple]

/** Seconds after the last pop before the board starts to spring back up, and the wave's pace. */
export const REFILL_AT = 0.9
const REFILL_ROW = 0.11
const REFILL_COL = 0.035

export const refillTime = (i: number): number =>
  REFILL_AT + rowOf(i) * REFILL_ROW + colOf(i) * REFILL_COL

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

export function bubbleCenter(i: number): { x: number; y: number } {
  return { x: X0 + ((i % COLS) + 0.5) * CELL, y: Y0 + (rowOf(i) + 0.5) * CELL }
}

/** The bubble under a world point (its whole cell counts, so fingers have room), or null. */
export function bubbleAt(x: number, y: number): number | null {
  const c = Math.floor((x - X0) / CELL)
  const r = Math.floor((y - Y0) / CELL)
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null
  const i = r * COLS + c
  return i < BUBBLES ? i : null
}

/** The Done button in a player's half (blue's mirrors red's through the stage centre). */
export function doneRect(side: Side): Rect {
  const w = 330
  const h = 124
  const p = frame(side, W / 2, 1548)
  return { x: p.x - w / 2, y: p.y - h / 2, w, h }
}

export function backdrop(g: Draw): void {
  tableBackdrop(g)
}

/** The Done button: a chunky team-coloured key that pops in on your turn and sinks when pressed. */
export function doneButton(
  g: Draw,
  side: Side,
  o: { pops: number; now: number; turnAt: number; doneAt: number },
): void {
  const r = doneRect(side)
  const on = o.pops > 0
  const enter = outBack(prog(o.now, o.turnAt, o.turnAt + 0.35))
  if (enter <= 0) return
  const pressed = o.now - o.doneAt < 0.14 ? 1 : 0
  g.forSide(side, r.x + r.w / 2, r.y + r.h / 2, () => {
    const team = SIDE[side]
    const depth = 16
    const h = r.h - depth
    const pulse = on ? 0.5 + 0.5 * Math.sin(o.now * 6) : 0
    g.at(
      0,
      0,
      0,
      () => {
        if (on) {
          g.alpha(0.18 + 0.22 * pulse, () =>
            g.rrect(
              -r.w / 2 - 12,
              -h / 2 - depth / 2 - 12,
              r.w + 24,
              r.h + 24,
              h / 2 + 12,
              team.main,
            ),
          )
        }
        g.tile(
          -r.w / 2,
          -h / 2 - depth / 2,
          r.w,
          r.h,
          h / 2,
          on ? team.main : shade(team.main, -0.55),
          depth,
          pressed,
        )
        const dy = pressed ? depth / 2 : -depth / 2
        g.text(on ? 'Done' : 'Pop a row', on ? -18 : 0, dy + 3, {
          size: on ? 52 : 40,
          weight: 700,
          color: on ? C.white : alpha(C.white, 0.6),
          drop: on ? alpha('#000000', 0.3) : undefined,
        })
        if (on) {
          // How many bubbles this turn has popped so far.
          const bx = r.w / 2 - 62
          g.circle(bx, dy + 2, 30, C.white)
          g.text(o.pops, bx, dy + 4, { size: 38, weight: 700, color: team.dark })
        }
      },
      enter,
    )
  })
}

/** The bubble count and the one rule, on a chip under (and, in local 2P, over) the tray. */
export function countChip(g: Draw, left: number, now: number, side?: Side): void {
  const urgent = left > 0 && left <= 3
  const text =
    left === 0
      ? 'Last pop!'
      : left === 1
        ? '1 left · don’t pop it!'
        : `${left} left · last pop loses`
  const y = side === 1 ? H - 1408 : 1408
  g.forSide(side, W / 2, y, () => {
    const size = 38
    const w = g.measure(text, size, 700) + 70
    const k = urgent ? 1 + 0.04 * Math.sin(now * 8) : 1
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(-w / 2, -34, w, 68, 34, urgent ? alpha(C.yellow, 0.95) : alpha(C.ink, 0.7))
        g.text(text, 0, 3, { size, weight: 700, color: urgent ? C.ink : C.white })
      },
      k,
    )
  })
}

/** The silicone pop-it: one rainbow slab, a band per row, every bubble a dome or a dimple. */
export function drawTray(g: Draw, s: State, now: number): void {
  const { x, y, w, h } = TRAY
  g.shadow(W / 2, y + h + TRAY_DEPTH + 10, w * 0.5, 36, 0.45)
  // Lip.
  g.rrect(x, y + TRAY_DEPTH, w, h, TRAY_R, shade(ROW_COLORS[ROWS - 1] ?? C.purple, -0.5))
  g.clip(x, y, w, h, TRAY_R, () => {
    for (let r = 0; r < ROWS; r++) {
      const top = r === 0 ? y : Y0 + r * CELL
      const bot = r === ROWS - 1 ? y + h : Y0 + (r + 1) * CELL
      g.rect(x, top, w, bot - top, shade(ROW_COLORS[r] ?? C.white, -0.12))
    }
    // Silicone sheen: lit from the top, a little darker toward the bottom.
    g.rect(
      x,
      y,
      w,
      h,
      g.lin(0, y, 0, y + h, [
        [0, alpha('#ffffff', 0.2)],
        [0.45, alpha('#ffffff', 0)],
        [1, alpha('#000000', 0.18)],
      ]),
    )
  })
  // The raised rim of the toy.
  g.rrect(x + 16, y + 16, w - 32, h - 32, TRAY_R - 16, undefined, alpha('#ffffff', 0.22), 6)
  g.rrect(x + 22, y + 24, w - 44, h - 44, TRAY_R - 20, undefined, alpha('#000000', 0.12), 5)

  const over = s.endAt >= 0
  for (let i = 0; i < BUBBLES; i++) {
    const { x: bx, y: by } = bubbleCenter(i)
    const color = ROW_COLORS[rowOf(i)] ?? C.white
    const back = over ? now - (s.endAt + refillTime(i)) : -1
    if (s.popped[i] === true && back < 0) drawDimple(g, bx, by, color, now - (s.poppedAt[i] ?? -10))
    else drawDome(g, bx, by, color, back >= 0 ? back : 9)
  }

  // Locked turn: the other rows go dark, the row in play glows.
  if (s.lock >= 0 && !over) {
    // Washed out, not muddied: draining the colour first keeps the dark veil from
    // turning orange and yellow into brown and olive.
    const c = g.ctx
    for (let r = 0; r < ROWS; r++) {
      if (r === s.lock) continue
      const ry = Y0 + r * CELL + 2
      c.save()
      c.globalCompositeOperation = 'saturation'
      g.rrect(X0 - 16, ry, COLS * CELL + 32, CELL - 4, 50, alpha('#808080', 0.68))
      c.restore()
      g.rrect(X0 - 16, ry, COLS * CELL + 32, CELL - 4, 50, alpha(C.ink, 0.4))
    }
    const ry = Y0 + s.lock * CELL
    const p = 0.5 + 0.5 * Math.sin(now * 7)
    g.rrect(X0 - 18, ry + 2, COLS * CELL + 36, CELL - 4, 54, undefined, alpha(C.ink, 0.7), 16)
    g.rrect(
      X0 - 18,
      ry + 2,
      COLS * CELL + 36,
      CELL - 4,
      54,
      undefined,
      alpha(C.yellow, 0.6 + 0.4 * p),
      8,
    )
  }
}

/** A whole bubble: a glossy silicone dome in a darker socket. `age` > 0 springs it up (the refill wave). */
export function drawDome(g: Draw, x: number, y: number, color: string, age: number): void {
  const r = BUB_R
  const up = outBack(prog(age, 0, 0.3))
  g.circle(x, y + 2, r + 7, shade(color, -0.32))
  g.circle(x + 4, y + 8, r, alpha('#000000', 0.28))
  g.at(
    x,
    y,
    0,
    () => {
      g.circle(
        0,
        0,
        r,
        g.rad(
          0,
          0,
          r * 0.1,
          r,
          [
            [0, shade(color, 0.5)],
            [0.6, color],
            [1, shade(color, -0.3)],
          ],
          -r * 0.35,
          -r * 0.4,
        ),
      )
      g.ellipse(-r * 0.34, -r * 0.4, r * 0.32, r * 0.18, alpha('#ffffff', 0.75), -0.6)
      g.circle(r * 0.32, r * 0.36, r * 0.1, alpha('#ffffff', 0.2))
    },
    0.85 + 0.15 * up,
    0.85 + 0.15 * up,
  )
}

/** A popped bubble: a concave dimple, shadowed at the top and lit at the bottom, that squashes in. */
export function drawDimple(g: Draw, x: number, y: number, color: string, age: number): void {
  const r = BUB_R
  // The first instant: the dome flattens under the finger before it snaps through.
  if (age < 0.07) {
    const k = age / 0.07
    g.circle(x, y + 2, r + 7, shade(color, -0.32))
    g.at(
      x,
      y,
      0,
      () =>
        g.circle(
          0,
          0,
          r,
          g.rad(
            0,
            0,
            r * 0.1,
            r,
            [
              [0, shade(color, 0.35)],
              [1, shade(color, -0.2)],
            ],
            -r * 0.3,
            -r * 0.3,
          ),
        ),
      1 + 0.2 * k,
      1 - 0.35 * k,
    )
    return
  }
  const e = outBack(prog(age, 0.07, 0.4))
  const sx = 1 + 0.12 * (1 - e)
  const sy = 1 - 0.18 * (1 - e)
  g.circle(x, y + 2, r + 7, shade(color, -0.32))
  g.at(
    x,
    y,
    0,
    () => {
      g.circle(
        0,
        0,
        r,
        g.lin(0, -r, 0, r, [
          [0, shade(color, -0.62)],
          [0.55, shade(color, -0.25)],
          [1, shade(color, 0.12)],
        ]),
      )
      // Inner shadow under the top edge, light caught by the bottom rim.
      g.arc(0, 0, r - 5, Math.PI * 1.08, Math.PI * 1.92, alpha('#000000', 0.35), 9)
      g.arc(0, 0, r - 4, Math.PI * 0.15, Math.PI * 0.85, alpha('#ffffff', 0.35), 5)
      g.ellipse(0, r * 0.3, r * 0.42, r * 0.14, alpha('#ffffff', 0.12))
    },
    sx,
    sy,
  )
  // A soft ring of air escaping, right after the pop.
  const ring = prog(age, 0.05, 0.4)
  if (ring > 0 && ring < 1)
    g.ring(
      x,
      y,
      r * (1 + 0.5 * outCubic(ring)),
      alpha('#ffffff', 0.5 * (1 - ring)),
      6 * (1 - ring) + 1,
    )
}
