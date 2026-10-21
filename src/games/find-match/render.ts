import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { inOutCubic, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { CARD_R, FREEZE, SYMBOLS, type Layout } from './rules.ts'
import type { State } from './index.ts'

/** Own cards sit in each player's half, red's frame: blue's is mirrored by `frame`. */
export const OWN_Y = 1436
/** How long the flight of a scored card takes to reach the middle. */
export const FLY_TIME = 0.42
/** How long a freshly dealt card takes to slide in from the player's edge. */
const DEAL_TIME = 0.45
/** Thickness of a card seen from the side. */
const LIP = 12

/** World position of `side`'s own card centre. */
export function ownCentre(side: Side): { x: number; y: number } {
  return frame(side, 500, OWN_Y)
}

/** World position of a symbol on `side`'s own card. */
export function symbolWorld(side: Side, x: number, y: number): { x: number; y: number } {
  return frame(side, 500 + x, OWN_Y + y)
}

export function drawTable(g: Draw): void {
  g.halves(shade(SIDE[0].main, -0.76), shade(SIDE[1].main, -0.76))
  g.fillView(
    g.rad(W / 2, MID, 40, 1000, [
      [0, alpha('#ffffff', 0.14)],
      [0.45, alpha('#ffffff', 0.04)],
      [1, alpha('#000000', 0)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const c = ownCentre(side)
    g.fillView(
      g.rad(c.x, c.y, 20, 560, [
        [0, alpha(SIDE[side].main, 0.18)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
  g.vignette(0.42)
}

interface DiscOpts {
  rim: string
  /** Symbol the player last tapped, its outcome, and how long ago. */
  tapSym?: number
  tapKind?: number
  tapAge?: number
  /** A symbol to ring in yellow (the one that just scored). */
  mark?: number
  markAge?: number
  dim?: boolean
  /** Rotation of the whole card (symbols turn with it). */
  spin?: number
  /** Direction of "down" for whoever looks at the card: the lip and gloss follow it. */
  light?: number
  /** Contact shadow strength (0 = none). */
  shadow?: number
}

/** One card: a chunky round coaster with its symbols scattered on it, drawn around (0, 0). */
export function drawDisc(g: Draw, l: Layout, o: DiscOpts): void {
  const R = CARD_R
  g.at(0, 0, o.light ?? 0, () => drawBody(g, o.rim, o.shadow ?? 0))
  drawItems(g, l, o)
  // Gloss across the top-left of the face, for the viewer.
  g.at(0, 0, o.light ?? 0, () =>
    g.alpha(0.22, () => g.ellipse(-R * 0.36, -R * 0.52, R * 0.36, R * 0.13, '#fff', -0.6)),
  )
  if (o.dim) g.circle(0, 0, R - 16, alpha(C.ink, 0.5))
}

/** Lip, rim and face of a card, lit from the top of the (rotated) frame. */
function drawBody(g: Draw, rim: string, shadow: number): void {
  const R = CARD_R
  if (shadow > 0) g.shadow(0, R + LIP - 6, R * 0.9, 30, shadow)
  // Lip and rim: a thick toy token, lit from above.
  g.circle(0, LIP, R, shade(rim, -0.45))
  g.circle(
    0,
    0,
    R,
    g.rad(
      0,
      0,
      R * 0.7,
      R,
      [
        [0, shade(rim, 0.2)],
        [0.6, rim],
        [1, shade(rim, -0.18)],
      ],
      -R * 0.25,
      -R * 0.3,
    ),
  )
  g.circle(
    0,
    0,
    R - 16,
    g.rad(
      0,
      0,
      R * 0.1,
      R,
      [
        [0, '#fffaf0'],
        [0.75, C.cream],
        [1, shade(C.cream, -0.08)],
      ],
      -R * 0.2,
      -R * 0.3,
    ),
  )
  g.ring(0, 0, R - 16, alpha(C.ink, 0.12), 3)
}

/** The symbols, in the card's own frame (where taps are tested). */
function drawItems(g: Draw, l: Layout, o: DiscOpts): void {
  g.at(0, 0, o.spin ?? 0, () => {
    for (const it of l.items) {
      const hit = o.tapSym === it.s && o.tapAge !== undefined && o.tapAge < 0.6
      const age = o.tapAge ?? 0
      const wrong = hit && o.tapKind === 0
      const shake = wrong ? Math.sin(age * 60) * 10 * (1 - age / 0.6) : 0
      const marked = o.mark === it.s && o.markAge !== undefined && o.markAge < 1.1
      if (marked) {
        const k = outBack(prog(o.markAge ?? 0, 0, 0.3))
        const fade = 1 - prog(o.markAge ?? 0, 0.7, 1.1)
        g.alpha(fade, () => {
          g.circle(it.x, it.y, (it.r + 14) * k, alpha(C.yellow, 0.35))
          g.ring(it.x, it.y, (it.r + 14) * k, C.yellow, 8)
        })
      }
      const bump = marked ? 1 + 0.18 * Math.sin(Math.PI * prog(o.markAge ?? 0, 0, 0.4)) : 1
      g.emoji(SYMBOLS[it.s] ?? '❓', it.x + shake, it.y, it.r * 2.2 * bump, it.a)
      if (wrong) {
        g.alpha(1 - prog(age, 0.35, 0.6), () => g.ring(it.x + shake, it.y, it.r + 8, C.red, 8))
      }
    }
  })
}

/** The pile in the middle: the cards already played, then the live centre card (flying in after a point). */
export function drawCentre(g: Draw, s: State, now: number): void {
  const age = now - s.flyAt
  const flying = s.flySide !== null && age >= 0 && age < FLY_TIME
  const played = s.score[0] + s.score[1]
  // Older cards peek out under the top one, a little askew.
  const pile = Math.min(3, played)
  const light = g.stage.rot
  g.at(500, MID, light, () => g.shadow(0, CARD_R + LIP - 4, CARD_R * 0.92, 34, 0.45))
  for (let i = pile; i >= 1; i--) {
    // Card edges seen under the top card: cream, darker the deeper they sit.
    g.at(500 + (i % 2 ? 12 : -12) * i, MID + 6 * i, 0, () => {
      g.circle(0, LIP, CARD_R, shade(C.cream, -0.55 - 0.06 * i))
      g.circle(0, 0, CARD_R, shade(C.cream, -0.25 - 0.08 * i))
      g.ring(0, 0, CARD_R - 2, alpha(C.ink, 0.25), 3)
    })
  }
  if (flying && s.prev) {
    g.at(500, MID, 0, () => drawDisc(g, s.prev as Layout, { rim: C.yellow, light }))
  }
  // The scored card's flight: a hop from the scorer's half with a quarter spin, landing with a squash.
  let x = 500
  let y = MID
  let k = 1
  let sx = 1
  let sy = 1
  let spin = 0
  if (flying && s.flySide !== null) {
    const from = ownCentre(s.flySide)
    const p = inOutCubic(prog(age, 0, FLY_TIME))
    x = from.x + (500 - from.x) * p
    y = from.y + (MID - from.y) * p
    k = 1 + 0.16 * Math.sin(Math.PI * p)
    spin = (1 - outCubic(prog(age, 0, FLY_TIME))) * (s.flySide === 0 ? 0.6 : -0.6)
    g.shadow(x, y + CARD_R + 60 * Math.sin(Math.PI * p), CARD_R * 0.8, 30, 0.3)
  } else if (s.flySide !== null) {
    const land = age - FLY_TIME
    if (land >= 0 && land < 0.25) {
      const b = Math.sin((land / 0.25) * Math.PI)
      sx = 1 + 0.06 * b
      sy = 1 - 0.06 * b
    }
  }
  const scorer = s.flySide
  // The scorer's card keeps its colour in flight, then turns gold as the live centre card.
  const rim =
    scorer === null
      ? C.yellow
      : mix(SIDE[scorer].main, C.yellow, prog(age, FLY_TIME, FLY_TIME + 0.3))
  const markAge = scorer === null ? undefined : age
  g.at(
    x,
    y,
    0,
    () =>
      drawDisc(g, s.centre, {
        rim,
        spin,
        light,
        ...(scorer !== null && markAge !== undefined
          ? { mark: s.tapSym[scorer], markAge: Math.max(0, markAge - FLY_TIME * 0.6) }
          : {}),
      }),
    k * sx,
    k * sy,
  )
}

/** A player's own card, upright for that player, sliding in from their edge when it is dealt. */
export function drawOwn(g: Draw, s: State, side: Side, now: number): void {
  const age = now - s.dealAt[side]
  const frozen = s.frozen[side] >= 0 && now < s.frozen[side]
  const tapAge = now - s.tapAt[side]
  const deal = age >= 0 && age < DEAL_TIME ? outBack(prog(age, 0.05, DEAL_TIME)) : 1
  const slide = (1 - deal) * 520
  const won = s.endAt >= 0 && s.flySide === side
  // A wrong tap jolts the whole card.
  const jolt =
    s.tapKind[side] === 0 && tapAge < 0.3 ? Math.sin(tapAge * 70) * 12 * (1 - tapAge / 0.3) : 0
  inFrame(g, side, () => {
    g.at(500 + jolt, OWN_Y + slide, (1 - deal) * 0.5, () => {
      if (won) {
        g.alpha(0.4 + 0.3 * Math.sin(now * 10), () => g.circle(0, 0, CARD_R + 26, C.yellow))
      }
      drawDisc(g, s.own[side], {
        rim: SIDE[side].main,
        tapSym: s.tapSym[side],
        tapKind: s.tapKind[side],
        tapAge,
        dim: frozen,
        light: textAngle(g, side),
        shadow: 0.4,
      })
      if (frozen) {
        const left = (s.frozen[side] - now) / FREEZE
        g.arc(
          0,
          0,
          CARD_R + 18,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Math.max(0, left),
          C.red,
          12,
        )
        g.at(0, 0, textAngle(g, side), () => {
          g.circle(0, 0, 78, alpha(C.ink, 0.9))
          g.emoji('🔒', 0, 0, 80)
        })
      }
    })
  })
}

/** Over the centre card once the match is decided: the winner, upright for each reader. */
export function drawWinner(g: Draw, s: State, now: number, names: readonly string[]): void {
  if (s.endAt < 0 || s.flySide === null) return
  const side = s.flySide
  const k = outBack(prog(now - s.endAt, FLY_TIME, FLY_TIME + 0.4))
  if (k <= 0) return
  const label = `${names[side] ?? SIDE[side].name} wins!`
  const one = (angle: number, y: number) =>
    g.at(
      500,
      y,
      angle,
      () => {
        const w = Math.min(760, g.measure(label, 64, 700) + 170)
        g.rrect(-w / 2, -64, w, 128, 64, alpha(C.ink, 0.92), SIDE[side].main, 8)
        g.emoji('🏆', -w / 2 + 64, 0, 66)
        g.text(label, 40, 4, {
          size: 64,
          weight: 700,
          color: SIDE[side].light,
          maxWidth: w - 150,
        })
      },
      k,
    )
  if (g.flipTop) {
    one(0, MID + 90)
    one(Math.PI, MID - 90)
  } else one(g.orient(), MID)
}

/** Points so far as a row of pips beside the name pill, to each player's right. */
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
      if (on) g.ball(x0 + i * gap, 0, 12 * (1 + 0.5 * (1 - fresh)), SIDE[side].main, 0.8)
      else g.circle(x0 + i * gap, 0, 10, alpha(C.white, 0.13))
    }
  })
}
