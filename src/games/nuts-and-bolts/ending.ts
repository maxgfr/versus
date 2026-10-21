import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Fx } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { HEADER, toWorld } from '../../engines/puzzle/index.ts'
import type { Frame } from '../../engines/runner/frame.ts'

/** The winner's moment: hit-stop, a flash in their colour, a shock ring on their board, confetti from their edge. */
export function celebrate(fx: Fx, f: Frame, side: Side): void {
  const c = toWorld(f, f.w / 2, f.h / 2 + HEADER / 2)
  fx.stop(8)
  fx.shake(0.3)
  fx.flash(SIDE[side].light, 0.22)
  fx.ring(c.x, c.y, C.yellow, 460)
  fx.confetti(side)
}

/**
 * A result card over a panel (panel-local, drawn under the timer bar): a veil,
 * then a card that pops in. `win` paints it in the side's colour; otherwise it
 * is a dim card for the player who did not get there first.
 */
export function panelCard(
  g: Draw,
  side: Side,
  w: number,
  h: number,
  now: number,
  at: number,
  o: { title: string; sub?: string; win: boolean },
): void {
  const age = now - at
  if (age < 0) return
  const veil = prog(age, 0, 0.3)
  g.alpha(veil * (o.win ? 0.45 : 0.62), () => g.rect(-20, HEADER, w + 40, h - HEADER + 400, C.ink))
  const s = outBack(prog(age, 0.1, 0.5))
  if (s <= 0) return
  const col = SIDE[side]
  g.at(
    w / 2,
    h / 2 + HEADER / 2,
    0,
    () => {
      g.rrect(-270, -104, 540, 228, 54, alpha('#000000', 0.4))
      g.rrect(-270, -116, 540, 228, 54, o.win ? col.main : shade(col.main, -0.62))
      g.rrect(-270, -116, 540, 228, 54, undefined, o.win ? col.light : alpha(C.white, 0.16), 5)
      g.text(o.title, 0, o.sub ? -40 : -2, {
        size: 70,
        weight: 700,
        color: o.win ? C.white : alpha(C.white, 0.9),
        drop: alpha('#000000', 0.3),
      })
      if (o.sub)
        g.text(o.sub, 0, 42, {
          size: 40,
          weight: 600,
          color: alpha(C.white, 0.78),
          maxWidth: 480,
        })
    },
    s,
  )
}

/** A soft floodlight pool behind the play area, tinted with the side's colour. */
export function floodlight(g: Draw, side: Side, x: number, y: number, r: number): void {
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 0, r, [
      [0, alpha(SIDE[side].main, 0.2)],
      [0.55, alpha(SIDE[side].main, 0.07)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
}
