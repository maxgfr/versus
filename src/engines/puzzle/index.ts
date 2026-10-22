/**
 * Puzzle race engine: both players solve the same puzzle, each on their own
 * half (upright for them), and the first to finish wins. In 1P without a
 * computer opponent it is a solo time trial with a stored record.
 *
 * How to build a game on it:
 * - Extend `PuzzleRace<S>` where `S` includes `race` (use `newRace()`).
 *   Generate the puzzle from `ctx.seed` in `setup()` (keep it in instance fields
 *   when it is big: both phones derive it from the same seed, so the state only
 *   carries each player's progress).
 * - Set `recordId` (usually the game id) and optionally `cap` (seconds; when
 *   it runs out the most progress wins).
 * - Lay out in panel-local coords: `w` × `h` is the player's half (1000 × 900),
 *   or the whole stage in solo (1000 × 1800). y = 0 is the far edge, `HEADER`
 *   units are taken by the timer bar. `stepSide(side, dt, taps)` receives this
 *   step's presses already in local coords; `renderPanel(g, side, w, h)` draws.
 * - Call `this.complete(side)` when a side has solved it, `this.penalize(side, s)`
 *   for a mistake, and return 0..1 from `progressOf(side)`.
 * - `keypad()` / `keyAt()` lay out and hit-test an on-canvas number pad.
 */
import { BaseGame, other, type Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { submitRecord, store } from '../../core/store.ts'
import {
  type Frame,
  halfFrame,
  inFrame,
  localView,
  mirrorFx,
  toLocal,
  toWorld,
} from '../runner/frame.ts'

export { toWorld } from '../runner/frame.ts'

/** Height of the timer bar at the top of each panel. */
export const HEADER = 96

export interface RaceSide {
  /** Game time it was solved, or null. */
  done: number | null
  progress: number
  penalty: number
  /** Game time of the last mistake (for the red flash). */
  errAt: number
}

export interface RaceBase {
  race: [RaceSide, RaceSide]
}

export function newRace(): [RaceSide, RaceSide] {
  const one = (): RaceSide => ({ done: null, progress: 0, penalty: 0, errAt: -10 })
  return [one(), one()]
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = Math.floor(s - m * 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

export interface Key {
  x: number
  y: number
  w: number
  h: number
  label: string
}

/** A row (or rows) of equal keys filling `w` from `x`, `cols` per row. */
export function keypad(
  labels: readonly string[],
  x: number,
  y: number,
  w: number,
  h: number,
  cols = labels.length,
  gap = 8,
): Key[] {
  const rows = Math.ceil(labels.length / cols)
  const kw = (w - gap * (cols - 1)) / cols
  const kh = (h - gap * (rows - 1)) / rows
  return labels.map((label, i) => ({
    x: x + (i % cols) * (kw + gap),
    y: y + Math.floor(i / cols) * (kh + gap),
    w: kw,
    h: kh,
    label,
  }))
}

export function keyAt(keys: readonly Key[], px: number, py: number): number {
  return keys.findIndex(
    (k) => px >= k.x - 3 && px <= k.x + k.w + 3 && py >= k.y - 3 && py <= k.y + k.h + 3,
  )
}

export function drawKeys(
  g: Draw,
  keys: readonly Key[],
  color: string,
  o: { dim?: (i: number) => boolean; flash?: number; flashAt?: number; now?: number } = {},
): void {
  keys.forEach((k, i) => {
    const dim = o.dim?.(i) ?? false
    const hot =
      o.flash === i && o.now !== undefined && o.flashAt !== undefined && o.now - o.flashAt < 0.25
    g.tile(k.x, k.y, k.w, k.h, 18, dim ? shade(color, -0.55) : hot ? C.red : color, 9, hot ? 1 : 0)
    g.text(k.label, k.x + k.w / 2, k.y + (k.h - 9) / 2 + 2, {
      size: Math.min(k.h * 0.55, k.w * 0.6),
      weight: 700,
      color: dim ? alpha(C.white, 0.35) : C.white,
    })
  })
}

export abstract class PuzzleRace<S extends RaceBase> extends BaseGame<S> {
  frames!: [Frame, Frame]
  solo = false
  /** Records key (lower time is better). */
  protected abstract recordId: string
  protected cap: number | null = null

  override init(ctx: Parameters<BaseGame<S>['init']>[0]): void {
    this.solo = ctx.mode === '1p' && !ctx.bots[1]
    this.frames = [halfFrame(0, ctx.mode, this.solo), halfFrame(1, ctx.mode)]
    mirrorFx(ctx, this.frames)
    super.init(ctx)
  }

  sides(): Side[] {
    return this.solo ? [0] : [0, 1]
  }

  /** Seconds on a side's clock, penalties included. */
  elapsed(side: Side): number {
    const r = this.s.race[side]
    return (r.done ?? this.time) + r.penalty
  }

  protected abstract stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void
  protected abstract renderPanel(g: Draw, side: Side, w: number, h: number): void
  protected abstract progressOf(side: Side): number

  protected penalize(side: Side, sec: number): void {
    const r = this.s.race[side]
    r.penalty += sec
    r.errAt = this.time
    this.ctx.audio.play('error')
    this.ctx.audio.buzz(30)
    const f = this.frames[side]
    // Beside the clock (centre of the header), not over it.
    const at = toWorld(f, f.w * 0.8, HEADER / 2)
    this.ctx.fx.float(`+${sec}s`, at.x, at.y + (f.angle ? -60 : 60), C.red, 54, side)
  }

  protected complete(side: Side): void {
    const r = this.s.race[side]
    if (r.done !== null || this.over) return
    r.done = this.time
    r.progress = 1
    const t = this.elapsed(side)
    this.ctx.audio.play('coin')
    if (this.solo) {
      const prev = store.records[this.recordId]
      const best = submitRecord(this.recordId, Math.round(t * 10) / 10, true)
      const note = best
        ? `New record: ${fmtTime(t)}`
        : `Time ${fmtTime(t)} · best ${fmtTime(prev ?? t)}`
      this.finish(0, { note, delay: 1.2 })
      return
    }
    this.finish(side, { note: `Solved in ${fmtTime(t)}`, delay: 1.2 })
  }

  protected step(dt: number): void {
    for (const side of this.sides()) {
      const r = this.s.race[side]
      if (r.done !== null) continue
      const f = this.frames[side]
      const taps = this.ctx.input.player(side).downs.map((p) => toLocal(f, p.x, p.y))
      this.stepSide(side, dt, taps)
      if (this.over) return
      r.progress = this.progressOf(side)
    }
    if (this.cap !== null && !this.over && this.time >= this.cap) {
      const [a, b] = this.s.race
      if (this.solo) this.finish(0, { note: 'Out of time' })
      else
        this.finish(a.progress === b.progress ? 'draw' : a.progress > b.progress ? 0 : 1, {
          note: 'Time up',
        })
    }
  }

  private header(g: Draw, side: Side, w: number): void {
    const r = this.s.race[side]
    const col = SIDE[side]
    const flash = Math.max(0, 1 - (this.time - r.errAt) * 3)
    g.rect(-20, -400, w + 40, HEADER + 400, shade(col.main, -0.55))
    // Name, timer, progress (yours and your rival's). Kept inside x 150..850:
    // the pause button sits on the midline at the stage's left edge.
    g.sideMark(side, 170, HEADER / 2, 13, col.light)
    g.text(this.ctx.names[side], 196, HEADER / 2 + 2, {
      size: 34,
      weight: 600,
      align: 'left',
      color: alpha(C.white, 0.85),
      maxWidth: 170,
    })
    const tcol = flash > 0 ? C.red : C.white
    g.text(fmtTime(this.elapsed(side)), 470, HEADER / 2 + 3, { size: 52, weight: 700, color: tcol })
    const bx = w - 430
    const bars: [Side, number][] = this.solo
      ? [[side, 22]]
      : [
          [side, 16],
          [other(side), 10],
        ]
    let y = HEADER / 2 - (this.solo ? 11 : 16)
    for (const [s, hgt] of bars) {
      const p = this.s.race[s].progress
      g.rrect(bx, y, 260, hgt, hgt / 2, alpha('#000000', 0.35))
      if (p > 0)
        g.rrect(bx, y, Math.max(hgt, 260 * p), hgt, hgt / 2, s === side ? col.light : SIDE[s].main)
      y += hgt + 8
    }
  }

  private doneCard(g: Draw, side: Side, w: number, h: number): void {
    const r = this.s.race[side]
    if (r.done === null) return
    const t = outBack(prog(this.time - r.done, 0, 0.4))
    g.alpha(0.6, () => g.rect(-20, HEADER, w + 40, h - HEADER + 400, C.ink))
    g.at(
      w / 2,
      h / 2 + HEADER / 2,
      0,
      () => {
        g.rrect(-260, -110, 520, 220, 50, SIDE[side].main)
        g.text('Solved!', 0, -28, { size: 76, weight: 700 })
        g.text(fmtTime(this.elapsed(side)), 0, 52, {
          size: 48,
          weight: 600,
          color: alpha(C.white, 0.85),
        })
      },
      t,
    )
  }

  render(g: Draw): void {
    g.fillView(C.ink)
    for (const side of this.sides()) {
      const f = this.frames[side]
      inFrame(g, f, () => {
        const v = localView(g, f)
        g.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, shade(SIDE[side].main, -0.78))
        this.renderPanel(g, side, f.w, f.h)
        this.header(g, side, f.w)
        this.doneCard(g, side, f.w, f.h)
      })
    }
    if (!this.solo) {
      g.rect(g.stage.view.x - 2, MID - 7, g.stage.view.w + 4, 14, C.ink)
    }
  }
}
