import type { Side } from '../../core/game.ts'
import { outBack, outCubic } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'

/**
 * Shared look for this game: a wordless wind sock (reads the same from both
 * edges), the floodlit night wash, and the final tally card.
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Top-down wind sock on a dark puck: a striped cone streaming downwind, longer
 * and tauter with the strength, plus 0..3 chevrons. Limp and grey when calm.
 */
export function windSock(g: Draw, wind: number, max: number, x: number, y: number): void {
  const k = clamp01(Math.abs(wind) / max)
  const dir = Math.sign(wind) || 1
  const calm = k < 0.05
  const col = calm ? C.mute : k < 0.35 ? C.green : k < 0.7 ? C.yellow : C.orange
  const t = g.t
  g.shadow(x + 6, y + 14, 96, 40, 0.3)
  g.rrect(x - 96, y - 56, 192, 112, 56, alpha(C.ink, 0.8))
  g.rrect(x - 96, y - 56, 192, 112, 56, undefined, alpha(col, 0.6), 5)
  // The pole, seen from above, at the upwind end; the sock streams downwind.
  const px = x - dir * 62
  const py = y - 10
  const len = calm ? 54 : 70 + 56 * k
  const flap = Math.sin(t * (calm ? 1.4 : 5 + 9 * k)) * (calm ? 0.1 : 0.1 - 0.05 * k)
  g.at(px, py, (dir > 0 ? 0 : Math.PI) + flap, () =>
    sock(g, len, calm ? 0.2 : 0.6 + 0.4 * k, col, t),
  )
  g.ball(px, py, 11, C.yellow, 0.8)
  // Strength chevrons under the sock: none when calm, up to three in a gale.
  const n = calm ? 0 : k < 0.35 ? 1 : k < 0.7 ? 2 : 3
  for (let i = 0; i < n; i++) {
    const cx = x + dir * (i - (n - 1) / 2) * 30
    const pulse = 0.55 + 0.45 * Math.sin(t * 6 - i * 0.9)
    g.alpha(pulse, () =>
      g.path(
        (c) => {
          c.moveTo(cx - dir * 9, y + 22)
          c.lineTo(cx + dir * 8, y + 33)
          c.lineTo(cx - dir * 9, y + 44)
        },
        undefined,
        col,
        7,
      ),
    )
  }
  if (calm) g.line(x - 30, y + 33, x + 30, y + 33, alpha(col, 0.7), 7)
}

/** The sock along +x from its mouth at the origin: orange and white bands, tapering (and sagging when slack). */
function sock(g: Draw, len: number, taut: number, col: string, t: number): void {
  const r0 = 22
  const r1 = 9
  const bands = 4
  const sag = (1 - taut) * 18
  for (let i = bands - 1; i >= 0; i--) {
    const a = i / bands
    const b = (i + 1) / bands
    const wa = r0 + (r1 - r0) * a
    const wb = r0 + (r1 - r0) * b
    const ripple = Math.sin(t * 9 - i * 1.3) * 2.5 * taut
    const sa = sag * a * a
    const sb = sag * b * b
    const fill = i % 2 === 0 ? col : C.white
    g.poly(
      [
        len * a,
        -wa + ripple + sa,
        len * b,
        -wb - ripple + sb,
        len * b,
        wb - ripple + sb,
        len * a,
        wa + ripple + sa,
      ],
      fill,
    )
  }
  g.ellipse(0, 0, 6, r0, shade(col, -0.3))
}

/** Night wash over a lit pitch: team tints at each end, a floodlight pool in the middle. */
export function floodlit(g: Draw, strength = 0.42): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].dark, 0.32)],
      [0.3, alpha(SIDE[1].dark, 0)],
      [0.7, alpha(SIDE[0].dark, 0)],
      [1, alpha(SIDE[0].dark, 0.32)],
    ]),
  )
  g.fillView(
    g.rad(W / 2, MID, H * 0.2, H * 0.72, [
      [0, 'rgba(255,250,230,0.06)'],
      [0.6, 'rgba(0,0,0,0)'],
      [1, `rgba(8,4,20,${strength})`],
    ]),
  )
}

/**
 * The final tally: both totals on a card, the winner's bouncing under a crown.
 * Two copies in local 2P (one per reader), one centred otherwise.
 */
export function tally(
  g: Draw,
  score: [number, number],
  winner: Side | 'draw',
  age: number,
  title: string,
): void {
  if (age < 0) return
  const pop = outBack(clamp01(age / 0.45))
  const fade = clamp01(age / 0.2)
  const one = (angle: number, cy: number) =>
    g.at(
      W / 2,
      cy,
      angle,
      () => {
        g.alpha(fade, () => {
          g.shadow(0, 120, 300, 40, 0.4)
          g.tile(-320, -120, 640, 250, 46, C.ink3, 14)
          g.text(title, 0, -76, { size: 36, weight: 600, color: alpha(C.white, 0.7) })
          for (const side of [0, 1] as Side[]) {
            const x = side === 0 ? -150 : 150
            const won = winner === side
            const bob = won ? Math.sin(age * 7) * 6 : 0
            const s = won ? 1 + 0.12 * outCubic(clamp01((age - 0.3) / 0.3)) : 1
            g.sideMark(side, side === 0 ? x - 104 : x + 104, 14, 14, SIDE[side].main)
            g.text(score[side], x, 18 + bob, {
              size: 96 * s,
              weight: 700,
              color: won ? SIDE[side].light : winner === 'draw' ? C.white : alpha(C.white, 0.5),
              drop: alpha('#000000', 0.4),
            })
            if (won) g.emoji('👑', x, -48 + bob, 54)
          }
          g.text('–', 0, 14, { size: 70, weight: 700, color: alpha(C.white, 0.35) })
        })
      },
      pop,
    )
  if (g.flipTop) {
    one(0, MID + 210)
    one(Math.PI, MID - 210)
  } else one(g.orient(), MID)
}

/** Small helper: a 0..1 pop-in for something stamped at `at`. */
export function popIn(now: number, at: number, dur = 0.35): number {
  return outBack(clamp01((now - at) / dur))
}
