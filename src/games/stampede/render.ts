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
// Warm-coated runners: they read as a herd from across the table, not as grey rocks.
const ANIMALS = ['🦬', '🐂', '🐎']
const ANIMAL_SIZE = 156

/** The night savanna: team-tinted halves, dusty patches, a few bushes, a moonlit glow. */
function ground(g: Draw): void {
  const v = g.stage.view
  g.rect(v.x - 2, v.y - 2, v.w + 4, MID - v.y + 2, mix(SAVANNA, C.blueDark, 0.28))
  g.rect(v.x - 2, MID, v.w + 4, v.y + v.h - MID + 2, mix(SAVANNA, C.redDark, 0.26))
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
    // Each chevron pops in one after the other, then they all throb faster as the herd nears.
    const pop = (i: number) => outBack(clamp((WARN - left) * 5 - i * 0.6, 0, 1))
    g.alpha(a, () => {
      const band = alpha(C.orange, 0.1 + 0.12 * pulse)
      const edge = alpha(C.yellow, 0.55 + 0.4 * pulse)
      if (h.axis === 0) {
        g.rect(-200, h.lane - HIT_D, W + 400, HIT_D * 2, band)
        g.dashed(0, h.lane - HIT_D, W, h.lane - HIT_D, edge, 7, [30, 18])
        g.dashed(0, h.lane + HIT_D, W, h.lane + HIT_D, edge, 7, [30, 18])
        const x = h.dir > 0 ? 170 : W - 170
        for (let i = 0; i < 3; i++)
          arrow(
            g,
            x + h.dir * i * 78,
            h.lane,
            h.dir > 0 ? 0 : Math.PI,
            (pulse + i * 0.3) % 1,
            pop(i),
          )
      } else {
        g.rect(h.lane - HIT_D, -200, HIT_D * 2, H + 400, band)
        g.dashed(h.lane - HIT_D, 0, h.lane - HIT_D, H, edge, 7, [30, 18])
        g.dashed(h.lane + HIT_D, 0, h.lane + HIT_D, H, edge, 7, [30, 18])
        const y = h.dir > 0 ? 240 : H - 240
        for (let i = 0; i < 3; i++)
          arrow(
            g,
            h.lane,
            y + h.dir * i * 78,
            h.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
            (pulse + i * 0.3) % 1,
            pop(i),
          )
      }
    })
  }
}

/** A chunky chevron pointing `angle` (0 = right), with a glow that throbs. */
function arrow(g: Draw, x: number, y: number, angle: number, pulse: number, scale: number): void {
  if (scale <= 0) return
  g.at(
    x,
    y,
    angle,
    () => {
      g.circle(0, 0, 52, alpha(C.yellow, 0.12 + 0.18 * pulse))
      g.poly([-40, -44, 30, 0, -40, 44, -20, 0], C.ink)
      g.poly([-34, -38, 22, 0, -34, 38, -16, 0], C.yellow)
      g.poly([-34, -38, 22, 0, -16, 0], alpha(C.white, 0.35))
    },
    scale,
  )
}

/** Dust kicked up behind a running animal: soft puffs that trail and fade (time-driven, no state). */
function dust(g: Draw, h: Herd, i: number, t: number): void {
  const p = animalAt(h, i, t)
  if (p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 200) return
  const bx = h.axis === 0 ? -h.dir : 0
  const by = h.axis === 1 ? -h.dir : 0
  for (let j = 0; j < 4; j++) {
    const ph = (t * 3 + j / 4 + i * 0.37) % 1
    const d = 40 + ph * 120
    const r = 22 + ph * 40
    const wob = Math.sin((t + j) * 7 + i) * 14
    g.circle(
      p.x + bx * d + by * wob,
      p.y + 40 + by * d + bx * wob * 0.5,
      r,
      alpha(DUST, 0.32 * (1 - ph)),
    )
  }
}

/** One animal of a herd: a big emoji galloping (bob and tilt), facing its direction of travel. */
function animal(g: Draw, h: Herd, i: number, t: number): void {
  const p = animalAt(h, i, t)
  if (p.x < -160 || p.x > W + 160 || p.y < -160 || p.y > H + 160) return
  const gait = t * 14 + i * 1.7
  const bob = Math.abs(Math.sin(gait)) * -12
  const tilt = Math.sin(gait) * 0.08
  // A hot ground glow under each animal marks the danger zone at a glance.
  g.circle(
    p.x,
    p.y + 30,
    84,
    g.rad(p.x, p.y + 30, 10, 84, [
      [0, alpha(C.orange, 0.42)],
      [1, alpha(C.orange, 0)],
    ]),
  )
  g.shadow(p.x + 6, p.y + 60, 62 - bob * 0.6, 15, 0.3)
  // Emoji animals face left: mirror the ones running right.
  const sx = h.axis === 0 && h.dir > 0 ? -1 : 1
  g.emoji(ANIMALS[h.kind % ANIMALS.length] as string, p.x, p.y + bob, ANIMAL_SIZE, tilt, sx, 1)
}

function blob(
  g: Draw,
  side: Side,
  d: Driver,
  t: number,
  real: number,
  at: [number, number],
  spring: number,
): void {
  const col = SIDE[side]
  const [x, y] = at
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
  const squash =
    (hurt
      ? 1 - 0.3 * Math.sin(clamp(ht / 0.4, 0, 1) * Math.PI) * Math.cos(ht * 30)
      : 1 + 0.06 * Math.sin(real * 8 + side)) * clamp(spring, 0.7, 1.4)
  // A sprint leaves a dusty smear behind the blob.
  const sprint = t - d.dashT
  if (sprint >= 0 && sprint < 0.25) {
    const a = 1 - sprint / 0.25
    for (let i = 1; i <= 3; i++)
      g.alpha(a * 0.2 * (4 - i), () =>
        g.circle(x - d.dx * i * 30, y - d.dy * i * 30, BLOB_R * (1 - i * 0.12), col.light),
      )
  }
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
  look: { at: [number, number][]; squash: [number, number]; rt: number },
): void {
  ground(g)
  // Sticks sit under the herds and blobs: the action stays readable over a thumb.
  // Online, each phone shows only its own player's stick.
  for (const side of [0, 1] as Side[])
    if (g.viewer === null || side === g.viewer) pad(g, side, s.pads[side])
  warnings(g, s)
  const at = (side: Side): [number, number] =>
    look.at[side] ?? [s.drivers[side].x, s.drivers[side].y]
  for (const side of [0, 1] as Side[]) {
    const d = s.drivers[side]
    if (d.out) blob(g, side, d, s.rt, real, at(side), look.squash[side])
  }
  // Draw back to front so lower animals overlap the ones behind them.
  const rt = look.rt
  const herds = s.herds.filter((h) => rt >= h.t0)
  for (const h of herds) for (let i = 0; i < h.n; i++) dust(g, h, i, rt)
  for (const h of herds) for (let i = h.n - 1; i >= 0; i--) animal(g, h, i, rt)
  for (const side of [0, 1] as Side[]) {
    const d = s.drivers[side]
    if (!d.out) blob(g, side, d, s.rt, real, at(side), look.squash[side])
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
