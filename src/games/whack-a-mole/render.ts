import type { Side } from '../../core/game.ts'
import { inQuad, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { banner, clock, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { Cell, State } from './index.ts'
import { HOLES, holeXY } from './rules.ts'

/*
 * Each half is a floodlit lawn with nine holes. Holes and creatures are drawn
 * in the owner's frame, so moles pop up toward their owner and face them.
 */

const SOIL = '#2a1a0e'
const DIRT = '#6b4a2b'
const LAWN = '#173d24'
const FUR = '#9a6638'
/** The lawn bed holding a player's nine holes, in red's frame: x, y, w, h, radius. */
const BED = [92, 1036, 816, 628, 56] as const

function field(g: Draw, glow: [number, number]): void {
  const v = g.stage.view
  // Each half belongs to its player: a dark team-coloured table...
  g.halves(shade(C.red, -0.74), shade(C.blue, -0.74))
  for (const side of [0, 1] as Side[]) {
    if (glow[side] > 0) {
      const y0 = side === 0 ? MID : v.y - 2
      const y1 = side === 0 ? v.y + v.h + 2 : MID
      g.alpha(glow[side] * 0.3, () => g.rect(v.x - 2, y0, v.w + 4, y1 - y0, SIDE[side].main))
    }
    // ...with a mown lawn bed for the nine holes, framed in the team colour.
    inFrame(g, side, () => {
      const [x, y, w, h, r] = BED
      g.rrect(x - 14, y - 6, w + 28, h + 28, r + 12, alpha('#000000', 0.35))
      g.rrect(x - 14, y - 14, w + 28, h + 28, r + 12, shade(SIDE[side].main, -0.35))
      g.rrect(x - 6, y - 6, w + 12, h + 12, r + 6, shade(SIDE[side].main, -0.6))
      g.clip(x, y, w, h, r, () => {
        g.rect(x, y, w, h, mix(LAWN, SIDE[side].main, 0.1))
        for (let k = 0; k < h; k += 140) g.rect(x, y + k, w, 70, alpha('#000000', 0.1))
        // A floodlight pool on each bed.
        g.ellipse(
          W / 2,
          1350,
          520,
          380,
          g.rad(W / 2, 1350, 0, 520, [
            [0, alpha('#fff6d8', 0.16)],
            [1, alpha('#fff6d8', 0)],
          ]),
        )
        g.rect(x, y, w, 26, alpha('#000000', 0.18))
      })
    })
  }
  // The middle strip between the two halves.
  g.rect(v.x - 2, MID - 5, v.w + 4, 10, alpha(C.white, 0.16))
  g.vignette(0.45)
}

/** A hole in the lawn: a mound of dirt around a dark pit. */
function hole(g: Draw, x: number, y: number, hot: number): void {
  g.ellipse(x, y + 16, 112, 62, alpha('#000000', 0.35))
  g.ellipse(x, y + 6, 108, 60, shade(DIRT, -0.2))
  g.ellipse(x, y, 104, 56, DIRT)
  g.ellipse(x - 30, y - 30, 30, 10, alpha('#ffffff', 0.12), -0.2)
  if (hot > 0) g.alpha(hot, () => g.ellipse(x, y, 104, 56, alpha(C.yellow, 0.35)))
  g.ellipse(
    x,
    y,
    84,
    44,
    g.rad(x, y + 10, 4, 84, [
      [0, '#0c0704'],
      [1, SOIL],
    ]),
  )
}

/** The front lip of the hole, drawn over whatever is rising out of it. */
function lip(g: Draw, x: number, y: number): void {
  g.path(
    (c) => {
      c.ellipse(x, y, 104, 56, 0, 0, Math.PI)
      c.ellipse(x, y, 84, 44, 0, Math.PI, 0, true)
      c.closePath()
    },
    g.lin(0, y, 0, y + 56, [
      [0, shade(DIRT, 0.15)],
      [1, shade(DIRT, -0.25)],
    ]),
  )
  for (const [dx, dy, r] of [
    [-62, 34, 9],
    [10, 46, 7],
    [58, 30, 8],
  ] as const) {
    g.circle(x + dx, y + dy, r, shade(DIRT, -0.3))
  }
}

/** A mole's head, drawn around its centre. `squash` 0..1 after a whack. */
function mole(g: Draw, x: number, y: number, squash: number, hit: boolean, now: number): void {
  g.at(
    x,
    y,
    0,
    () => {
      // Body below the head, to fill the hole.
      g.rrect(-60, 10, 120, 120, 50, shade(FUR, -0.15))
      g.circle(
        0,
        0,
        62,
        g.rad(-18, -24, 8, 74, [
          [0, shade(FUR, 0.3)],
          [0.7, FUR],
          [1, shade(FUR, -0.4)],
        ]),
        alpha(C.ink, 0.7),
        6,
      )
      g.ellipse(-24, -34, 20, 10, alpha('#ffffff', 0.3), -0.5)
      // Paws on the rim.
      for (const sx of [-1, 1]) {
        g.ellipse(sx * 48, 52, 22, 14, '#f7a8b8')
        for (const k of [-8, 0, 8]) g.circle(sx * 48 + k, 44, 3, alpha('#ffffff', 0.7))
      }
      // Snout, nose, teeth, whiskers.
      g.ellipse(0, 24, 30, 22, '#f2c1a0')
      g.ellipse(0, 12, 12, 8, '#3b2230')
      g.ellipse(-3, 9, 4, 2.5, alpha('#ffffff', 0.6))
      g.rrect(-9, 32, 8, 12, 2, '#ffffff')
      g.rrect(1, 32, 8, 12, 2, '#ffffff')
      for (const sx of [-1, 1]) {
        g.line(sx * 26, 20, sx * 58, 12, alpha(C.ink, 0.5), 3)
        g.line(sx * 26, 26, sx * 58, 30, alpha(C.ink, 0.5), 3)
      }
      if (hit) {
        for (const sx of [-1, 1]) {
          g.line(sx * 24 - 9, -24, sx * 24 + 9, -12, C.ink, 6)
          g.line(sx * 24 - 9, -12, sx * 24 + 9, -24, C.ink, 6)
        }
        for (let i = 0; i < 3; i++) {
          const a = now * 10 + (i * Math.PI * 2) / 3
          g.star(Math.cos(a) * 74, -70 + Math.sin(a) * 14, 15, C.yellow, 5, 0.5, a)
        }
      } else {
        for (const sx of [-1, 1]) {
          g.circle(sx * 24, -16, 15, '#ffffff', alpha(C.ink, 0.6), 3)
          g.circle(sx * 24, -14, 8, C.ink)
          g.circle(sx * 24 + 3, -17, 3, '#ffffff')
        }
      }
    },
    1 + squash * 0.2,
    1 - squash * 0.32,
  )
}

/** A bunny's face and ears, drawn around its centre. A bad whack makes it wobble. */
function bunny(g: Draw, x: number, y: number, squash: number, bad: boolean, now: number): void {
  g.at(
    x,
    y,
    bad ? Math.sin(now * 30) * 0.12 : 0,
    () => {
      g.rrect(-54, 30, 108, 110, 46, '#e7e2f0')
      for (const sx of [-1, 1]) {
        g.at(sx * 22, -50, sx * (0.14 + 0.05 * Math.sin(now * 6 + sx)), () => {
          g.ellipse(0, 0, 20, 56, alpha(C.ink, 0.55))
          g.ellipse(0, 0, 15, 51, '#ffffff')
          g.ellipse(0, 4, 8, 38, '#f7a8b8')
        })
      }
      g.ellipse(0, 24, 58, 50, alpha(C.ink, 0.55))
      g.ellipse(
        0,
        24,
        53,
        45,
        g.rad(-14, 0, 6, 60, [
          [0, '#ffffff'],
          [1, '#d9d4e6'],
        ]),
      )
      g.ellipse(-18, 4, 14, 8, alpha('#ffffff', 0.8), -0.4)
      g.alpha(0.55, () => {
        g.ellipse(-32, 26, 11, 7, '#ff9bb0')
        g.ellipse(32, 26, 11, 7, '#ff9bb0')
      })
      if (bad) {
        for (const sx of [-1, 1]) {
          g.line(sx * 18 - 7, 0, sx * 18 + 7, 14, C.ink, 5)
          g.line(sx * 18 - 7, 14, sx * 18 + 7, 0, C.ink, 5)
        }
        g.ellipse(0, 40, 9, 8, C.ink)
      } else {
        for (const sx of [-1, 1]) {
          g.circle(sx * 18, 6, 8, C.ink)
          g.circle(sx * 18 + 2.5, 3, 3, '#ffffff')
        }
        g.path(
          (c) => {
            c.moveTo(-9, 26)
            c.quadraticCurveTo(0, 34, 9, 26)
          },
          undefined,
          C.ink,
          4,
        )
      }
      g.ellipse(0, 19, 7, 5, '#ff6b8a')
    },
    1 + squash * 0.14,
    1 - squash * 0.22,
  )
}

/** One cell's creature, clipped to its hole. It rises as it pops, jolts when whacked and sinks. */
function creature(g: Draw, x: number, y: number, c: Cell, now: number): void {
  let rise: number
  if (c.st === 'up') {
    rise = outBack(prog(now - c.t, 0, 0.18))
    // A little nervous bob while up, and a peek down before leaving.
    rise -= Math.max(0, prog(now, c.until - 0.2, c.until)) * 0.15
    rise += Math.sin((now - c.at) * 9) * 0.03
  } else if (c.st === 'down') rise = 1 - inQuad(prog(now - c.t, 0, 0.18))
  else rise = 1 - outCubic(prog(now - c.t, 0.12, 0.45))
  if (rise <= 0.02) return
  const squash = c.st === 'hit' || c.st === 'bad' ? Math.max(0, 1 - (now - c.t) / 0.25) : 0
  const hy = y + 30 - rise * 110
  const cx = g.ctx
  cx.save()
  cx.beginPath()
  cx.rect(x - 160, y - 320, 320, 320)
  cx.ellipse(x, y, 84, 44, 0, 0, Math.PI)
  cx.clip()
  if (c.kind === 'mole') mole(g, x, hy, squash, c.st === 'hit', now)
  else bunny(g, x, hy, squash, c.st === 'bad', now)
  cx.restore()
}

/** The whacking mallet in the owner's colour, swung down on a hole just hit. */
function mallet(g: Draw, side: Side, x: number, y: number, age: number): void {
  if (age < 0 || age > 0.34) return
  const down = age < 0.06 ? inQuad(age / 0.06) : 1 - outCubic(prog(age, 0.16, 0.34)) * 0.7
  const a = 1 - prog(age, 0.22, 0.34)
  const ang = -1.1 + down * 1.1
  g.alpha(a, () =>
    g.at(x + 110, y - 40, ang, () => {
      g.line(0, 0, 150, 0, shade(C.woodDark, -0.3), 22)
      g.line(0, 0, 150, 0, C.wood, 13)
      g.rrect(-56, -46, 112, 92, 22, shade(SIDE[side].main, -0.5))
      g.rrect(-50, -40, 100, 80, 18, SIDE[side].main)
      g.rrect(-42, -34, 84, 22, 10, alpha('#ffffff', 0.3))
    }),
  )
}

/** Score with a pop when it changes, at the player's edge. */
function score(g: Draw, side: Side, v: number, k: number): void {
  const y = hudY(g, side)
  const x = side === 0 ? 150 : W - 150
  g.forSide(side, x, y, () =>
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(-80, -46, 160, 92, 30, alpha(C.ink, 0.75))
        g.text(v, 0, 5, {
          size: 72,
          weight: 700,
          color: SIDE[side].light,
          drop: alpha('#000000', 0.4),
        })
      },
      1 + k * 0.3,
    ),
  )
}

/** "Moles +1 · Bunnies −2" at the start, upright for each reader. */
function rules(g: Draw, side: Side, a: number, now: number): void {
  if (a <= 0) return
  inFrame(g, side, () =>
    g.alpha(a, () =>
      g.at(W / 2, 992, textAngle(g, side), () => {
        g.rrect(-320, -42, 640, 84, 42, alpha(C.ink, 0.9))
        g.clip(-320, -42, 640, 84, 42, () => {
          g.at(-262, 12, 0, () => mole(g, 0, 0, 0, false, now), 0.4)
          g.at(-30, 14, 0, () => bunny(g, 0, 0, 0, false, now), 0.4)
        })
        g.text('+1', -196, 3, { size: 42, weight: 700, color: C.green })
        g.text('·', -110, 3, { size: 42, weight: 700, color: alpha(C.white, 0.5) })
        g.text('−2', 36, 3, { size: 42, weight: 700, color: C.red })
        g.text('Don’t!', 180, 3, { size: 42, weight: 700, color: C.white })
      }),
    ),
  )
}

export function renderMoles(
  g: Draw,
  s: State,
  now: number,
  o: { names: [string, string]; over: boolean; left: number },
): void {
  const glow: [number, number] = [0, 0]
  if (s.winner !== null && s.winner !== 'draw') glow[s.winner] = 0.55 + 0.45 * Math.sin(now * 8)
  field(g, glow)
  // Each hole is placed in its owner's frame but drawn upright for whoever
  // looks at it: moles face their owner in local 2P, and the viewer otherwise.
  const at = (side: Side, h: number, fn: () => void) => {
    const { x, y } = holeXY(h)
    const p = frame(side, x, y)
    g.at(p.x, p.y, g.orient(side), fn)
  }
  for (const side of [0, 1] as Side[]) {
    for (let h = 0; h < HOLES; h++) {
      const c = s.cells[side][h]
      const hot = c && (c.st === 'hit' || c.st === 'bad') ? Math.max(0, 1 - (now - c.t) / 0.3) : 0
      at(side, h, () => hole(g, 0, 0, hot))
    }
    for (let h = 0; h < HOLES; h++) {
      const c = s.cells[side][h]
      if (c) at(side, h, () => creature(g, 0, 0, c, now))
    }
    for (let h = 0; h < HOLES; h++) at(side, h, () => lip(g, 0, 0))
    for (let h = 0; h < HOLES; h++) {
      const c = s.cells[side][h]
      if (c && (c.st === 'hit' || c.st === 'bad'))
        at(side, h, () => mallet(g, side, 0, -60, now - c.t))
    }
  }
  const intro = 1 - prog(now, 1.6, 2)
  if (!o.over) {
    const readers: Side[] = g.flipTop ? [0, 1] : [g.stage.rot ? 1 : 0]
    for (const side of readers) rules(g, side, intro * outBack(prog(now, 0.1, 0.4)), now)
  }
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, o.names[side], { x: side === 0 ? W - 330 : 330 })
    score(g, side, s.score[side], Math.max(0, 1 - (now - s.scoreAt[side]) / 0.2))
  }
  if (o.over) {
    const t = now - s.endAt
    const k = outBack(prog(t, 0, 0.3))
    banner(g, undefined, s.winner === 'draw' ? 'Time! A draw' : 'Time!', MID, {
      size: 72 * k,
      color: C.yellow,
    })
  } else clock(g, Math.max(0, o.left), MID)
}
