import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import { hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { drawCard, flipAmount } from '../../engines/cards/index.ts'
import { MID, W } from '../../core/stage.ts'
import { FREEZE, INTRO_TIME, OVER, PICTURE_TIME, type Picture, type Rule } from './rules.ts'
import type { State } from './index.ts'

/** The picture card: in red's frame it sits just below the midline; in local 2P blue gets its own copy. */
export const CARD = { w: 266, h: 296, y: 1068 }
/** Outside local 2P there is one card, in the middle, a little bigger. */
const SOLO_SCALE = 1.22
/** Rule plate and the big button, in red's frame. */
export const RULE_Y = 1300
export const BUTTON = { x: 500, y: 1524, r: 138 }
/** The dark ring the button sits in. */
const BEZEL = 22

const COLOURS = [C.red, C.blue, C.yellow, C.green, C.purple, C.orange] as const

/** World position of the big button for `side`. */
export function buttonCentre(side: Side): { x: number; y: number } {
  return frame(side, BUTTON.x, BUTTON.y)
}

/** World position of `side`'s card copy (the middle card when no one is looking from the other side). */
export function cardCentre(side: Side, flipTop = true): { x: number; y: number } {
  return flipTop ? frame(side, 500, CARD.y) : { x: 500, y: MID }
}

/**
 * Points so far as a segmented meter beside the name pill, one segment per point
 * (`goal` in all), so any match length fits. `x` is the side's spot in its frame.
 */
export function scoreMeter(g: Draw, side: Side, n: number, goal: number, x: number): void {
  const y = hudY(g, side)
  const gap = 4
  const seg = Math.min(40, (300 - gap * (goal - 1)) / goal)
  const w = seg * goal + gap * (goal - 1)
  g.forSide(side, x, y, () => {
    for (let i = 0; i < goal; i++) {
      const left = -w / 2 + i * (seg + gap)
      const on = i < n
      g.rrect(left, -9, seg, 18, 9, on ? SIDE[side].main : alpha(C.white, 0.14))
      if (on && seg > 14) g.rrect(left + 4, -8, seg - 8, 5, 2.5, alpha(C.white, 0.5))
    }
  })
}

export function drawTable(g: Draw): void {
  g.halves(shade(SIDE[0].main, -0.76), shade(SIDE[1].main, -0.76))
  g.fillView(
    g.rad(W / 2, MID, 40, 980, [
      [0, alpha('#ffffff', 0.13)],
      [0.45, alpha('#ffffff', 0.04)],
      [1, alpha('#000000', 0)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const b = buttonCentre(side)
    g.fillView(
      g.rad(b.x, b.y, 20, 520, [
        [0, alpha(SIDE[side].main, 0.2)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
  g.vignette(0.42)
}

function paintPicture(g: Draw, pic: Picture | null, w: number, h: number): void {
  if (!pic) return
  if (pic.kind === 'glyph') g.emoji(pic.glyph, 0, 0, Math.min(w, h) * 0.66)
  else if (pic.kind === 'colours') {
    const r = w * 0.2
    g.shadow(-w * 0.21, r * 0.95, r * 0.9, r * 0.25, 0.25)
    g.shadow(w * 0.21, r * 0.95, r * 0.9, r * 0.25, 0.25)
    g.ball(-w * 0.21, 0, r, COLOURS[pic.a] ?? C.red)
    g.ball(w * 0.21, 0, r, COLOURS[pic.b] ?? C.red)
  } else {
    g.text(String(pic.n), 0, h * 0.03, {
      size: h * 0.6,
      weight: 700,
      color: C.ink3,
      drop: alpha(C.ink, 0.18),
    })
    // Card-style underline so a 6 never reads as a 9 from the other side of the table.
    if (pic.n === 6 || pic.n === 9) g.rrect(-w * 0.16, h * 0.27, w * 0.32, 12, 6, C.ink3)
  }
}

/** The picture card, one copy per reader in local 2P, in the middle otherwise. */
export function drawPictureCard(g: Draw, s: State, now: number, names: readonly string[]): void {
  const faceUp = s.pic !== null && s.phase !== 'intro'
  const flip = flipAmount(now, s.flipAt, faceUp)
  const t = now - s.picAt
  // Each new picture lands with a quick squash, so the eye catches the change.
  const land =
    s.pic && s.phase !== 'intro' && t >= 0 && t < 0.18 ? Math.sin((t / 0.18) * Math.PI) : 0
  const won = s.phase === 'point' && s.winner !== null
  const copies: { side: Side; x: number; y: number; angle: number; k: number }[] = g.flipTop
    ? [
        { side: 0, x: 500, y: CARD.y, angle: 0, k: 1 },
        { side: 1, x: 500, y: 1800 - CARD.y, angle: Math.PI, k: 1 },
      ]
    : [{ side: 0, x: 500, y: MID, angle: g.stage.rot, k: SOLO_SCALE }]
  for (const c of copies) {
    // A wrong tap stamps the tapper's copy (the shared one outside local 2P).
    const missBy = ([0, 1] as Side[]).find(
      (sd) => s.tapKind[sd] === 0 && now - s.tapAt[sd] < 0.45 && (!g.flipTop || sd === c.side),
    )
    const shake =
      missBy !== undefined
        ? Math.sin((now - s.tapAt[missBy]) * 80) * 12 * (1 - (now - s.tapAt[missBy]) / 0.45)
        : 0
    g.at(
      c.x + shake,
      c.y,
      c.angle,
      () => {
        if (won) {
          const glow = 0.55 + 0.25 * Math.sin(now * 12)
          g.alpha(glow, () =>
            g.rrect(
              -CARD.w / 2 - 22,
              -CARD.h / 2 - 22,
              CARD.w + 44,
              CARD.h + 52,
              54,
              alpha(SIDE[s.winner ?? 0].main, 0.55),
            ),
          )
        }
        drawCard(g, 0, 0, CARD.w, CARD.h, {
          flip,
          faceColor: C.cream,
          backColor: C.purple,
          face: (w, h) => paintPicture(g, s.pic, w, h),
          ...(won ? { ring: SIDE[s.winner ?? 0].main } : {}),
        })
        if (won && s.winner !== null)
          g.sideMark(s.winner, CARD.w / 2 - 30, -CARD.h / 2 + 30, 16, SIDE[s.winner].main)
        if (s.phase === 'intro' && s.endAt < 0) drawCountdown(g, now - s.phaseAt)
        if (missBy !== undefined) {
          const a = 1 - prog(now - s.tapAt[missBy], 0.2, 0.45)
          g.alpha(a, () => {
            g.circle(0, 0, 74, alpha(C.ink, 0.8))
            g.text('✗', 0, 4, { size: 100, weight: 700, color: C.red })
          })
        }
        drawTimer(g, s, now)
        if (s.endAt >= 0 && s.winner !== null) drawWinner(g, s.winner, names, now - s.endAt)
      },
      c.k * (1 + 0.05 * land),
      c.k * (1 - 0.04 * land),
    )
  }
}

/** Over the face-down card: the seconds left before the first picture, in the active yellow. */
function drawCountdown(g: Draw, age: number): void {
  const left = Math.max(0, INTRO_TIME - age)
  const n = Math.max(1, Math.ceil(left))
  const tick = 1 - (n - left)
  const k = outBack(prog(1 - tick, 0, 0.3))
  g.at(
    0,
    0,
    0,
    () => {
      g.circle(0, 0, 70, C.ink)
      g.ring(0, 0, 70, C.yellow, 8)
      g.arc(0, 0, 84, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / INTRO_TIME), C.yellow, 10)
      g.text(n, 0, 4, { size: 86, weight: 700, color: C.yellow })
    },
    0.85 + 0.15 * k,
  )
}

/** A slim bar under the card: how long this picture stays up. */
function drawTimer(g: Draw, s: State, now: number): void {
  if (s.phase !== 'play' || !s.pic) return
  const left = 1 - prog(now - s.picAt, 0, s.picFor ?? PICTURE_TIME)
  const w = CARD.w - 80
  const y = CARD.h / 2 - 34
  g.rrect(-w / 2, y - 6, w, 12, 6, alpha(C.ink, 0.12))
  g.rrect(-w / 2, y - 6, Math.max(12, w * left), 12, 6, alpha(C.ink3, 0.55))
}

function drawWinner(g: Draw, side: Side, names: readonly string[], age: number): void {
  const k = outBack(prog(age, 0.2, 0.6))
  if (k <= 0) return
  const label = `${names[side] ?? SIDE[side].name} wins!`
  g.at(
    0,
    0,
    0,
    () => {
      const w = Math.min(760, g.measure(label, 64, 700) + 170)
      g.rrect(-w / 2, -64, w, 128, 64, alpha(C.ink, 0.92), SIDE[side].main, 8)
      g.emoji('🏆', -w / 2 + 64, 0, 66)
      g.text(label, 40, 4, { size: 64, weight: 700, color: SIDE[side].light, maxWidth: w - 150 })
    },
    k,
  )
}

/** The rule for `side`: a plate upright for that player, flipping in at each new round. */
export function drawRule(g: Draw, side: Side, s: State, now: number): void {
  const rule: Rule = s.rule
  const y = frame(side, 500, RULE_Y)
  const size = 48
  const text =
    rule.kind === 'glyph'
      ? 'Tap when you see a'
      : rule.kind === 'colours'
        ? 'Tap when the colours match'
        : rule.kind === 'parity'
          ? `Tap on an ${rule.even ? 'even' : 'odd'} number`
          : `Tap on a number over ${OVER}`
  const e = 78
  const tw = g.measure(text, size, 700)
  const w = Math.min(860, tw + (rule.kind === 'glyph' ? 18 + e : 0) + 100)
  const fresh = s.phase === 'intro' ? now - s.phaseAt : 9
  const flipIn = s.round === 1 ? 1 : outBack(prog(fresh, 0, 0.35))
  const intro = s.phase === 'intro'
  g.at(
    y.x,
    y.y,
    g.orient(side) - g.stage.rot,
    () => {
      g.shadow(0, 50, w * 0.45, 18, 0.3)
      g.tile(-w / 2, -54, w, 112, 56, C.ink3, 10)
      if (intro) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 9)
        g.rrect(-w / 2 - 6, -60, w + 12, 120, 60, undefined, alpha(C.yellow, 0.5 + 0.5 * pulse), 6)
      }
      g.at(0, -5, g.stage.rot, () => {
        const x0 = -w / 2 + 50
        g.text(text, x0 + tw / 2, 3, {
          size,
          weight: 700,
          color: C.white,
          drop: alpha('#000000', 0.35),
        })
        if (rule.kind === 'glyph') g.emoji(rule.glyph, x0 + tw + 18 + e / 2, 1, e)
      })
    },
    1,
    Math.max(0.02, flipIn),
  )
}

/** A player's big arcade button on their half. Presses sink it; a freeze greys it and counts down. */
export function drawButton(g: Draw, s: State, side: Side, now: number): void {
  const col = SIDE[side]
  const b = BUTTON
  const press = 1 - prog(now - s.tapAt[side], 0, 0.14)
  const frozen = s.frozen[side] >= 0 && now < s.frozen[side]
  const won = s.phase === 'point' && s.winner === side
  const champ = s.endAt >= 0 && s.winner === side
  const face = frozen ? mix(shade(col.main, -0.5), C.ink3, 0.6) : won || champ ? C.yellow : col.main
  const depth = 26
  const ta = textAngle(g, side)
  // The lip faces the bottom of whoever looks at it.
  const lit = ta - g.stage.rot
  inFrame(g, side, () => {
    g.at(b.x, b.y, lit, () => {
      // Bezel: a dark ring the button sits in.
      g.shadow(0, b.r + BEZEL - 4, b.r * 0.95, 20, 0.35)
      g.circle(0, 10, b.r + BEZEL, shade(C.ink, 0.05))
      g.circle(
        0,
        0,
        b.r + BEZEL,
        g.lin(0, -b.r - 30, 0, b.r + BEZEL, [
          [0, C.ink4],
          [1, C.ink2],
        ]),
      )
      g.circle(0, 4, b.r + 12, alpha('#000000', 0.55))
      if (won || champ) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 12)
        g.ring(0, 0, b.r + BEZEL, alpha(C.yellow, 0.5 + 0.5 * pulse), 10)
      } else if (!frozen && s.phase === 'play') {
        // Live: the bezel breathes in the team colour.
        g.ring(0, 0, b.r + BEZEL, alpha(col.main, 0.35 + 0.25 * Math.sin(now * 5)), 6)
      }
      const sink = depth * press * 0.7
      g.disc(0, sink - depth * 0.2, b.r, face, depth * (1 - press * 0.7))
      g.alpha(0.5, () =>
        g.ellipse(-b.r * 0.32, sink - b.r * 0.5, b.r * 0.34, b.r * 0.16, '#fff', -0.5),
      )
      g.at(0, sink - depth * 0.2, g.stage.rot, () =>
        g.text(frozen ? 'WAIT' : 'TAP', 0, 4, {
          size: 66,
          weight: 700,
          color: won || champ ? C.ink : frozen ? alpha(C.white, 0.6) : C.white,
          drop: alpha('#000000', 0.3),
        }),
      )
      if (frozen) {
        const left = (s.frozen[side] - now) / FREEZE
        g.arc(
          0,
          0,
          b.r + BEZEL,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Math.max(0, left),
          C.red,
          12,
        )
      }
    })
  })
}

/** Shock ring radius for a hit, for the index's fx (kept here so sizes stay in one place). */
export const HIT_RING = BUTTON.r + 60
