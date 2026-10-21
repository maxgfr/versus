import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { namePill } from '../../core/hud.ts'
import { other, type Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import type { Stage } from '../../core/stage.ts'
import { H } from '../../core/stage.ts'
import { drawCard, flipAmount } from '../../engines/cards/index.ts'
import type { State } from './index.ts'
import { COLS, FACES, type Face, QUESTIONS, ROWS } from './rules.ts'

/** Each side's board, in its frame (red's bottom half, mirrored for blue). Centred, clear of the pause button. */
export const BOARD = { x0: 122, y0: 932, cw: 116, ch: 110, gap: 12 }
/** The question chips, below the board in the same frame. */
export const CHIPS = { x0: 70, y0: 1440, w: 206, h: 58, gap: 12, rowGap: 68, cols: 4 }
/** HUD row: the secret card on the left, the Guess button on the right (frame x). */
export const SECRET_X = 120
export const GUESS_X = 868
export const SECRET = { w: 96, h: 120 }
export const GUESS = { w: 196, h: 78 }
/** Frame x of the "faces left" counter in the HUD row. */
const COUNT_X = 282

const PANEL = {
  x: BOARD.x0 - 14,
  y: BOARD.y0 - 14,
  w: COLS * BOARD.cw + (COLS - 1) * BOARD.gap + 28,
  h: ROWS * BOARD.ch + (ROWS - 1) * BOARD.gap + 28,
}
const BOARD_CX = PANEL.x + PANEL.w / 2
const BOARD_CY = PANEL.y + PANEL.h / 2

export function cellXY(i: number): { x: number; y: number } {
  const c = i % COLS
  const r = Math.floor(i / COLS)
  return {
    x: BOARD.x0 + BOARD.cw / 2 + c * (BOARD.cw + BOARD.gap),
    y: BOARD.y0 + BOARD.ch / 2 + r * (BOARD.ch + BOARD.gap),
  }
}

/** Board face under a frame point, or -1. */
export function cellAt(x: number, y: number): number {
  for (let i = 0; i < FACES; i++) {
    const c = cellXY(i)
    if (
      Math.abs(x - c.x) <= BOARD.cw / 2 + BOARD.gap / 2 &&
      Math.abs(y - c.y) <= BOARD.ch / 2 + BOARD.gap / 2
    )
      return i
  }
  return -1
}

export function chipXY(q: number): { x: number; y: number } {
  const c = q % CHIPS.cols
  const r = Math.floor(q / CHIPS.cols)
  return {
    x: CHIPS.x0 + CHIPS.w / 2 + c * (CHIPS.w + CHIPS.gap),
    y: CHIPS.y0 + CHIPS.h / 2 + r * CHIPS.rowGap,
  }
}

/** Question chip under a frame point, or -1. */
export function chipAt(x: number, y: number): number {
  for (let q = 0; q < QUESTIONS.length; q++) {
    const c = chipXY(q)
    if (Math.abs(x - c.x) <= CHIPS.w / 2 + 4 && Math.abs(y - c.y) <= CHIPS.h / 2 + 4) return q
  }
  return -1
}

/** Frame y of a side's HUD row: just inside its edge, safe-area aware (matches `hudY`). */
export function hudFrameY(stage: Stage, side: Side): number {
  return side === 0 ? stage.edge(0) - 70 : H - (stage.edge(1) + 70)
}

/** Frame y of the secret card (a touch higher than the row so its lip clears the edge). */
export const secretFrameY = (stage: Stage, side: Side): number => hudFrameY(stage, side) - 8

/** Frame point → world point, the same mapping `frame` uses for every side. */
export const hudWorld = (stage: Stage, side: Side, x: number): { x: number; y: number } =>
  frame(side, x, hudFrameY(stage, side))

// ---------- the faces ----------

const SKIN_TONES = ['#ffe3c8', '#f6c49b', '#dc9b6a', '#b06f45', '#7a4a2c'] as const
const HAIR_COLOURS = ['#f7cf55', '#8a5432', '#2b2124', '#e0582c'] as const
const EYE_COLOURS = ['#3b8cff', '#2fbf6f', '#7a4a26'] as const
const HAT_COLOURS = [C.purple, C.teal, C.yellow, C.pink] as const
/** Shirts and backdrops are cosmetic only (not asked about): picked from the face's slot. */
const SHIRTS = ['#6c7bd9', '#46b39d', '#e0a33a', '#c46fc9', '#5aa7d6', '#e07a5f'] as const
const BACKDROPS = ['#d7ecff', '#ffe1ec', '#e2f7dd', '#fff1c9', '#ece2ff', '#d9f5f2'] as const

/**
 * One cute procedural portrait centred on (0, 0) in a w × h card: backdrop,
 * shoulders, head, hair, hat, beard, eyes, glasses and mouth. Shapes only (no
 * text) so it reads the same from both ends; `slot` only varies the shirt and
 * backdrop colours.
 */
export function drawFace(g: Draw, f: Face, w: number, h: number, slot = 0): void {
  const ink = C.ink
  const skin = SKIN_TONES[f.skin] ?? SKIN_TONES[0]
  const skinDark = shade(skin, -0.16)
  const hair = HAIR_COLOURS[f.colour] ?? HAIR_COLOURS[1]
  const hairDark = shade(hair, -0.25)
  const eyes = EYE_COLOURS[f.eyes] ?? EYE_COLOURS[0]
  const shirt = SHIRTS[slot % SHIRTS.length] ?? SHIRTS[0]
  const bg = BACKDROPS[(slot * 5 + 2) % BACKDROPS.length] ?? BACKDROPS[0]
  const r = Math.min(w * 0.3, h * 0.27)
  const hx = 0
  const hy = -h * 0.04
  const pad = Math.min(w, h) * 0.07
  g.clip(-w / 2 + pad, -h / 2 + pad, w - pad * 2, h - pad * 2, Math.min(w, h) * 0.1, () => {
    g.rect(
      -w / 2,
      -h / 2,
      w,
      h,
      g.lin(0, -h / 2, 0, h / 2, [
        [0, shade(bg, 0.3)],
        [1, bg],
      ]),
    )
    // Long hair falls behind the shoulders.
    if (f.hair === 2) {
      g.path((c) => {
        c.moveTo(hx - r * 1.08, hy - r * 0.2)
        c.quadraticCurveTo(hx - r * 1.25, hy + r * 1.5, hx - r * 0.8, hy + r * 1.75)
        c.lineTo(hx + r * 0.8, hy + r * 1.75)
        c.quadraticCurveTo(hx + r * 1.25, hy + r * 1.5, hx + r * 1.08, hy - r * 0.2)
        c.closePath()
      }, hairDark)
    }
    // Shoulders and neck.
    g.path((c) => {
      c.moveTo(hx - r * 1.55, h / 2)
      c.quadraticCurveTo(hx - r * 1.45, hy + r * 1.15, hx, hy + r * 1.1)
      c.quadraticCurveTo(hx + r * 1.45, hy + r * 1.15, hx + r * 1.55, h / 2)
      c.closePath()
    }, shirt)
    g.rrect(hx - r * 0.3, hy + r * 0.6, r * 0.6, r * 0.6, r * 0.2, skinDark)
    g.path(
      (c) => {
        c.moveTo(hx - r * 0.36, hy + r * 1.12)
        c.quadraticCurveTo(hx, hy + r * 1.42, hx + r * 0.36, hy + r * 1.12)
      },
      undefined,
      shade(shirt, -0.25),
      r * 0.1,
    )
    if (f.hair === 2) {
      g.ellipse(hx - r * 0.95, hy + r * 0.9, r * 0.32, r * 0.6, hair, 0.2)
      g.ellipse(hx + r * 0.95, hy + r * 0.9, r * 0.32, r * 0.6, hair, -0.2)
    }
    // Ears and head.
    for (const sx of [-1, 1]) g.circle(hx + sx * r * 0.92, hy + r * 0.08, r * 0.2, skinDark)
    g.ellipse(
      hx,
      hy,
      r * 0.9,
      r * 0.98,
      g.rad(
        hx,
        hy,
        r * 0.1,
        r,
        [
          [0, shade(skin, 0.12)],
          [1, skin],
        ],
        hx - r * 0.3,
        hy - r * 0.4,
      ),
    )
    // Beard hugs the jaw (drawn before the mouth so the smile shows through).
    if (f.beard) {
      const bc = f.hair === 0 ? HAIR_COLOURS[1] : hair
      g.path((c) => {
        c.moveTo(hx - r * 0.9, hy + r * 0.05)
        c.quadraticCurveTo(hx - r * 0.88, hy + r * 1.2, hx, hy + r * 1.22)
        c.quadraticCurveTo(hx + r * 0.88, hy + r * 1.2, hx + r * 0.9, hy + r * 0.05)
        c.quadraticCurveTo(hx + r * 0.6, hy + r * 0.5, hx, hy + r * 0.32)
        c.quadraticCurveTo(hx - r * 0.6, hy + r * 0.5, hx - r * 0.9, hy + r * 0.05)
        c.closePath()
      }, bc)
    }
    // Hair on top.
    if (f.hair === 1) {
      g.path((c) => {
        c.moveTo(hx - r * 0.95, hy - r * 0.05)
        c.quadraticCurveTo(hx - r * 1.0, hy - r * 1.12, hx, hy - r * 1.08)
        c.quadraticCurveTo(hx + r * 1.0, hy - r * 1.12, hx + r * 0.95, hy - r * 0.05)
        c.quadraticCurveTo(hx + r * 0.7, hy - r * 0.55, hx + r * 0.1, hy - r * 0.55)
        c.quadraticCurveTo(hx - r * 0.5, hy - r * 0.62, hx - r * 0.95, hy - r * 0.05)
        c.closePath()
      }, hair)
    } else if (f.hair === 2) {
      g.path((c) => {
        c.moveTo(hx - r * 1.02, hy + r * 0.3)
        c.quadraticCurveTo(hx - r * 1.08, hy - r * 1.15, hx, hy - r * 1.1)
        c.quadraticCurveTo(hx + r * 1.08, hy - r * 1.15, hx + r * 1.02, hy + r * 0.3)
        c.quadraticCurveTo(hx + r * 0.8, hy - r * 0.45, hx, hy - r * 0.55)
        c.quadraticCurveTo(hx - r * 0.8, hy - r * 0.45, hx - r * 1.02, hy + r * 0.3)
        c.closePath()
      }, hair)
    } else if (f.hair === 3) {
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * 0.92 + (k / 8) * Math.PI * 1.16
        g.circle(hx + Math.cos(a) * r * 0.86, hy - r * 0.22 + Math.sin(a) * r * 0.8, r * 0.3, hair)
      }
      g.ellipse(hx, hy - r * 0.62, r * 0.7, r * 0.34, hair)
    } else {
      // Bald: a bit of shine.
      g.alpha(0.45, () =>
        g.ellipse(hx - r * 0.3, hy - r * 0.62, r * 0.26, r * 0.12, '#ffffff', -0.4),
      )
    }
    if (f.hair !== 0 && f.hair !== 3) {
      g.alpha(0.35, () =>
        g.ellipse(hx - r * 0.38, hy - r * 0.8, r * 0.28, r * 0.09, '#ffffff', -0.3),
      )
    }
    // Hat: a round cap with a brim and a bobble.
    if (f.hat) {
      const hc = HAT_COLOURS[f.hatColour] ?? C.purple
      g.path((c) => {
        c.moveTo(hx - r * 0.98, hy - r * 0.5)
        c.quadraticCurveTo(hx - r * 0.95, hy - r * 1.42, hx, hy - r * 1.42)
        c.quadraticCurveTo(hx + r * 0.95, hy - r * 1.42, hx + r * 0.98, hy - r * 0.5)
        c.closePath()
      }, hc)
      g.rrect(hx - r * 1.12, hy - r * 0.62, r * 2.24, r * 0.26, r * 0.13, shade(hc, -0.28))
      g.circle(hx, hy - r * 1.45, r * 0.17, C.white)
      g.alpha(0.35, () => g.ellipse(hx - r * 0.4, hy - r * 1.1, r * 0.25, r * 0.1, '#ffffff', -0.4))
    }
    // Eyes: whites, coloured iris, pupil, catchlight.
    for (const sx of [-1, 1]) {
      const ex = hx + sx * r * 0.36
      const ey = hy - r * 0.04
      g.ellipse(ex, ey, r * 0.22, r * 0.24, '#ffffff')
      g.circle(ex, ey + r * 0.03, r * 0.15, eyes)
      g.circle(ex, ey + r * 0.03, r * 0.075, ink)
      g.circle(ex - r * 0.05, ey - r * 0.03, r * 0.045, '#ffffff')
      g.line(
        ex - r * 0.17,
        ey - r * 0.36,
        ex + r * 0.15,
        ey - r * 0.4 + sx * r * 0.02,
        shade(hair, -0.35),
        r * 0.08,
      )
    }
    if (f.glasses) {
      for (const sx of [-1, 1]) {
        g.rrect(
          hx + sx * r * 0.36 - r * 0.3,
          hy - r * 0.3,
          r * 0.6,
          r * 0.52,
          r * 0.18,
          alpha('#ffffff', 0.18),
          ink,
          r * 0.09,
        )
      }
      g.line(hx - r * 0.07, hy - r * 0.08, hx + r * 0.07, hy - r * 0.08, ink, r * 0.08)
    }
    // Nose, cheeks and mouth.
    g.ellipse(hx, hy + r * 0.24, r * 0.1, r * 0.07, skinDark)
    g.alpha(0.45, () => {
      g.ellipse(hx - r * 0.6, hy + r * 0.32, r * 0.15, r * 0.09, C.pink)
      g.ellipse(hx + r * 0.6, hy + r * 0.32, r * 0.15, r * 0.09, C.pink)
    })
    if (f.smile) {
      g.path((c) => {
        c.moveTo(hx - r * 0.28, hy + r * 0.44)
        c.quadraticCurveTo(hx, hy + r * 0.86, hx + r * 0.28, hy + r * 0.44)
        c.closePath()
      }, '#7a2230')
      g.ellipse(hx, hy + r * 0.64, r * 0.12, r * 0.06, '#ff8a9a')
      g.rrect(hx - r * 0.2, hy + r * 0.44, r * 0.4, r * 0.08, r * 0.03, '#ffffff')
    } else {
      g.line(hx - r * 0.16, hy + r * 0.56, hx + r * 0.16, hy + r * 0.56, '#7a2230', r * 0.08)
    }
  })
}

// ---------- the board ----------

/** A team-coloured card back for a face that has been ruled out. */
function backColor(side: Side): string {
  return shade(SIDE[side].main, -0.38)
}

export function renderBoard(
  g: Draw,
  s: State,
  now: number,
  side: Side,
  o: { active: boolean; guessing: boolean },
): void {
  inFrame(g, side, () => {
    const ta = textAngle(g, side)
    // The board tray, lit in the team colour on your turn.
    const base = o.active ? shade(SIDE[side].main, -0.42) : shade(SIDE[side].main, -0.66)
    g.rrect(PANEL.x, PANEL.y + 12, PANEL.w, PANEL.h, 34, shade(SIDE[side].main, -0.8))
    g.rrect(
      PANEL.x,
      PANEL.y,
      PANEL.w,
      PANEL.h,
      34,
      g.lin(0, PANEL.y, 0, PANEL.y + PANEL.h, [
        [0, shade(base, 0.08)],
        [1, shade(base, -0.12)],
      ]),
    )
    if (o.active) {
      const pulse = 0.5 + 0.5 * Math.sin(g.t * 5)
      g.rrect(
        PANEL.x - 4,
        PANEL.y - 4,
        PANEL.w + 8,
        PANEL.h + 8,
        38,
        undefined,
        alpha(o.guessing ? C.yellow : SIDE[side].light, 0.35 + 0.35 * pulse),
        6,
      )
    }
    for (let i = 0; i < FACES; i++) {
      const c = cellXY(i)
      const f = s.faces[i]
      if (!f) continue
      const down = !!s.down[side][i]
      const flip = flipAmount(now, s.flipAt[side][i] ?? -10, !down, 0.38)
      const pick = o.guessing && !down
      const wobble = pick ? Math.sin(g.t * 7 + i * 0.9) * 0.025 : 0
      drawCard(g, c.x, c.y, BOARD.cw, BOARD.ch, {
        flip,
        face: (cw, ch) => g.at(0, 0, ta, () => drawFace(g, f, cw, ch, i)),
        faceColor: C.cream,
        backColor: backColor(side),
        ...(pick ? { ring: alpha(C.yellow, 0.7 + 0.3 * Math.sin(g.t * 6 + i)) } : {}),
        angle: wobble,
      })
    }
  })
}

/** The speech bubble with the answer to the question just asked, over the asker's board. */
export function renderAnswer(g: Draw, s: State, now: number): void {
  const a = s.last
  if (!a) return
  const t = now - a.at
  if (t < 0 || t > a.hold + 0.3) return
  const pop = outBack(prog(t, 0, 0.28))
  const answerPop = outBack(prog(t, 0.32, 0.6))
  const fade = 1 - prog(t, a.hold, a.hold + 0.3)
  const q = QUESTIONS[a.q]
  if (!q) return
  const col = a.yes ? C.green : C.red
  inFrame(g, a.side, () => {
    const ta = textAngle(g, a.side)
    g.alpha(fade, () =>
      g.at(BOARD_CX, BOARD_CY, ta, () => {
        g.at(
          0,
          0,
          0,
          () => {
            const w = 560
            const hh = 230
            g.rrect(-w / 2 + 6, -hh / 2 + 14, w, hh, 48, alpha('#000000', 0.35))
            g.rrect(-w / 2, -hh / 2, w, hh, 48, C.white)
            g.poly([-30, hh / 2 - 2, 30, hh / 2 - 2, 0, hh / 2 + 34], C.white)
            g.text(q.text, 0, -hh / 2 + 56, { size: 44, weight: 600, color: C.ink })
            g.at(
              0,
              30,
              0,
              () => {
                g.rrect(-150, -48, 300, 96, 48, col)
                g.rrect(-146, -46, 292, 44, 22, alpha('#ffffff', 0.22))
                mark(g, -88, 0, 30, a.yes, C.white)
                g.text(a.yes ? 'YES' : 'NO', 28, 3, { size: 64, weight: 700, color: C.white })
              },
              answerPop,
              answerPop,
            )
          },
          pop,
          pop,
        )
      }),
    )
  })
}

/** A tick or a cross drawn with strokes (never colour alone). */
function mark(g: Draw, x: number, y: number, r: number, yes: boolean, color: string): void {
  if (yes) {
    g.path(
      (c) => {
        c.moveTo(x - r * 0.75, y)
        c.lineTo(x - r * 0.2, y + r * 0.6)
        c.lineTo(x + r * 0.8, y - r * 0.6)
      },
      undefined,
      color,
      r * 0.32,
    )
  } else {
    g.line(x - r * 0.6, y - r * 0.6, x + r * 0.6, y + r * 0.6, color, r * 0.32)
    g.line(x - r * 0.6, y + r * 0.6, x + r * 0.6, y - r * 0.6, color, r * 0.32)
  }
}

export function renderChips(
  g: Draw,
  s: State,
  now: number,
  side: Side,
  asking: boolean,
  guessing: boolean,
): void {
  inFrame(g, side, () => {
    const ta = textAngle(g, side)
    QUESTIONS.forEach((q, k) => {
      const c = chipXY(k)
      const a = s.answers[side][k] ?? null
      const live = asking && a === null
      const fill =
        a === true
          ? '#25936a'
          : a === false
            ? shade(C.ink3, 0.06)
            : live
              ? SIDE[side].main
              : shade(SIDE[side].main, -0.55)
      const just = s.last && s.last.side === side && s.last.q === k ? s.last.at : -10
      const pop = 1 + 0.12 * Math.sin(Math.PI * prog(now - just, 0, 0.35))
      g.at(
        c.x,
        c.y,
        0,
        () => {
          g.tile(-CHIPS.w / 2, -CHIPS.h / 2, CHIPS.w, CHIPS.h, 24, fill, 9)
          g.at(0, -4, ta, () => {
            if (a === null) {
              g.text(q.text, 0, 2, {
                size: 34,
                weight: 600,
                color: live ? C.white : alpha(C.white, 0.7),
                maxWidth: CHIPS.w - 24,
              })
            } else {
              g.text(q.text, 16, 2, {
                size: 34,
                weight: 600,
                color: alpha(C.white, a ? 0.95 : 0.55),
                maxWidth: CHIPS.w - 62,
              })
              g.circle(
                -CHIPS.w / 2 + 26,
                0,
                17,
                a ? alpha('#ffffff', 0.25) : alpha('#000000', 0.25),
              )
              mark(g, -CHIPS.w / 2 + 26, 0, 11, a, a ? C.white : C.redLight)
            }
          })
        },
        pop,
      )
    })
    if (guessing) {
      // Questions are off while choosing a face: say what to do instead.
      const x = CHIPS.x0 - 8
      const y = CHIPS.y0 - 10
      const w = CHIPS.cols * CHIPS.w + (CHIPS.cols - 1) * CHIPS.gap + 16
      const h = 2 * CHIPS.rowGap + CHIPS.h + 20
      g.rrect(x, y, w, h, 30, alpha(C.ink, 0.82))
      g.rrect(x, y, w, h, 30, undefined, alpha(C.yellow, 0.6 + 0.3 * Math.sin(g.t * 6)), 5)
      g.at(500, y + h / 2, ta, () => {
        g.text('Tap the face you think it is', 0, -24, { size: 42, weight: 700, color: C.yellow })
        g.text('Right wins · wrong loses', 0, 34, {
          size: 34,
          weight: 600,
          color: alpha(C.white, 0.8),
        })
      })
    }
  })
}

/** The secret card in a side's HUD row: face up when revealed, otherwise a card back to hold. */
export function renderSecret(
  g: Draw,
  stage: Stage,
  s: State,
  side: Side,
  o: { revealed: boolean; peeking: boolean; holdHint: boolean; flippedAt: number; now: number },
): void {
  const p = frame(side, SECRET_X, secretFrameY(stage, side))
  const f = s.faces[s.secret[side]]
  const flip =
    o.flippedAt > 0 ? flipAmount(o.now, o.flippedAt, o.revealed, 0.4) : o.revealed ? 1 : 0
  const { w, h } = SECRET
  g.at(p.x, p.y, g.orient(side), () => {
    if (flip >= 0.5) {
      drawCard(g, 0, 0, w, h, {
        flip,
        face: (cw, ch) => {
          if (f) drawFace(g, f, cw, ch, s.secret[side])
        },
        faceColor: C.cream,
        ...(o.peeking ? { ring: C.yellow, lift: 0.5 } : {}),
      })
      return
    }
    // The back, squashed through the same turn as a card flip.
    const turn = Math.max(0.04, Math.abs(Math.cos(flip * Math.PI)))
    g.shadow(0, h / 2 + 6, w * 0.48 * turn, 10, 0.35)
    g.at(
      0,
      0,
      0,
      () => {
        const col = SIDE[side].main
        g.rrect(-w / 2, -h / 2 + 6, w, h, 16, shade(col, -0.4))
        g.rrect(
          -w / 2,
          -h / 2,
          w,
          h,
          16,
          g.lin(0, -h / 2, 0, h / 2, [
            [0, shade(col, 0.15)],
            [1, shade(col, -0.15)],
          ]),
        )
        g.rrect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 11, undefined, alpha('#ffffff', 0.45), 4)
        if (o.holdHint) {
          // Hold to peek: an eye and the word.
          g.ellipse(0, -14, 26, 17, C.white)
          g.circle(0, -14, 11, C.ink)
          g.circle(-4, -18, 4, C.white)
          g.text('HOLD', 0, 32, { size: 24, weight: 700, color: C.white })
        } else {
          g.text('?', 0, 4, { size: 60, weight: 700, color: C.white, drop: alpha(C.ink, 0.4) })
        }
        g.alpha(0.35, () => g.ellipse(-w * 0.18, -h * 0.32, w * 0.2, h * 0.06, '#ffffff', -0.4))
      },
      turn,
      1,
    )
  })
}

export function renderGuessButton(
  g: Draw,
  stage: Stage,
  side: Side,
  active: boolean,
  armed: boolean,
): void {
  const p = hudWorld(stage, side, GUESS_X)
  const fill = armed ? C.yellow : active ? SIDE[side].main : shade(SIDE[side].main, -0.55)
  g.at(p.x, p.y, g.orient(side), () => {
    if (armed) {
      const pulse = 0.5 + 0.5 * Math.sin(g.t * 7)
      g.alpha(0.3 + 0.3 * pulse, () =>
        g.rrect(-GUESS.w / 2 - 10, -GUESS.h / 2 - 10, GUESS.w + 20, GUESS.h + 20, 40, C.yellow),
      )
    }
    g.tile(-GUESS.w / 2, -GUESS.h / 2, GUESS.w, GUESS.h, 34, fill, 12)
    g.text(armed ? 'Cancel' : 'Guess!', 0, -3, {
      size: 40,
      weight: 700,
      color: armed ? C.ink : active ? C.white : alpha(C.white, 0.6),
    })
  })
}

/** How many faces a side still has standing, beside its secret card. */
export function renderCount(g: Draw, stage: Stage, s: State, side: Side, now: number): void {
  const p = hudWorld(stage, side, COUNT_X)
  const left = s.down[side].filter((d) => !d).length
  // Count down in step with the flips, so the number drops as the cards fall.
  const pending = s.down[side].filter((d, i) => d && (s.flipAt[side][i] ?? -10) > now).length
  const shown = left + pending
  g.at(p.x, p.y, g.orient(side), () => {
    g.text(shown, 0, -10, {
      size: 54,
      weight: 700,
      color: SIDE[side].light,
      drop: alpha('#000', 0.4),
    })
    g.text('left', 0, 34, { size: 34, weight: 600, color: alpha(C.white, 0.6) })
  })
}

export function renderHud(
  g: Draw,
  names: [string, string],
  pill: (side: Side) => { text?: string; active: boolean },
): void {
  for (const side of [0, 1] as Side[]) {
    const p = pill(side)
    namePill(
      g,
      side,
      names[side],
      p.text
        ? { active: p.active, text: p.text, x: frame(side, 560, 0).x }
        : { active: p.active, x: frame(side, 560, 0).x },
    )
  }
}

/**
 * The ending: over each board, the face that side was hunting pops up big; the
 * guesser's gets a stamp (tick when right, cross when wrong).
 */
export function renderEnding(g: Draw, s: State, now: number): void {
  const e = s.end
  if (!e) return
  const t = now - e.at
  if (t < 0.25) return
  for (const side of [0, 1] as Side[]) {
    const target = s.secret[other(side)]
    const f = s.faces[target]
    if (!f) continue
    const k = outBack(
      prog(t, 0.25 + (side === e.side ? 0 : 0.15), 0.65 + (side === e.side ? 0 : 0.15)),
    )
    if (k <= 0) continue
    inFrame(g, side, () => {
      const ta = textAngle(g, side)
      g.alpha(0.75 * prog(t, 0.25, 0.5), () =>
        g.rrect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 34, alpha(C.ink, 0.7)),
      )
      g.at(BOARD_CX, BOARD_CY + 6, ta, () => {
        g.at(
          0,
          0,
          0,
          () => {
            const w = 230
            const h = 270
            drawCard(g, 0, 0, w, h, {
              flip: 1,
              face: (cw, ch) => drawFace(g, f, cw, ch, target),
              faceColor: C.cream,
              ring: side === e.side ? (e.right ? C.yellow : C.red) : SIDE[other(side)].main,
            })
            const label = side === e.side ? (e.right ? 'Got it!' : 'It was…') : 'Their face'
            g.text(label, 0, -h / 2 - 44, {
              size: 46,
              weight: 700,
              color: C.white,
              drop: alpha('#000', 0.5),
            })
            if (side === e.side) {
              const st = outBack(prog(t, 0.7, 0.95))
              if (st > 0)
                g.at(
                  w * 0.36,
                  h * 0.3,
                  -0.25,
                  () => {
                    g.circle(0, 0, 54, e.right ? '#25936a' : C.red)
                    g.circle(0, 0, 54, undefined, C.white, 6)
                    mark(g, 0, 0, 30, e.right, C.white)
                  },
                  st * 1.0,
                  st * 1.0,
                )
            }
          },
          k,
          k,
        )
      })
    })
  }
}
