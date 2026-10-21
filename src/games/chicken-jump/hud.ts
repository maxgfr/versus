import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'

/**
 * Lane HUD pieces, drawn in lane-local coordinates (the frame turns them to
 * face the lane's owner). All animation is driven by timestamps carried in the
 * game state, so the online guest sees the same pops as the host.
 */

/** 0..1 pop curve for something that happened `t` seconds ago (1 at the peak, 0 when settled). */
export function pop(t: number, dur = 0.28): number {
  if (t < 0 || t >= dur) return 0
  return Math.sin((t / dur) * Math.PI)
}

/**
 * The lane's counter: a chunky pill with the owner's mark (circle for red,
 * square for blue), the value, and the player's name. `since` is the time since
 * the value last changed: the pill bumps and the value flashes yellow.
 */
export function counterPill(
  g: Draw,
  side: Side,
  value: string | number,
  label: string,
  x: number,
  y: number,
  since = 9,
): void {
  const col = SIDE[side]
  const k = pop(since)
  const vw = g.measure(String(value), 62, 700)
  const lw = g.measure(label, 34, 600)
  const w = vw + lw + 132
  g.at(
    x,
    y,
    0,
    () => {
      g.rrect(-w / 2, -40, w, 88, 44, alpha('#000000', 0.32))
      g.rrect(-w / 2, -46, w, 88, 44, alpha(C.ink, 0.86), alpha(col.main, 0.9), 5)
      // Badge with the side's mark.
      g.circle(-w / 2 + 44, -2, 30, col.main)
      g.alpha(0.35, () => g.ellipse(-w / 2 + 36, -14, 14, 8, '#ffffff', -0.5))
      g.sideMark(side, -w / 2 + 44, -2, 12, C.white)
      g.text(value, -w / 2 + 88, 1, {
        size: 62,
        weight: 700,
        align: 'left',
        color: k > 0.05 ? C.yellow : C.white,
      })
      g.text(label, -w / 2 + 104 + vw, 2, {
        size: 34,
        weight: 600,
        align: 'left',
        color: col.light,
      })
    },
    1 + 0.16 * k,
  )
}

/**
 * Rounds won, as sockets in the side's shape. A pip won `since` seconds ago
 * (the last one) lands with a bounce.
 */
export function winPips(
  g: Draw,
  side: Side,
  wins: number,
  target: number,
  x: number,
  y: number,
  since = 9,
): void {
  const col = SIDE[side]
  for (let i = 0; i < target; i++) {
    const px = x + i * 58
    g.sideMark(side, px, y + 4, 22, alpha('#000000', 0.25))
    g.sideMark(side, px, y, 22, alpha(C.ink, 0.45))
    if (i >= wins) {
      g.alpha(0.75, () =>
        side === 0
          ? g.ring(px, y, 19, C.white, 4)
          : g.rrect(px - 17, y - 17, 34, 34, 8, undefined, C.white, 4),
      )
      continue
    }
    const fresh = i === wins - 1
    const s = fresh ? outBack(prog(since, 0, 0.4)) : 1
    if (s <= 0.01) continue
    g.at(
      px,
      y,
      0,
      () => {
        g.sideMark(side, 0, 0, 20, col.main)
        g.alpha(0.6, () => g.ellipse(-6, -8, 7, 4, '#ffffff', -0.5))
      },
      s,
    )
    if (fresh && since < 0.6) {
      g.alpha(1 - since / 0.6, () => g.ring(px, y, 22 + since * 90, C.yellow, 5))
    }
  }
}

export interface CardOpts {
  /** Seconds since the card appeared (drives the pop-in). */
  t: number
  sub?: string
  color?: string
  /** Team colour for the top band. */
  accent?: string
  /** Emoji badge bobbing above the card. */
  emoji?: string
  /** Bigger title for the match's last word. */
  big?: boolean
}

/** A chunky centre card: dark tile, team band on top, title, subtitle, optional emoji badge. */
export function laneCard(g: Draw, title: string, x: number, y: number, o: CardOpts): void {
  const s = outBack(prog(o.t, 0, 0.35))
  if (s <= 0.01) return
  const size = o.big ? 92 : 74
  const w = Math.max(440, g.measure(title, size, 700) + 130)
  const h = o.sub ? size + 104 : size + 70
  const accent = o.accent ?? C.ink4
  g.at(
    x,
    y,
    0,
    () => {
      const top = -h / 2
      g.rrect(-w / 2, top + 12, w, h, 40, alpha('#000000', 0.35))
      g.rrect(-w / 2, top, w, h, 40, shade(C.ink2, -0.1))
      g.clip(-w / 2, top, w, h, 40, () => {
        g.rect(-w / 2, top, w, 14, accent)
        g.rect(-w / 2, top + 14, w, 5, alpha(accent, 0.35))
      })
      g.rrect(-w / 2, top, w, h, 40, undefined, alpha(accent, 0.65), 4)
      const ty = o.sub ? top + 26 + size * 0.62 : 6
      g.text(title, 0, ty, {
        size,
        weight: 700,
        color: o.color ?? C.white,
        drop: alpha('#000000', 0.45),
      })
      if (o.sub) {
        g.text(o.sub, 0, ty + size * 0.5 + 34, {
          size: 36,
          weight: 600,
          color: alpha(C.white, 0.78),
        })
      }
      if (o.emoji) {
        const bob = Math.sin(o.t * 5) * 6
        g.circle(0, top - 6 + bob, 46, shade(C.ink2, -0.1))
        g.ring(0, top - 6 + bob, 46, alpha(accent, 0.65), 4)
        g.emoji(o.emoji, 0, top - 8 + bob, 60)
      }
    },
    s,
  )
}
