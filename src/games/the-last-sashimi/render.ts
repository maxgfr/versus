import type { Side } from '../../core/game.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { inQuad, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { banner, hudY, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import type { Rounds } from '../../engines/reflex/index.ts'
import type { State } from './index.ts'

/*
 * One shared lacquer table with the last piece in the middle. Each pair of
 * chopsticks is drawn in its owner's frame, so it reaches in from their own
 * edge and reads as theirs. The grab carries the piece home to the winner.
 */

/** The piece of sashimi (top view), centred on the midline. */
export const PIECE = { x: W / 2, y: MID, rx: 124, ry: 76 }
/** Each pair of chopsticks hovers with its tips this far from the midline on its owner's side. */
export const TIP = { x: W / 2 + 30, y: MID + 128 }
/** The tips once they have closed on the piece. */
const GRAB_Y = MID + 10
/** Where the chopsticks run off their owner's edge. */
const EDGE = { x: W / 2 + 215, y: H + 160 }
/** The bell that rings for real (gold) and for the decoys (purple). */
export const BELL = { x: 880, y: MID }

function table(g: Draw, glow: [number, number]): void {
  const v = g.stage.view
  g.fillView('#1a0f0c')
  // Lacquer planks.
  const plank = 160
  for (let y = Math.floor(v.y / plank) * plank, i = 0; y < v.y + v.h; y += plank, i++) {
    g.rect(v.x - 2, y, v.w + 4, plank, i % 2 ? '#2b1913' : '#24150f')
    g.rect(v.x - 2, y + plank - 4, v.w + 4, 4, alpha('#000000', 0.35))
    g.line(v.x, y + 46, v.x + v.w, y + 52, alpha('#ffffff', 0.025), 6)
    g.line(v.x, y + 104, v.x + v.w, y + 98, alpha('#ffffff', 0.02), 4)
  }
  // Each half leans toward its player.
  g.rect(v.x - 2, v.y - 2, v.w + 4, MID - v.y + 2, alpha(SIDE[1].main, 0.16))
  g.rect(v.x - 2, MID, v.w + 4, v.y + v.h - MID + 2, alpha(SIDE[0].main, 0.16))
  for (const side of [0, 1] as Side[]) {
    if (glow[side] <= 0) continue
    const y0 = side === 0 ? MID : v.y - 2
    const y1 = side === 0 ? v.y + v.h + 2 : MID
    g.alpha(glow[side] * 0.25, () => g.rect(v.x - 2, y0, v.w + 4, y1 - y0, SIDE[side].main))
  }
  // A bamboo runner across the middle.
  const top = MID - 215
  g.rect(v.x - 2, top + 12, v.w + 4, 430, alpha('#000000', 0.35))
  for (let y = top, i = 0; y < MID + 215; y += 22, i++) {
    g.rect(v.x - 2, y, v.w + 4, 20, i % 2 ? '#4a3d24' : '#54452a')
    g.rect(v.x - 2, y + 2, v.w + 4, 4, alpha('#ffffff', 0.06))
  }
  for (const x of [v.x + 110, v.x + v.w - 110]) g.rect(x - 4, top, 8, 430, alpha('#1f170a', 0.7))
  // A lamp over the middle.
  g.fillView(
    g.rad(W / 2, MID, 40, 760, [
      [0, alpha('#ffe9c4', 0.22)],
      [1, alpha('#ffe9c4', 0)],
    ]),
  )
  g.vignette(0.5)
}

/** A black lacquer plate with a red rim under the piece. */
function plate(g: Draw, glow: number, gc: string): void {
  const { x, y } = PIECE
  g.ellipse(x + 10, y + 18, 214, 160, alpha('#000000', 0.45))
  if (glow > 0) g.alpha(glow, () => g.ellipse(x, y, 240, 186, alpha(gc, 0.55)))
  g.ellipse(x, y, 206, 152, '#b3262f')
  g.ellipse(x, y, 194, 141, '#1b1416')
  g.ellipse(
    x,
    y,
    180,
    128,
    g.rad(x - 50, y - 40, 10, 200, [
      [0, '#3a2c30'],
      [1, '#120c0e'],
    ]),
  )
  g.ellipse(x - 70, y - 60, 50, 16, alpha('#ffffff', 0.12), -0.25)
}

/** The soy dish and a dab of wasabi on the side of the table: set dressing. */
function dish(g: Draw): void {
  const x = 220
  const y = MID
  g.ellipse(x + 6, y + 10, 70, 56, alpha('#000000', 0.4))
  g.ellipse(x, y, 68, 54, C.white)
  g.ellipse(x, y, 52, 40, '#2a120a')
  g.ellipse(x - 14, y - 12, 18, 7, alpha('#ffffff', 0.25), -0.3)
  g.ball(x + 10, y + 74, 22, '#8fcf5a', 0.6)
}

/** The piece itself, nigiri seen from above: rice under a salmon top. */
function piece(g: Draw, x: number, y: number, scale: number, fade: number, angle = 0): void {
  if (fade <= 0 || scale <= 0) return
  g.alpha(fade, () =>
    g.at(
      x,
      y,
      angle,
      () => {
        g.ellipse(8, 14, PIECE.rx, PIECE.ry, alpha('#000000', 0.35))
        g.ellipse(
          0,
          0,
          PIECE.rx,
          PIECE.ry,
          g.lin(-120, -60, 120, 60, [
            [0, '#fffdf6'],
            [1, '#ddd3c2'],
          ]),
        )
        // Rice grains peeking out.
        for (const [gx, gy, a] of [
          [-110, 10, 0.4],
          [-96, 40, -0.3],
          [104, -18, 0.6],
          [92, 38, -0.4],
          [-30, 70, 0.1],
          [40, 68, -0.2],
        ] as const) {
          g.ellipse(gx, gy, 12, 6, '#f4ecdc', a)
        }
        g.ellipse(
          -4,
          -8,
          112,
          64,
          g.lin(-110, -60, 110, 60, [
            [0, '#ff7f5c'],
            [0.5, '#ff9a6e'],
            [1, '#f2603f'],
          ]),
        )
        // Fat streaks through the salmon.
        for (const dx of [-66, -20, 26, 70]) {
          g.path(
            (c) => {
              c.moveTo(dx - 12, -54)
              c.quadraticCurveTo(dx + 16, -10, dx - 2, 46)
            },
            undefined,
            alpha('#ffffff', 0.5),
            8,
          )
        }
        g.ellipse(-44, -34, 30, 12, alpha('#ffffff', 0.45), -0.3)
      },
      scale,
      scale,
    ),
  )
}

/**
 * A pair of lacquered chopsticks in its owner's frame. `tip` is where the
 * tips meet, `open` 0..1 how far they gape, `angle` a bonk tilt.
 */
function sticks(
  g: Draw,
  side: Side,
  tip: { x: number; y: number },
  open: number,
  angle: number,
): void {
  const col = SIDE[side].main
  inFrame(g, side, () => {
    g.at(tip.x, tip.y, angle, () => {
      const gap = 10 + open * 34
      for (const [sx, ex] of [
        [-gap, -60],
        [gap, 60],
      ] as const) {
        const dx = EDGE.x - tip.x + ex
        const dy = EDGE.y - tip.y
        const len = Math.hypot(dx, dy)
        const ux = dx / len
        const uy = dy / len
        // Shadow, lacquer body, bare tip, highlight.
        g.line(sx + 18, 22, sx + dx + 18, dy + 22, alpha('#000000', 0.32), 30)
        g.line(sx, 0, sx + dx, dy, shade(col, -0.55), 30)
        g.line(sx, 0, sx + dx, dy, col, 22)
        g.line(sx, 0, sx + ux * 120, uy * 120, shade(C.wood, 0.25), 20)
        g.line(sx + ux * 120, uy * 120, sx + ux * 132, uy * 132, C.yellow, 22, 'butt')
        g.line(sx + ux * 140 - 6, uy * 140, sx + dx - 6, dy, alpha('#ffffff', 0.28), 5)
        g.circle(sx, 0, 10, shade(C.wood, -0.1))
      }
    })
  })
}

/** The bell lies on its side, mouth toward the plate. Gold glow for real, purple for a decoy. */
function bell(g: Draw, ring: number, decoy: number, now: number): void {
  const { x, y } = BELL
  const wob =
    ring > 0 ? Math.sin(now * 40) * 0.3 * ring : decoy > 0 ? Math.sin(now * 30) * 0.12 * decoy : 0
  if (ring > 0) {
    g.alpha(ring, () =>
      g.circle(
        x - 30,
        y,
        230,
        g.rad(x - 30, y, 0, 230, [
          [0, alpha(C.yellow, 0.85)],
          [1, alpha(C.yellow, 0)],
        ]),
      ),
    )
  }
  if (decoy > 0) {
    g.alpha(decoy, () =>
      g.circle(
        x - 30,
        y,
        190,
        g.rad(x - 30, y, 0, 190, [
          [0, alpha(C.purple, 0.8)],
          [1, alpha(C.purple, 0)],
        ]),
      ),
    )
  }
  g.ellipse(x + 8, y + 14, 80, 66, alpha('#000000', 0.4))
  g.circle(x, y, 78, mix(mix(C.ink3, '#6b5520', ring), C.purple, decoy * 0.7))
  g.ring(x, y, 78, mix(mix(C.ink4, C.yellow, ring), C.purple, decoy), 6)
  g.emoji('🔔', x, y, 104, Math.PI / 2 + wob)
}

/** A short line upright for the player who reads it, in their frame. */
function say(
  g: Draw,
  side: Side,
  text: string,
  x: number,
  y: number,
  o: { size: number; color: string; a?: number },
) {
  inFrame(g, side, () =>
    g.alpha(o.a ?? 1, () =>
      g.text(text, x, y, {
        size: o.size,
        weight: 700,
        color: o.color,
        stroke: alpha(C.ink, 0.9),
        strokeWidth: o.size * 0.22,
        angle: textAngle(g, side),
      }),
    ),
  )
}

/** The round result in each half (clear of the plate), and "Round N" at the start. */
function roundBanner(g: Draw, r: Rounds, now: number, over: boolean): void {
  if (over) return
  const sides: Side[] = g.flipTop ? [0, 1] : [g.stage.rot ? 1 : 0]
  for (const side of sides) {
    const p = frame(side, W / 2 - 60, MID + 470)
    if (r.phase === 'between' && r.text) {
      const k = outBack(prog(now - r.at, 0.35, 0.65))
      if (k > 0) banner(g, side, r.text, p.y, { size: 50, alpha: Math.min(1, k) })
    } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
      const a = 1 - Math.max(0, (now - r.at - 0.7) / 0.4)
      banner(g, side, `Round ${r.round}`, p.y, { size: 58, alpha: a })
    }
  }
}

/**
 * Round wins at a side's HUD row: pips while they fit beside the pill, a
 * compact "wins/target" tally for long matches (up to 9 pips would run off the edge).
 */
function tally(g: Draw, side: Side, wins: number, target: number, x: number, fit: number): void {
  if (target <= fit) {
    pips(g, side, wins, target, { x })
    return
  }
  g.forSide(side, x, hudY(g, side), () => {
    const a = String(wins)
    const b = `/${target}`
    const wa = g.measure(a, 44, 700)
    const wb = g.measure(b, 34, 700)
    const w = 70 + wa + wb
    g.rrect(-w / 2, -34, w, 68, 34, alpha(C.ink, 0.7))
    g.sideMark(side, -w / 2 + 34, 0, 13, wins > 0 ? SIDE[side].main : alpha(C.white, 0.3))
    g.text(a, -w / 2 + 58, 3, { size: 44, weight: 700, color: SIDE[side].light, align: 'left' })
    g.text(b, -w / 2 + 60 + wa, 6, {
      size: 34,
      weight: 700,
      color: alpha(C.white, 0.55),
      align: 'left',
    })
  })
}

export function renderSashimi(
  g: Draw,
  s: State,
  now: number,
  o: { names: [string, string]; over: boolean },
): void {
  const r = s.rounds
  const sig = s.sig
  const waiting = sig.phase === 'wait' && r.phase === 'play'
  const took = s.took !== null && s.took !== 'draw' ? s.took : null
  const since = s.endAt >= 0 ? now - s.endAt : -1

  const glow: [number, number] = [0, 0]
  if (s.winner !== null) glow[s.winner] = 0.55 + 0.45 * Math.sin(now * 8)
  else if (took !== null && since >= 0) glow[took] = 1 - prog(since, 0.2, 1.4)
  table(g, glow)

  // A decoy flash: purple. The real bell: gold.
  const lastDecoy = s.shown > 0 ? (s.decoys[s.shown - 1] ?? -10) : -10
  const decoyAge = sig.phase === 'wait' ? sig.t - lastDecoy : 99
  const decoyGlow = Math.max(0, 1 - decoyAge / 0.45)
  const ringAge = s.ringAt >= 0 ? now - s.ringAt : 99
  const ring = Math.max(0, 1 - ringAge / 0.7)
  // While nobody has the piece after the bell, the plate keeps glowing gold.
  const live = sig.phase === 'live' && s.took === null && r.phase === 'play'

  dish(g)
  plate(
    g,
    Math.max(decoyGlow * 0.8, ring, live ? 0.4 + 0.2 * Math.sin(now * 14) : 0),
    decoyGlow > ring ? C.purple : C.yellow,
  )
  if (decoyGlow > 0) {
    g.alpha(decoyGlow * 0.9, () =>
      g.ring(PIECE.x, PIECE.y, 160 + (1 - decoyGlow) * 70, C.purple, 12),
    )
  }
  if (ring > 0) {
    g.alpha(ring, () => g.ring(PIECE.x, PIECE.y, 160 + (1 - ring) * 140, C.yellow, 14))
  }
  bell(g, ring, decoyGlow, now)

  // The piece: rides home on the winner's chopsticks. A draw leaves it on the plate.
  const grab = took !== null && since >= 0 ? outCubic(prog(since, 0, 0.14)) : 0
  const carry = took !== null && since >= 0 ? inQuad(prog(since, 0.22, 0.75)) : 0
  const appear = r.phase === 'play' ? outBack(prog(now - r.at, 0, 0.35)) : 1
  const home = 520
  const tipFor = (side: Side) => {
    let y = TIP.y
    let open = waiting ? 0.7 + 0.15 * Math.sin(now * 3 + side) : 0.9
    if (took === side) {
      y = TIP.y + (GRAB_Y - TIP.y) * grab + home * carry
      open = 0.9 - grab * 0.75
    } else if (live) {
      open = 1
    }
    return { x: TIP.x, y, open }
  }
  if (took !== null) {
    const t = tipFor(took)
    const w = frame(took, t.x - 0, t.y - 10)
    piece(
      g,
      w.x,
      w.y,
      appear * (1 - carry * 0.3),
      1 - prog(since, 0.6, 0.8),
      took === 0 ? 0.25 * grab : -0.25 * grab,
    )
  } else {
    piece(g, PIECE.x, PIECE.y, appear, 1)
  }

  for (const side of [0, 1] as Side[]) {
    const t = tipFor(side)
    const k = s.early[side] ? now - s.earlyAt : 99
    const bonk = k < 0.8 ? Math.sin(k * 40) * 0.14 * Math.exp(-k * 6) : 0
    const tremble = waiting ? Math.sin(now * 37 + side * 2) * 2 : 0
    const lost = took !== null && took !== side
    const back = lost ? outCubic(prog(since, 0.1, 0.5)) * 60 : 0
    sticks(
      g,
      side,
      { x: t.x + tremble, y: t.y + back + (k < 0.8 ? 40 * Math.exp(-k * 5) : 0) },
      t.open,
      bonk,
    )
  }

  if (!o.over) {
    const readers: Side[] = g.flipTop ? [0, 1] : [g.stage.rot ? 1 : 0]
    for (const side of readers) {
      if (waiting) {
        say(g, side, 'Wait for the bell…', W / 2 - 195, MID + 340, {
          size: 44,
          color: alpha(C.white, 0.85),
        })
      } else if (live) {
        const pulse = 1 + 0.08 * Math.sin(now * 16)
        say(g, side, 'GRAB!', W / 2 - 170, MID + 300, {
          size: 110 * pulse * outBack(prog(ringAge, 0, 0.2)),
          color: C.yellow,
        })
      }
    }
  }

  for (const side of [0, 1] as Side[]) {
    namePill(g, side, o.names[side], { active: live, x: side === 0 ? 330 : W - 330 })
    tally(g, side, r.wins[side], r.target, side === 0 ? W - 135 : 135, 3)
  }
  roundBanner(g, r, now, o.over)
}
