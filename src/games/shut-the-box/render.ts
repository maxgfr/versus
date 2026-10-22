import { inQuad, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { toLocal } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import {
  type ButtonLayout,
  drawRollButton,
  drawTray,
  inFrame,
  ROLL_TIME,
  textAngle,
  trayLayout,
} from '../../engines/dice/index.ts'
import { drawThrownDice, TAP_POW } from '../yazy/throw.ts'
import type { State } from './index.ts'
import { countOf, subsetsSumming, sumOf, TILES } from './rules.ts'

/**
 * Layout in red's frame (bottom half). Blue's box is the same turned 180°, so
 * blue reads its own tiles upright. Each tile is a wooden flap hinged along
 * `base` that flips down when shut.
 */
export const BOX = { x0: 56, tw: 88, gap: 12, top: 1150, base: 1400 }
const BOX_W = TILES * BOX.tw + (TILES - 1) * BOX.gap
const BOX_H = BOX.base - BOX.top
const LIFT = 30
/** A flap falls for FALL s, then bounces for BOUNCE s; flaps go one after another. */
export const FALL = 0.22
const BOUNCE = 0.2
export const FLIP_STEP = 0.07
export const ACTION: ButtonLayout = { x: 500, y: 1572, w: 340, h: 104 }
const PLAQUE = { x: 172, w: 236, h: 88 }
const CHIP_X = 828
export const DICE_Y = 900
const DIE = 150
/** Where the roll total shows, beside the dice (red's frame). */
export const SUM_AT = { x: 822, y: DICE_Y }
/** How long the box's score stamp takes to arrive after a turn ends. */
const STAMP_IN = 0.45

const MAPLE = '#f2d29b'
const MAPLE_DARK = '#d9a964'
const CARVE = '#6e4220'

/** Left edge of tile `i` (0-based) in red's frame. */
export const tileX = (i: number): number => BOX.x0 + i * (BOX.tw + BOX.gap)

/** The dice tray for `n` dice, centred on the table. */
export const diceTray = (n: number) => trayLayout(n, DICE_Y, DIE)

/** Tile (0-based) under a world point on `side`'s box, or -1. Lifted tiles still count. */
export function tileAt(side: Side, wx: number, wy: number): number {
  const p = toLocal(side, wx, wy)
  if (p.y < BOX.top - 60 || p.y > BOX.base + 60) return -1
  for (let i = 0; i < TILES; i++) {
    if (p.x >= tileX(i) - 6 && p.x <= tileX(i) + BOX.tw + 6) return i
  }
  return -1
}

/** Is a world point over the dice (where a tap rolls)? */
export function overDice(wx: number, wy: number): boolean {
  const t = diceTray(2)
  return wx >= t.x - 20 && wx <= t.x + t.w + 20 && wy >= t.y - 20 && wy <= t.y + t.h + 20
}

/** The dice have landed and show the roll to match. */
export const landed = (s: State, now: number): boolean =>
  s.roll > 0 && now - s.rolledAt >= ROLL_TIME

/** Tiles that can still be part of a set making the roll, given what is already picked. */
export function candidates(open: number, roll: number, sel: number): number {
  let m = 0
  for (const set of subsetsSumming(open, roll)) if ((set & sel) === sel) m |= set
  return m
}

/** Flap angle (0 = standing, π/2 = down) for tile `i` that started flipping at `flipAt`. */
function flapAngle(now: number, flipAt: number, order: number): number {
  const t = now - flipAt - order * FLIP_STEP
  if (t <= 0) return 0
  if (t < FALL) return inQuad(t / FALL) * (Math.PI / 2)
  const q = prog(t, FALL, FALL + BOUNCE)
  return Math.PI / 2 - Math.sin(Math.PI * q) * (1 - q) * 0.45
}

function drawFlap(
  g: Draw,
  i: number,
  theta: number,
  lift: number,
  o: { sel: boolean; dim: boolean; ta: number; glow: number },
): void {
  const tx = tileX(i)
  const base = BOX.base - lift
  const c = Math.cos(theta)
  const hgt = Math.max(BOX_H * c, 26)
  const back = theta > Math.PI / 4
  if (lift > 0) g.shadow(tx + BOX.tw / 2, BOX.base + 4, BOX.tw * 0.5, 12, 0.45)
  if (back) {
    // The underside of a fallen flap: darker, plain wood.
    g.tile(tx, base - hgt, BOX.tw, hgt, 12, shade(C.wood, -0.22), Math.min(10, hgt * 0.3))
    g.rrect(tx + 8, base - hgt + 5, BOX.tw - 16, 5, 3, alpha('#ffffff', 0.12))
    return
  }
  const face = o.sel ? C.yellow : MAPLE
  const depth = Math.min(14, hgt * 0.1)
  g.rrect(
    tx,
    base - hgt + depth,
    BOX.tw,
    hgt - depth,
    14,
    shade(o.sel ? C.yellow : MAPLE_DARK, -0.3),
  )
  g.rrect(
    tx,
    base - hgt,
    BOX.tw,
    hgt - depth,
    14,
    g.lin(0, base - hgt, 0, base - depth, [
      [0, shade(face, 0.18)],
      [1, o.sel ? shade(C.yellow, -0.08) : MAPLE_DARK],
    ]),
  )
  // Grain.
  g.alpha(0.18, () => {
    for (let k = 0; k < 3; k++) {
      const gx = tx + 20 + k * 24 + ((i * 7) % 9) - 4
      g.line(gx, base - hgt + 18, gx + 4, base - depth - 16, CARVE, 2)
    }
  })
  g.rrect(tx + 6, base - hgt + 4, BOX.tw - 12, (hgt - depth) * 0.3, 10, alpha('#ffffff', 0.28))
  if (hgt > 110) {
    const ny = base - depth - (hgt - depth) * 0.42
    g.at(tx + BOX.tw / 2, ny, o.ta, () => {
      g.text(i + 1, 0, 3, { size: 66, weight: 700, color: alpha('#ffffff', 0.45) })
      g.text(i + 1, 0, 0, { size: 66, weight: 700, color: o.sel ? C.ink : CARVE })
    })
  }
  if (o.sel) g.rrect(tx - 5, base - hgt - 5, BOX.tw + 10, hgt + 10, 18, undefined, C.white, 5)
  if (o.glow > 0)
    g.alpha(o.glow, () => g.rrect(tx, base - hgt, BOX.tw, hgt - depth, 14, alpha(C.red, 0.55)))
  if (o.dim) g.rrect(tx, base - hgt, BOX.tw, hgt, 14, alpha(C.ink, 0.5))
}

function drawBox(g: Draw, side: Side, s: State, now: number, mine: boolean): void {
  const col = SIDE[side]
  const open = s.open[side]
  const flipping = s.flipSide === side ? s.flipMask : 0
  const choosing = mine && landed(s, now) && !s.stuck
  const sel = mine ? s.sel : 0
  const cand = choosing ? candidates(open, s.roll, sel) : ALL
  const ta = textAngle(g, side)
  const x0 = BOX.x0 - 30
  const y0 = BOX.top - 36
  const w = BOX_W + 60
  const h = BOX_H + 116
  // Open tiles throb red while a dead roll is shown: these are the points you keep.
  const stuckGlow =
    mine && s.stuck && landed(s, now) ? 0.5 + 0.5 * Math.sin((now - s.rolledAt) * 10) : 0
  inFrame(g, side, () => {
    g.shadow(500, y0 + h + 6, w * 0.52, 30, 0.5)
    if (mine) {
      g.alpha(0.35 + 0.2 * Math.sin(now * 5), () =>
        g.rrect(x0 - 14, y0 - 14, w + 28, h + 28, 56, undefined, col.main, 10),
      )
    }
    // Wooden box with a felt well in the team colour.
    g.tile(x0, y0, w, h, 42, C.wood, 26)
    g.rrect(
      BOX.x0 - 12,
      BOX.top - 16,
      BOX_W + 24,
      BOX_H + 30,
      26,
      g.lin(0, BOX.top, 0, BOX.base, [
        [0, shade(col.main, -0.72)],
        [1, shade(col.main, -0.55)],
      ]),
    )
    g.rrect(BOX.x0 - 12, BOX.top - 16, BOX_W + 24, 16, 8, alpha('#000000', 0.3))
    // Front rim: carved numbers under each flap, lit when the flap is down.
    for (let i = 0; i < TILES; i++) {
      const down = !(open & (1 << i))
      g.at(tileX(i) + BOX.tw / 2, BOX.base + 46, ta, () => {
        g.text(i + 1, 0, 2, { size: 36, weight: 700, color: alpha('#ffffff', 0.25) })
        g.text(i + 1, 0, 0, {
          size: 36,
          weight: 700,
          color: down ? shade(C.wood, -0.62) : alpha(shade(C.wood, -0.5), 0.55),
        })
      })
    }
    for (let i = 0; i < TILES; i++) {
      const bit = 1 << i
      let theta = 0
      if (flipping & bit) theta = flapAngle(now, s.flipAt, countOf(flipping & (bit - 1)))
      else if (!(open & bit)) theta = Math.PI / 2
      const picked = !!(open & bit && sel & bit)
      const lift = picked ? LIFT * outBack(prog(now - s.selAt[i]!, 0, 0.18)) : 0
      drawFlap(g, i, theta, lift, {
        sel: picked,
        dim: choosing && !!(open & bit) && !(cand & bit),
        ta,
        glow: open & bit ? stuckGlow * 0.6 : 0,
      })
    }
  })
}

const ALL = (1 << TILES) - 1

function actionLabel(
  s: State,
  side: Side,
  now: number,
  over: boolean,
): { label: string; enabled: boolean; pulse: boolean } {
  const mine = s.turn === side && !over
  if (!mine) {
    const done = s.scores[side] !== null
    return { label: done || over ? 'Done' : 'Next', enabled: false, pulse: false }
  }
  if (s.roll === 0) return { label: 'Roll', enabled: true, pulse: true }
  if (!landed(s, now)) return { label: 'Rolling…', enabled: false, pulse: false }
  if (s.stuck) return { label: 'No move', enabled: false, pulse: false }
  const got = sumOf(s.sel)
  if (s.sel === 0) return { label: `Make ${s.roll}`, enabled: false, pulse: false }
  if (got === s.roll) return { label: `Shut ${s.roll}!`, enabled: true, pulse: true }
  return { label: `${got} of ${s.roll}`, enabled: false, pulse: false }
}

/** Open total (or final score) plaque, left of the button; counts down as tiles drop. */
function drawPlaque(g: Draw, side: Side, s: State, now: number): void {
  const ta = textAngle(g, side)
  const col = SIDE[side]
  const done = s.scores[side]
  let value = done ?? sumOf(s.open[side])
  let bump = 1
  if (s.flipSide === side && s.flipMask) {
    const t = now - s.flipAt
    const n = countOf(s.flipMask)
    const k = outCubic(prog(t, 0, FALL + n * FLIP_STEP))
    value = Math.round(value + sumOf(s.flipMask) * (1 - k))
    bump = 1 + 0.1 * Math.sin(Math.PI * prog(t, 0, 0.4))
  }
  inFrame(g, side, () =>
    g.at(
      PLAQUE.x,
      ACTION.y,
      0,
      () => {
        g.tile(-PLAQUE.w / 2, -PLAQUE.h / 2, PLAQUE.w, PLAQUE.h, 26, shade(col.main, -0.62), 8)
        g.at(0, -4, ta, () => {
          g.text(done === null ? 'Open' : 'Score', -PLAQUE.w / 2 + 20, 0, {
            size: 34,
            weight: 600,
            align: 'left',
            color: alpha(C.white, 0.7),
          })
          g.text(value, PLAQUE.w / 2 - 18, 0, {
            size: 58,
            weight: 700,
            align: 'right',
            color: col.light,
            drop: alpha('#000000', 0.35),
          })
        })
      },
      bump,
    ),
  )
}

/** "Beat 31": the score to get under, once the other player has finished. */
function drawTarget(g: Draw, side: Side, s: State, over: boolean): void {
  const o = side === 0 ? 1 : 0
  const target = s.scores[o]
  if (target === null || s.scores[side] !== null || over) return
  const ta = textAngle(g, side)
  inFrame(g, side, () =>
    g.at(CHIP_X, ACTION.y, 0, () => {
      g.rrect(-112, -40, 224, 80, 40, alpha(C.ink, 0.7), alpha(SIDE[o].main, 0.8), 4)
      g.at(0, -2, ta, () => {
        g.sideMark(o, -70, 0, 13)
        g.text(`Beat ${target}`, 14, 0, { size: 38, weight: 700, color: C.white })
      })
    }),
  )
}

/** The roll total in a yellow disc beside the dice, upright for the roller. */
function drawRollSum(g: Draw, s: State, now: number): void {
  if (s.roll === 0) return
  const t = now - s.rolledAt - ROLL_TIME
  if (t < 0) return
  const side = s.turn
  const k = outBack(prog(t, 0, 0.3))
  const shake = s.stuck ? Math.sin(t * 40) * 8 * (1 - prog(t, 0, 0.5)) : 0
  inFrame(g, side, () =>
    g.at(
      SUM_AT.x + shake,
      SUM_AT.y,
      textAngle(g, side),
      () => {
        const colr = s.stuck ? C.ink4 : C.yellow
        g.disc(0, 0, 62, colr, 10)
        g.text(s.roll, 0, -2, {
          size: 70,
          weight: 700,
          color: s.stuck ? alpha(C.white, 0.8) : C.ink,
        })
      },
      k,
    ),
  )
}

/** "No move" across the box once a dead roll has landed. */
function drawStuck(g: Draw, s: State, now: number): void {
  if (!s.stuck || !landed(s, now)) return
  const t = now - s.rolledAt - ROLL_TIME
  const k = outBack(prog(t, 0, 0.3))
  const side = s.turn
  inFrame(g, side, () =>
    g.at(
      500,
      (BOX.top + BOX.base) / 2,
      textAngle(g, side),
      () => {
        g.rrect(-230, -54, 460, 108, 54, alpha(C.ink, 0.88), alpha(C.white, 0.2), 4)
        g.text('No move!', 0, 2, { size: 60, weight: 700, color: C.white })
      },
      k,
    ),
  )
}

/** A stamped score over a box once its turn is over; the winner's turns gold. */
function drawStamp(g: Draw, side: Side, s: State, now: number): void {
  const score = s.scores[side]
  if (score === null) return
  const at = s.doneAt[side]
  const t = now - at
  if (t < 0) return
  const won = s.end !== null && s.end.winner === side && now >= s.end.at + 0.3
  const draw = s.end !== null && s.end.winner === 'draw' && now >= s.end.at + 0.3
  const k = outBack(prog(t, 0, STAMP_IN))
  const big = 1 + 0.6 * (1 - outCubic(prog(t, 0, STAMP_IN)))
  const ta = textAngle(g, side)
  inFrame(g, side, () => {
    g.alpha(0.45 * prog(t, 0, 0.3), () =>
      g.rrect(BOX.x0 - 12, BOX.top - 16, BOX_W + 24, BOX_H + 30, 26, C.ink),
    )
    g.at(
      500,
      (BOX.top + BOX.base) / 2 - 10,
      -0.06,
      () => {
        const w = 400
        const h = 170
        if (won) {
          g.alpha(0.35 + 0.2 * Math.sin(now * 6), () =>
            g.rrect(-w / 2 - 16, -h / 2 - 16, w + 32, h + 32, 60, C.yellow),
          )
        }
        const face = won ? C.yellow : draw ? C.ink4 : shade(SIDE[side].main, -0.42)
        g.tile(-w / 2, -h / 2, w, h, 48, face, 14)
        g.at(0, -6, ta, () => {
          const label = won ? (score === 0 ? 'Shut!' : 'Winner!') : draw ? 'Draw' : 'Score'
          g.text(label, 0, -38, {
            size: 44,
            weight: 700,
            color: won ? C.ink : alpha(C.white, 0.8),
          })
          g.text(score, 0, 30, {
            size: 84,
            weight: 700,
            color: won ? C.ink : C.white,
            drop: alpha('#000000', won ? 0.15 : 0.35),
          })
        })
        if (won) {
          for (let i = 0; i < 3; i++) {
            const a = now * 1.4 + (i * Math.PI * 2) / 3
            g.star(Math.cos(a) * (w / 2 + 8), Math.sin(a) * (h / 2 + 4), 22, C.white, 5, 0.45, a)
          }
        }
      },
      k * big,
    )
  })
}

/** "Beat 31" banner on the second player's half as their turn starts. */
function drawHandover(g: Draw, s: State, now: number): void {
  const t = now - s.turnAt
  if (s.turnAt < 0 || t < 0 || t > 2.2) return
  const side = s.turn
  const o = side === 0 ? 1 : 0
  const target = s.scores[o]
  if (target === null) return
  const a = Math.min(prog(t, 0, 0.2), 1 - prog(t, 1.8, 2.2))
  const k = outBack(prog(t, 0, 0.35))
  inFrame(g, side, () =>
    g.alpha(a, () =>
      g.at(
        500,
        (BOX.top + BOX.base) / 2,
        textAngle(g, side),
        () => {
          g.rrect(-300, -62, 600, 124, 62, mix(C.ink, SIDE[side].main, 0.35), C.yellow, 5)
          g.text(`To beat: ${target}`, 0, 2, { size: 52, weight: 700, color: C.white })
        },
        k,
      ),
    ),
  )
}

export function renderShut(g: Draw, s: State, now: number, over: boolean, rattle = 0): void {
  for (const side of [0, 1] as Side[]) {
    const mine = s.turn === side && !over
    drawBox(g, side, s, now, mine)
    const act = actionLabel(s, side, now, over)
    // Online, each phone shows only its own button.
    if (g.viewer === null || g.viewer === side)
      drawRollButton(g, side, ACTION, act.label, { enabled: act.enabled, pulse: act.pulse })
    drawPlaque(g, side, s, now)
    drawTarget(g, side, s, over)
  }
  const tray = diceTray(s.dice.length)
  drawTray(g, tray, over ? null : s.turn)
  drawThrownDice(
    g,
    tray,
    { dice: s.dice, held: s.dice.map(() => false), rolls: 1, rolledAt: s.rolledAt },
    now,
    s.pow ?? TAP_POW,
    { dim: s.roll === 0 && !over, rattle: s.roll === 0 && !over ? Math.max(rattle, 0.2) : 0 },
  )
  drawRollSum(g, s, now)
  drawStuck(g, s, now)
  for (const side of [0, 1] as Side[]) drawStamp(g, side, s, now)
  if (!over) drawHandover(g, s, now)
}
