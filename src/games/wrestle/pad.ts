import type { Side } from '../../core/game.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'

/**
 * A player's half of the table as their control pad: the whole half is the tap
 * zone, and its centre holds a big glossy button that fills up while the move
 * recharges, squashes on every tap and doubles as the player's message board
 * ("GOAL!", "Round 2"). Laid out once as red sees it; blue's is turned to face
 * blue (and to face the viewer in 1P / online).
 */

export interface PadMsg {
  text: string
  sub?: string
  /** Seconds since the message appeared (state-stamped, so the guest sees it too). */
  age: number
  color?: string
  /** Big headline (a goal, a win) rather than an announcement. */
  big?: boolean
  glyph?: string
}

export interface PadView {
  side: Side
  /** Emoji printed on the button. */
  glyph: string
  /** Hint under the button ("Tap to kick"); empty hides it. */
  label: string
  /** Colour of the hint (e.g. yellow for a running-out clock). */
  labelColor?: string
  /** 0..1 recharge; 1 = ready to go. */
  ready: number
  /** Seconds since the last tap (large when never). */
  pressAge: number
  time: number
  msg?: PadMsg | null
}

/** Distance of each pad's centre from the midline. */
const PAD_D = 585
const R = 104

/** Centre of a side's pad, in world coordinates. */
export function padCenter(side: Side): { x: number; y: number } {
  return { x: W / 2, y: side === 0 ? MID + PAD_D : MID - PAD_D }
}

/** Tint the half between the band and the player's edge, with a rim light on the band side. */
export function padRegion(g: Draw, side: Side, bandEdge: number, pressAge: number): void {
  const v = g.stage.view
  const col = SIDE[side]
  const top = side === 0 ? bandEdge : v.y - 2
  const bot = side === 0 ? v.y + v.h + 2 : bandEdge
  const pulse = clamp(1 - pressAge / 0.25, 0, 1)
  const far = side === 0 ? bot : top
  g.rect(
    v.x - 2,
    top,
    v.w + 4,
    bot - top,
    g.lin(0, bandEdge, 0, far, [
      [0, shade(col.main, -0.62 + pulse * 0.06)],
      [1, shade(col.main, -0.8)],
    ]),
  )
  const dir = side === 0 ? 1 : -1
  g.rect(v.x - 2, bandEdge, v.w + 4, dir * (8 + pulse * 10), alpha(col.main, 0.55 + pulse * 0.45))
}

/** The button, its recharge ring and the message plaque, upright for its player. */
export function drawPad(g: Draw, p: PadView): void {
  const { x, y } = padCenter(p.side)
  const col = SIDE[p.side]
  const msg = p.msg
  // The message takes over the pad while it shows.
  const msgIn = msg ? clamp(msg.age / 0.3, 0, 1) : 0
  g.forSide(p.side, x, y, () => {
    const by = -18
    g.alpha(1 - msgIn * 0.85, () => {
      // Soft floodlight pool on the table under the button.
      g.circle(
        0,
        by,
        R * 2.4,
        g.rad(0, by, R * 0.6, R * 2.4, [
          [0, alpha(col.main, 0.22 + 0.12 * (p.ready >= 1 ? 1 : 0))],
          [1, alpha(col.main, 0)],
        ]),
      )
      // Recharge ring: a track, then the filled part sweeping clockwise from the top.
      g.ring(0, by, R + 26, alpha(C.white, 0.1), 12)
      const ready = p.ready >= 1
      if (p.ready > 0) {
        const glow = ready ? 0.75 + 0.25 * Math.sin(p.time * 5) : 0.6
        g.arc(
          0,
          by,
          R + 26,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * clamp(p.ready, 0, 1),
          alpha(ready ? col.light : col.main, glow),
          12,
        )
      }
      // Press: sink into the lip, then spring back.
      const t = p.pressAge
      const press = t < 0.08 ? t / 0.08 : t < 0.3 ? 1 - outCubic((t - 0.08) / 0.22) : 0
      const breathe = ready ? 1 + 0.025 * Math.sin(p.time * 5) : 1
      const depth = 16 * (1 - press * 0.8)
      const face = ready ? col.main : shade(col.main, -0.35)
      g.at(
        0,
        by + (16 - depth),
        0,
        () => {
          g.circle(0, depth, R, shade(face, -0.45))
          g.circle(
            0,
            0,
            R,
            g.rad(
              0,
              0,
              R * 0.1,
              R,
              [
                [0, shade(face, 0.3)],
                [0.7, face],
                [1, shade(face, -0.18)],
              ],
              -R * 0.3,
              -R * 0.4,
            ),
          )
          g.ring(0, 0, R - 5, alpha(C.white, 0.18), 5)
          g.alpha(0.5, () => g.ellipse(-R * 0.34, -R * 0.46, R * 0.34, R * 0.18, '#fff', -0.5))
          g.alpha(ready ? 1 : 0.55, () => g.emoji(p.glyph, 0, 4, R * 0.95))
        },
        breathe * (1 + press * 0.06),
        breathe * (1 - press * 0.1),
      )
      if (p.label) {
        g.text(p.label, 0, by + R + 74, {
          size: 38,
          weight: 600,
          color: p.labelColor ?? alpha(C.white, ready ? 0.8 : 0.45),
        })
      }
    })
    if (msg && msgIn > 0) plaque(g, msg, col.main)
  })
}

function plaque(g: Draw, m: PadMsg, team: string): void {
  const s = outBack(clamp(m.age / 0.35, 0, 1))
  const fade = clamp(m.age / 0.12, 0, 1)
  g.alpha(fade, () =>
    g.at(
      0,
      -10,
      0,
      () => {
        const size = m.big ? 120 : 76
        const color = m.color ?? C.white
        if (m.glyph) {
          const bob = Math.sin(m.age * 6) * 8
          g.emoji(m.glyph, 0, -size * 0.95 + bob, size * 0.95)
        }
        g.text(m.text, 0, 0, {
          size,
          weight: 700,
          color,
          stroke: shade(team, -0.6),
          strokeWidth: size * 0.16,
          drop: alpha('#000000', 0.45),
        })
        if (m.sub)
          g.text(m.sub, 0, size * 0.62 + 30, {
            size: 40,
            weight: 600,
            color: alpha(C.white, 0.85),
          })
      },
      s,
    ),
  )
}
