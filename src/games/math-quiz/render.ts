import { frame, inFrame, textAngle, toLocal } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'

/** Distance between the two copies of the sum in local 2P (each reads from its own side). */
export const SUM_GAP = 110
/** The scoreboard in the middle. Taller in local 2P, where it holds two copies of the sum. */
export const PANEL = { w: 760, h2p: 440, h1p: 300, r: 56 }

/** Option buttons in red's frame: two columns, two rows. Blue's are mirrored by `frame`. */
const COLS = [285, 715] as const
const ROWS = [1300, 1520] as const
/** Middle of the button grid in red's frame (between the two rows). */
export const GRID_MID_Y = (ROWS[0] + ROWS[1]) / 2
export const OPT = { w: 400, h: 190, r: 40, depth: 22 }

/** World position of option button `i` for `side`. */
export function optionCentre(side: Side, i: number): { x: number; y: number } {
  return frame(side, COLS[i % 2] ?? COLS[0], ROWS[Math.floor(i / 2)] ?? ROWS[0])
}

/** Which of `side`'s option buttons (0-3) sits under world point (x, y), or -1. */
export function optionAt(side: Side, x: number, y: number): number {
  const l = toLocal(side, x, y)
  for (let i = 0; i < 4; i++) {
    const cx = COLS[i % 2] ?? COLS[0]
    const cy = ROWS[Math.floor(i / 2)] ?? ROWS[0]
    if (Math.abs(l.x - cx) <= OPT.w / 2 + 14 && Math.abs(l.y - cy) <= OPT.h / 2 + 14) return i
  }
  return -1
}

/** Table: each half owned by its team, a floodlight on the scoreboard, dark corners. */
export function drawBackdrop(g: Draw): void {
  g.halves(shade(SIDE[0].main, -0.76), shade(SIDE[1].main, -0.76))
  g.fillView(
    g.rad(W / 2, MID, 40, 1050, [
      [0, alpha('#ffffff', 0.13)],
      [0.45, alpha('#ffffff', 0.04)],
      [1, alpha('#000000', 0)],
    ]),
  )
  // Each team's lane: a soft pool of light under its buttons.
  for (const side of [0, 1] as Side[]) {
    const c = frame(side, 500, GRID_MID_Y)
    g.fillView(
      g.rad(c.x, c.y, 20, 560, [
        [0, alpha(SIDE[side].main, 0.16)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
  g.vignette(0.42)
}

/** The scoreboard in the middle: one copy of the sum per reader in local 2P. */
export function drawSum(g: Draw, s: State, now: number, names: readonly string[]): void {
  const h = g.flipTop ? PANEL.h2p : PANEL.h1p
  const x0 = W / 2 - PANEL.w / 2
  const y0 = MID - h / 2
  const bump = 1 + 0.025 * Math.sin(Math.PI * prog(now - s.qAt, 0, 0.3))
  g.at(
    W / 2,
    MID,
    0,
    () => {
      g.ctx.translate(-W / 2, -MID)
      g.shadow(W / 2, MID + h / 2 + 22, PANEL.w * 0.47, 34, 0.4)
      g.tile(x0, y0, PANEL.w, h + 18, PANEL.r, C.ink4, 18)
      // The screen, inset into the frame.
      g.rrect(
        x0 + 22,
        y0 + 22,
        PANEL.w - 44,
        h - 44,
        PANEL.r - 20,
        g.lin(0, y0, 0, y0 + h, [
          [0, '#0d0a16'],
          [0.5, C.ink],
          [1, '#0d0a16'],
        ]),
      )
      g.rrect(
        x0 + 22,
        y0 + 22,
        PANEL.w - 44,
        h - 44,
        PANEL.r - 20,
        undefined,
        alpha('#000', 0.5),
        4,
      )
      // Settled: the screen's edge lights up in the scorer's colour, then fades.
      if (s.done) {
        const glow = 1 - prog(now - s.doneAt, 0.15, 1.1)
        const col = s.winner === null ? C.mute : SIDE[s.winner].main
        if (glow > 0)
          g.alpha(glow, () =>
            g.rrect(x0 + 16, y0 + 16, PANEL.w - 32, h - 32, PANEL.r - 16, undefined, col, 10),
          )
      }
      // Rivets in the corners: a toy scoreboard, not a text box.
      for (const [rx, ry] of [
        [x0 + 40, y0 + 40],
        [x0 + PANEL.w - 40, y0 + 40],
        [x0 + 40, y0 + h - 40],
        [x0 + PANEL.w - 40, y0 + h - 40],
      ] as const)
        g.ball(rx, ry, 8, C.ink4, 0.6)
    },
    bump,
    bump,
  )
  const copies: [number, number][] = g.flipTop
    ? [
        [MID + SUM_GAP, 0],
        [MID - SUM_GAP, Math.PI],
      ]
    : [[MID, g.stage.rot]]
  const pop = outBack(prog(now - s.qAt, 0, 0.4))
  for (const [y, angle] of copies) {
    if (s.endAt >= 0 && s.winner !== null) {
      const k = outBack(prog(now - s.endAt, 0.25, 0.7))
      g.at(W / 2, y, angle, () => drawWinner(g, s.winner ?? 0, names), k, k)
      continue
    }
    g.alpha(Math.min(1, pop * 1.5), () =>
      g.at(W / 2, y, angle, () => drawEquation(g, s, now), 0.7 + 0.3 * pop),
    )
  }
}

function drawWinner(g: Draw, side: Side, names: readonly string[]): void {
  const label = `${names[side] ?? SIDE[side].name} wins!`
  const size = 76
  const w = Math.min(540, g.measure(label, size, 700))
  // Trophy and label centred together on the screen.
  g.emoji('🏆', -w / 2 - 6, 0, 76)
  g.text(label, 44, 6, {
    size,
    weight: 700,
    color: SIDE[side].light,
    drop: alpha('#000000', 0.5),
    maxWidth: 540,
  })
}

/** "a + b = ?" with the answer slot: yellow and pulsing while live, the scorer's colour once solved. */
function drawEquation(g: Draw, s: State, now: number): void {
  const q = s.q
  const size = 100
  const lhs = `${q.a} ${q.op} ${q.b} =`
  const ans = String(q.answer)
  const slotW = Math.max(160, g.measure(ans, size, 700) + 64)
  const gap = 28
  const lw = g.measure(lhs, size, 700)
  const total = lw + gap + slotW
  const fit = Math.min(1, 660 / total)
  g.at(
    0,
    0,
    0,
    () => {
      g.text(lhs, -total / 2 + lw / 2, 6, {
        size,
        weight: 700,
        color: s.done ? alpha(C.white, 0.75) : C.white,
        drop: alpha('#000000', 0.4),
      })
      const sx = total / 2 - slotW / 2
      if (!s.done) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 6)
        g.rrect(-slotW / 2 + sx, -66, slotW, 132, 32, alpha(C.yellow, 0.1 + 0.08 * pulse))
        g.rrect(-slotW / 2 + sx, -66, slotW, 132, 32, undefined, C.yellow, 6)
        g.text('?', sx, 6, { size, weight: 700, color: C.yellow, drop: alpha('#000000', 0.4) })
        return
      }
      const k = outBack(prog(now - s.doneAt, 0, 0.38))
      const col = s.winner === null ? C.ink4 : SIDE[s.winner].main
      g.at(
        sx,
        0,
        0,
        () => {
          g.tile(-slotW / 2, -66, slotW, 142, 32, col, 10)
          g.text(ans, 0, -2, {
            size,
            weight: 700,
            color: s.winner === null ? alpha(C.white, 0.6) : C.white,
            drop: alpha('#000000', 0.35),
          })
          if (s.winner === null) g.line(-slotW / 2 + 20, 30, slotW / 2 - 20, -36, C.red, 10)
        },
        0.5 + 0.5 * k,
      )
    },
    fit,
  )
}

/** One player's four answer buttons, drawn on their half. */
export function drawOptions(g: Draw, s: State, side: Side, now: number): void {
  const col = SIDE[side]
  const ta = textAngle(g, side)
  const out = s.locked[side] && !s.done
  const scorer = s.done && s.winner === side
  // Tiles keep their lip toward the bottom of whoever looks at them (`tile` itself re-lights for a rotated view).
  const lit = ta - g.stage.rot
  inFrame(g, side, () => {
    for (let i = 0; i < 4; i++) {
      const cx = COLS[i % 2] ?? COLS[0]
      const cy = ROWS[Math.floor(i / 2)] ?? ROWS[0]
      const v = s.choices[side][i]
      if (v === undefined) continue
      const right = v === s.q.answer
      const tapped = s.pressIdx[side] === i
      const pressed = tapped ? 1 - prog(now - s.pressAt[side], 0, 0.16) : 0
      const won = tapped && s.pressOk[side]
      const slip = tapped && !s.pressOk[side]
      // New sum: the buttons pop up one after the other.
      const intro = outBack(prog(now - s.qAt, 0.04 * i, 0.3 + 0.04 * i))
      let face: string = col.main
      let label: string = C.white
      let a = 1
      if (out) face = mix(shade(col.main, -0.45), C.ink3, 0.5)
      if (s.done) {
        if (won) {
          face = C.yellow
          label = C.ink
        } else if (right) face = scorer ? col.main : C.green
        else if (!slip) a = 0.4
      }
      if (slip) face = C.ink4
      let sc = intro
      if (won) sc *= 1 + 0.1 * Math.sin(Math.PI * prog(now - s.pressAt[side], 0, 0.35))
      if (s.done && right && !won)
        sc *= 1 + 0.06 * Math.sin(Math.PI * prog(now - s.doneAt, 0.1, 0.45))
      const shake = slip
        ? Math.sin((now - s.pressAt[side]) * 70) * 14 * (1 - prog(now - s.pressAt[side], 0, 0.4))
        : 0
      g.alpha(a * Math.min(1, intro * 2), () =>
        g.at(
          cx + shake,
          cy,
          lit,
          () => {
            g.shadow(0, OPT.h / 2 - 2, OPT.w * 0.46, 20, 0.32)
            if (won) {
              g.alpha(0.35 + 0.25 * Math.sin(now * 10), () =>
                g.rrect(
                  -OPT.w / 2 - 14,
                  -OPT.h / 2 - 14,
                  OPT.w + 28,
                  OPT.h + 28,
                  OPT.r + 14,
                  C.yellow,
                ),
              )
            }
            g.tile(-OPT.w / 2, -OPT.h / 2, OPT.w, OPT.h, OPT.r, face, OPT.depth, pressed)
            const ty = -OPT.depth / 2 + 4 + pressed * OPT.depth
            g.at(0, ty, g.stage.rot, () => {
              g.text(String(v), 0, 0, {
                size: 104,
                weight: 700,
                color: slip || out ? alpha(C.white, 0.45) : label,
                drop: alpha('#000000', won ? 0.12 : 0.28),
              })
              if (slip)
                g.text('✗', OPT.w / 2 - 50, -OPT.h / 2 + 50, {
                  size: 52,
                  weight: 700,
                  color: C.red,
                })
              if (s.done && right && !won)
                g.text('✓', OPT.w / 2 - 50, -OPT.h / 2 + 50, {
                  size: 52,
                  weight: 700,
                  color: C.white,
                })
            })
          },
          sc,
        ),
      )
    }
    if (out) {
      // Locked out of this sum: a plate across the buttons, upright for the player.
      const k = outBack(prog(now - s.pressAt[side], 0.1, 0.4))
      g.at(
        500,
        GRID_MID_Y - OPT.depth / 2,
        ta,
        () => {
          const label = 'Locked out'
          const w = g.measure(label, 46, 700) + 150
          g.rrect(-w / 2, -48, w, 96, 48, alpha(C.ink, 0.92), alpha(C.red, 0.9), 6)
          g.emoji('🔒', -w / 2 + 52, 0, 50)
          g.text(label, 28, 3, { size: 46, weight: 700, color: C.white })
        },
        k,
      )
    }
  })
}

/** Points so far as a row of pips beside the name pill, to each player's right (first to `target`). */
export function racePips(
  g: Draw,
  side: Side,
  n: number,
  target: number,
  now: number,
  at: number,
): void {
  const y = hudY(g, side)
  const x = side === 0 ? 812 : 188
  const gap = 34
  g.forSide(side, x, y, () => {
    const x0 = -((target - 1) * gap) / 2
    for (let i = 0; i < target; i++) {
      const on = i < n
      const fresh = on && i === n - 1 ? outCubic(prog(now - at, 0, 0.35)) : 1
      const r = 12 * (on ? 1 + 0.5 * (1 - fresh) : 1)
      if (on) g.ball(x0 + i * gap, 0, r, SIDE[side].main, 0.8)
      else g.circle(x0 + i * gap, 0, 10, alpha(C.white, 0.13))
    }
  })
}
