/**
 * Cards engine: a grid of toy cards that flip in 3D-ish (scaleX squash with
 * shading and a lift), a shared card back, emoji faces, deals with the seeded
 * RNG, and an on-canvas number pad each player owns on their half.
 *
 * How to build a card game (copy src/games/memory):
 * - Lay the table out once with `cardGrid(cols, rows, area)`; hit-test taps
 *   with `cardAt(grid, x, y)`.
 * - Keep per-card facts in `this.s` (deck order, face-up flags, owners, the
 *   game time each card last flipped) so the online guest can render them.
 * - Draw each card with `drawCard`, passing `flip` from `flipAmount(now,
 *   flippedAt, faceUp)` and a `face` painter (usually `g.emoji`). Face glyphs
 *   read upright for whoever sits nearest via `faceAngle(g, y)`.
 * - Deal with `dealPairs(rng, pairs)` (or `shuffle` your own deck).
 * - Quiz games give each side a `NumPad` placed with red-frame coordinates (it
 *   mirrors itself for blue); call `pad.update(input.player(side))` each step,
 *   read `pad.submitted`, and copy `pad.value` into state for online play.
 *   Bots type with `pad.press(key)`.
 */
import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import type { Rng } from '../../core/rng.ts'
import { MID } from '../../core/stage.ts'
import { inFrame, textAngle, toLocal } from '../dice/index.ts'

export interface CardRect {
  /** Centre. */
  x: number
  y: number
  w: number
  h: number
}

/** Cards laid out in a grid filling `area`, keeping `aspect` (h / w). */
export function cardGrid(
  cols: number,
  rows: number,
  area: { x: number; y: number; w: number; h: number },
  gap = 22,
  aspect = 1.12,
): CardRect[] {
  let w = (area.w - gap * (cols - 1)) / cols
  let h = w * aspect
  const maxH = (area.h - gap * (rows - 1)) / rows
  if (h > maxH) {
    h = maxH
    w = h / aspect
  }
  const totalW = cols * w + (cols - 1) * gap
  const totalH = rows * h + (rows - 1) * gap
  const x0 = area.x + (area.w - totalW) / 2
  const y0 = area.y + (area.h - totalH) / 2
  const out: CardRect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: x0 + c * (w + gap) + w / 2, y: y0 + r * (h + gap) + h / 2, w, h })
    }
  }
  return out
}

export function cardAt(cards: readonly CardRect[], x: number, y: number): number {
  return cards.findIndex(
    (c) => Math.abs(x - c.x) <= c.w / 2 + 6 && Math.abs(y - c.y) <= c.h / 2 + 6,
  )
}

/** A shuffled deck holding each of `pairs` values twice. */
export function dealPairs(rng: Rng, pairs: number): number[] {
  const deck: number[] = []
  for (let i = 0; i < pairs; i++) deck.push(i, i)
  return rng.shuffle(deck)
}

/** Glyph sets: colourful, readable at small sizes, kid-friendly. */
export const GLYPHS = {
  animals: [
    '🐶',
    '🐱',
    '🐭',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐸',
    '🐵',
    '🐔',
    '🐧',
    '🐙',
    '🦄',
  ],
  fruit: ['🍎', '🍌', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🍉', '🍋', '🥥', '🫐'],
  food: ['🍕', '🍔', '🌭', '🍟', '🌮', '🍩', '🍪', '🧁', '🍦', '🍰', '🥨', '🍿'],
  things: ['⚽', '🏀', '🎸', '🚀', '🎈', '🎁', '⭐', '🌈', '🔑', '🎲', '🪁', '🧸'],
} as const

/**
 * 0 = back showing, 1 = face showing. Flips take `dur` seconds from
 * `flippedAt` toward the current side.
 */
export function flipAmount(now: number, flippedAt: number, faceUp: boolean, dur = 0.32): number {
  const p = outCubic(prog(now - flippedAt, 0, dur))
  return faceUp ? p : 1 - p
}

/**
 * Glyph rotation so a face reads upright for the nearest player: cards in the
 * top half face blue in local 2P; otherwise everything faces the viewer.
 */
export function faceAngle(g: Draw, y: number): number {
  if (g.flipTop) return y < MID ? Math.PI : 0
  return g.orient()
}

export interface CardOpts {
  /** 0 back … 1 face (from `flipAmount`). */
  flip: number
  /** Paint the face content, centred at (0, 0), card size w × h. */
  face?: (w: number, h: number) => void
  faceColor?: string
  backColor?: string
  /** Owner / highlight ring. */
  ring?: string
  dim?: boolean
  /** Extra lift (0..1), e.g. on hover/selection. */
  lift?: number
  angle?: number
}

/**
 * One card. The flip is a horizontal squash through edge-on, with the card
 * lifting off the table and the near half shading as it turns.
 */
export function drawCard(g: Draw, x: number, y: number, w: number, h: number, o: CardOpts): void {
  const f = Math.max(0, Math.min(1, o.flip))
  const turn = Math.abs(Math.cos(f * Math.PI))
  const showFace = f >= 0.5
  const midFlip = 1 - turn
  const lift = Math.max(midFlip, o.lift ?? 0)
  const r = Math.min(w, h) * 0.13
  const depth = h * 0.05
  g.shadow(x, y + h / 2 + depth, w * 0.48 * Math.max(0.3, turn), h * 0.08, 0.35 - lift * 0.12)
  g.at(
    x,
    y - lift * h * 0.12,
    o.angle ?? 0,
    () => {
      const face = showFace ? (o.faceColor ?? C.cream) : (o.backColor ?? C.purple)
      g.rrect(-w / 2, -h / 2 + depth, w, h, r, shade(face, -0.35))
      if (showFace) {
        g.rrect(
          -w / 2,
          -h / 2,
          w,
          h,
          r,
          g.lin(0, -h / 2, 0, h / 2, [
            [0, shade(face, 0.1)],
            [1, shade(face, -0.06)],
          ]),
        )
        g.rrect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16, r * 0.7, undefined, alpha(C.ink, 0.08), 4)
        o.face?.(w, h)
      } else {
        drawCardBack(g, w, h, face)
      }
      // Turning away from the light.
      if (midFlip > 0.05) g.rrect(-w / 2, -h / 2, w, h + depth, r, alpha('#000000', midFlip * 0.35))
      if (o.ring)
        g.rrect(-w / 2 - 6, -h / 2 - 6, w + 12, h + depth + 12, r + 6, undefined, o.ring, 8)
      if (o.dim) g.rrect(-w / 2, -h / 2, w, h + depth, r, alpha(C.ink, 0.4))
    },
    Math.max(0.04, turn) * (1 + lift * 0.06),
    1 + lift * 0.06,
  )
}

/** The shared card back: diamond lattice on the back colour with a centre medallion. */
export function drawCardBack(g: Draw, w: number, h: number, color: string = C.purple): void {
  const r = Math.min(w, h) * 0.13
  g.rrect(
    -w / 2,
    -h / 2,
    w,
    h,
    r,
    g.lin(-w / 2, -h / 2, w / 2, h / 2, [
      [0, shade(color, 0.15)],
      [1, shade(color, -0.2)],
    ]),
  )
  g.clip(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, r * 0.7, () => {
    const s = w / 4
    for (let yy = -h; yy < h; yy += s) {
      for (let xx = -w; xx < w; xx += s) {
        const ox = (Math.round(yy / s) % 2) * (s / 2)
        g.poly(
          [
            xx + ox,
            yy - s * 0.35,
            xx + ox + s * 0.35,
            yy,
            xx + ox,
            yy + s * 0.35,
            xx + ox - s * 0.35,
            yy,
          ],
          alpha('#ffffff', 0.09),
        )
      }
    }
  })
  g.rrect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, r * 0.7, undefined, alpha('#ffffff', 0.35), 4)
  const m = Math.min(w, h) * 0.22
  g.circle(0, 0, m, shade(color, -0.3))
  g.circle(0, 0, m, undefined, alpha('#ffffff', 0.55), 5)
  g.star(0, 0, m * 0.62, C.yellow)
  g.alpha(0.5, () => g.ellipse(-w * 0.18, -h * 0.3, w * 0.22, h * 0.07, '#ffffff', -0.4))
}

/** A big glyph on a card face. */
export function emojiFace(g: Draw, glyph: string, angle: number): (w: number, h: number) => void {
  return (w, h) => g.emoji(glyph, 0, 0, Math.min(w, h) * 0.62, angle)
}

// ---------- number pad ----------

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'] as const
export type PadKey = (typeof KEYS)[number]

/**
 * One player's number pad, laid out in red's frame and mirrored for blue, so
 * the keys sit on the player's own half. 3 × 4 keys with a value display above.
 */
export class NumPad {
  value = ''
  /** The value entered, for exactly one step after ✓. */
  submitted: string | null = null
  enabled = true
  private flashKey = -1
  private flashAt = -10
  private now = 0
  private queue: PadKey[] = []

  constructor(
    readonly side: Side,
    /** Centre of the key block, red frame. */
    public x: number,
    public y: number,
    public key = 118,
    public maxLen = 4,
    public gap = 14,
  ) {}

  private keyCentre(i: number): { x: number; y: number } {
    const c = i % 3
    const r = Math.floor(i / 3)
    const s = this.key + this.gap
    return { x: this.x + (c - 1) * s, y: this.y + (r - 1.5) * s }
  }

  /** Bot typing: queued, one key per update. */
  press(k: PadKey): void {
    this.queue.push(k)
  }

  type(value: string): void {
    for (const ch of value) this.press(ch as PadKey)
    this.press('✓')
  }

  clear(): void {
    this.value = ''
    this.queue = []
  }

  private apply(i: number): void {
    const k = KEYS[i]
    if (!k) return
    this.flashKey = i
    this.flashAt = this.now
    if (k === '⌫') this.value = this.value.slice(0, -1)
    else if (k === '✓') {
      if (this.value) {
        this.submitted = this.value
        this.value = ''
      }
    } else if (this.value.length < this.maxLen) this.value = this.value === '0' ? k : this.value + k
  }

  /** Returns the key pressed this step, if any. */
  update(input: PlayerInput, now: number): PadKey | null {
    this.now = now
    this.submitted = null
    if (!this.enabled) {
      this.queue = []
      return null
    }
    const q = this.queue.shift()
    if (q) {
      this.apply(KEYS.indexOf(q))
      return q
    }
    for (const p of input.downs) {
      const l = toLocal(this.side, p.x, p.y)
      for (let i = 0; i < KEYS.length; i++) {
        const c = this.keyCentre(i)
        if (
          Math.abs(l.x - c.x) <= (this.key + this.gap) / 2 &&
          Math.abs(l.y - c.y) <= (this.key + this.gap) / 2
        ) {
          this.apply(i)
          return KEYS[i] ?? null
        }
      }
    }
    return null
  }

  /** Where the value display sits (red frame), above the keys. */
  get displayY(): number {
    return this.y - 2 * (this.key + this.gap) - 30
  }

  render(g: Draw, o: { placeholder?: string; tint?: string } = {}): void {
    const col = SIDE[this.side]
    const ta = textAngle(g, this.side)
    inFrame(g, this.side, () => {
      // Display
      const dw = 3 * this.key + 2 * this.gap
      g.rrect(this.x - dw / 2, this.displayY - 50, dw, 100, 28, alpha(C.ink, 0.75))
      g.at(this.x, this.displayY, ta, () =>
        g.text(this.value || o.placeholder || '', 0, 2, {
          size: 64,
          weight: 700,
          color: this.value ? C.white : alpha(C.white, 0.3),
        }),
      )
      KEYS.forEach((k, i) => {
        const c = this.keyCentre(i)
        const pressed = i === this.flashKey ? 1 - prog(this.now - this.flashAt, 0, 0.15) : 0
        const face = k === '✓' ? (o.tint ?? col.main) : k === '⌫' ? C.ink4 : shade(C.ink3, 0.12)
        g.alpha(this.enabled ? 1 : 0.4, () => {
          g.tile(c.x - this.key / 2, c.y - this.key / 2, this.key, this.key, 26, face, 10, pressed)
          g.at(c.x, c.y - 5 + pressed * 10, ta, () =>
            g.text(k, 0, 0, {
              size: k === '✓' || k === '⌫' ? 50 : 58,
              weight: 700,
              color: C.white,
            }),
          )
        })
      })
    })
  }
}

/** Pop scale for a card that just got matched (1 → 1.15 → 1). */
export function matchPop(now: number, at: number): number {
  const t = now - at
  if (t < 0 || t > 0.45) return 1
  return 1 + 0.15 * Math.sin(outBack(t / 0.45) * Math.PI)
}
