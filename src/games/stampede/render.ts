import type { Side } from '../../core/game.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import { banner, namePill, hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE } from '../../core/render/palette.ts'
import { drawRounds, type Rounds } from '../../engines/reflex/index.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  animalAt,
  BLOB_R,
  type Driver,
  HIT_D,
  type Herd,
  LIVES,
  WARN,
  type World,
} from './rules.ts'
import type { PadLook } from './index.ts'

const SAVANNA = '#1f2d1c'
const DUST = '#c9a878'
const ANIMALS = ['🦬', '🐘', '🦏']

/** The night savanna: team-tinted halves, dusty patches, a few bushes, a moonlit glow. */
function ground(g: Draw): void {
  const v = g.stage.view
  g.rect(v.x - 2, v.y - 2, v.w + 4, MID - v.y + 2, mix(SAVANNA, C.blueDark, 0.16))
  g.rect(v.x - 2, MID, v.w + 4, v.y + v.h - MID + 2, mix(SAVANNA, C.redDark, 0.12))
  for (let i = 0; i < 22; i++) {
    const x = ((i * 397) % 1000) + 20
    const y = ((i * 613) % 1800) + 20
    g.ellipse(x, y, 70 + (i % 4) * 24, 30 + (i % 3) * 12, alpha(DUST, 0.09))
  }
  // Pebbles and grass clumps (fixed).
  for (let i = 0; i < 40; i++) {
    const x = (i * 271) % 1000
    const y = (i * 521) % 1800
    if (i % 3 === 0) g.ellipse(x, y, 9, 6, alpha('#ffffff', 0.07))
    else {
      g.ellipse(x, y, 16, 7, alpha('#000000', 0.12))
      g.ellipse(x, y - 3, 13, 6, alpha('#4f7a3a', 0.5))
    }
  }
  // Floodlight from the middle of the table.
  g.fillView(
    g.rad(W / 2, MID, 120, H * 0.7, [
      [0, 'rgba(255,240,200,0.07)'],
      [1, 'rgba(0,0,0,0.38)'],
    ]),
  )
  g.dashed(v.x, MID, v.x + v.w, MID, alpha(C.white, 0.08), 6, [24, 18])
}

/** Warning before a herd: its whole danger lane shaded, chevrons at the edge it enters from. */
function warnings(g: Draw, w: World): void {
  const now = w.rt
  for (const h of w.herds) {
    const left = h.t0 - now
    if (left <= 0 || left > WARN) continue
    const k = 1 - left / WARN
    const pulse = 0.5 + 0.5 * Math.sin(now * (10 + 16 * k))
    const a = Math.min(1, (WARN - left) * 4)
    g.alpha(a, () => {
      const band = alpha(C.yellow, 0.07 + 0.08 * pulse)
      const edge = alpha(C.yellow, 0.35 + 0.3 * pulse)
      if (h.axis === 0) {
        g.rect(-200, h.lane - HIT_D, W + 400, HIT_D * 2, band)
        g.dashed(0, h.lane - HIT_D, W, h.lane - HIT_D, edge, 5, [22, 20])
        g.dashed(0, h.lane + HIT_D, W, h.lane + HIT_D, edge, 5, [22, 20])
        const x = h.dir > 0 ? 160 : W - 160
        for (let i = 0; i < 3; i++)
          arrow(g, x + h.dir * i * 60, h.lane, h.dir > 0 ? 0 : Math.PI, (pulse + i * 0.3) % 1)
      } else {
        g.rect(h.lane - HIT_D, -200, HIT_D * 2, H + 400, band)
        g.dashed(h.lane - HIT_D, 0, h.lane - HIT_D, H, edge, 5, [22, 20])
        g.dashed(h.lane + HIT_D, 0, h.lane + HIT_D, H, edge, 5, [22, 20])
        const y = h.dir > 0 ? 230 : H - 230
        for (let i = 0; i < 3; i++)
          arrow(
            g,
            h.lane,
            y + h.dir * i * 60,
            h.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
            (pulse + i * 0.3) % 1,
          )
      }
    })
  }
}

/** A chevron pointing `angle` (0 = right). */
function arrow(g: Draw, x: number, y: number, angle: number, pulse: number): void {
  g.at(x, y, angle, () => {
    g.alpha(0.55 + 0.45 * pulse, () => {
      g.poly([-34, -34, 22, 0, -34, 34, -18, 0], C.yellow, C.ink, 6)
    })
  })
}

/** One animal of a herd: a big emoji galloping (bob and tilt), facing its direction of travel. */
function animal(g: Draw, h: Herd, i: number, t: number): void {
  const p = animalAt(h, i, t)
  if (p.x < -160 || p.x > W + 160 || p.y < -160 || p.y > H + 160) return
  const gait = t * 14 + i * 1.7
  const bob = Math.abs(Math.sin(gait)) * -12
  const tilt = Math.sin(gait) * 0.08
  g.shadow(p.x + 6, p.y + 50, 58 - bob * 0.6, 16, 0.4)
  // Emoji animals face left: mirror the ones running right.
  const sx = h.axis === 0 && h.dir > 0 ? -1 : 1
  g.emoji(ANIMALS[h.kind % ANIMALS.length] as string, p.x, p.y + bob, 128, tilt, sx, 1)
}

function blob(g: Draw, side: Side, d: Driver, t: number, real: number): void {
  const col = SIDE[side]
  const { x, y } = d
  const ht = t - d.hitT
  if (d.out) {
    // Trampled flat, with hoof prints.
    const k = outBack(clamp(ht / 0.35, 0, 1))
    g.shadow(x + 4, y + 18, 50, 14, 0.35)
    g.blob(x, y + 14 * k, BLOB_R, mix(col.main, '#6b6880', 0.5), {
      mood: 'dizzy',
      cheeks: false,
      sx: 1 + 0.5 * k,
      sy: 1 - 0.55 * k,
    })
    g.emoji('🐾', x - 18, y + 2, 30, -0.4)
    g.emoji('🐾', x + 22, y + 14, 26, 0.3)
    return
  }
  const blink = t < d.invT && Math.floor(t * 12) % 2 === 0
  const hurt = ht < 0.4
  const squash = hurt
    ? 1 - 0.3 * Math.sin(clamp(ht / 0.4, 0, 1) * Math.PI) * Math.cos(ht * 30)
    : 1 + 0.06 * Math.sin(real * 8 + side)
  g.alpha(blink ? 0.35 : 1, () => {
    g.shadow(x + 4, y + 28, 36, 12, 0.35)
    g.circle(x, y + 4, BLOB_R + 12, alpha(col.main, 0.18))
    g.blob(x, y, BLOB_R, col.main, {
      mood: hurt ? 'dizzy' : 'happy',
      sx: 1 / squash,
      sy: squash,
      look: [0, 0.2],
    })
  })
  g.sideMark(side, x, y - 54, 9, alpha(C.white, 0.95))
}

/** Lives as hearts beside the name pill: the one just lost breaks and floats off. */
function lives(g: Draw, side: Side, d: Driver, t: number): void {
  const y = hudY(g, side)
  const x = side === 0 ? 262 : W - 262
  const ht = t - d.hitT
  g.forSide(side, x, y, () => {
    for (let i = 0; i < LIVES; i++) {
      const hx = (i - 1) * 56
      if (i < d.lives) g.emoji('❤️', hx, 0, 50)
      else {
        g.alpha(0.22, () => g.emoji('🖤', hx, 0, 46))
        if (i === d.lives && ht < 0.5) {
          const k = ht / 0.5
          g.alpha(1 - k, () => g.emoji('💔', hx, -40 * k, 50 * (1 + 0.6 * k)))
        }
      }
    }
  })
}

function pad(g: Draw, side: Side, p: PadLook): void {
  const col = SIDE[side]
  g.alpha(p.on ? 0.95 : 0.45, () => {
    g.circle(p.bx, p.by, 110, alpha(col.dark, 0.4), alpha(col.light, 0.5), 5)
    g.shadow(p.kx + 4, p.ky + 10, 46, 18, 0.35)
    g.ball(p.kx, p.ky, 50, col.main, 0.7)
  })
}

export function renderStampede(
  g: Draw,
  s: World & { rounds: Rounds; pads: [PadLook, PadLook] },
  names: [string, string],
  now: number,
  over: boolean,
  real: number,
): void {
  ground(g)
  // Sticks sit under the herds and blobs: the action stays readable over a thumb.
  for (const side of [0, 1] as Side[]) pad(g, side, s.pads[side])
  warnings(g, s)
  for (const side of [0, 1] as Side[]) {
    const d = s.drivers[side]
    if (d.out) blob(g, side, d, s.rt, real)
  }
  // Draw back to front so lower animals overlap the ones behind them.
  const herds = s.herds.filter((h) => s.rt >= h.t0)
  for (const h of herds) for (let i = h.n - 1; i >= 0; i--) animal(g, h, i, s.rt)
  for (const side of [0, 1] as Side[]) {
    const d = s.drivers[side]
    if (!d.out) blob(g, side, d, s.rt, real)
  }
  for (const side of [0, 1] as Side[]) {
    const d = s.drivers[side]
    namePill(g, side, names[side], { active: false, text: d.out ? 'Trampled!' : undefined })
    lives(g, side, d, s.rt)
  }
  drawRounds(g, s.rounds, now, { over })
  const r = s.rounds
  if (over && r.last !== null) {
    const t = now - r.at
    const w = r.last
    banner(g, undefined, w === 'draw' ? 'Draw!' : `${names[w]} wins!`, MID, {
      size: 64 + 14 * (1 - outBack(clamp(t / 0.35, 0, 1))),
      alpha: clamp(t * 4, 0, 1),
      color: w === 'draw' ? C.yellow : SIDE[w].light,
    })
  }
}
