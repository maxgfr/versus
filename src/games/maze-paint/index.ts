import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { Rng } from '../../core/rng.ts'
import { newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { toLocal } from '../../engines/runner/frame.ts'
import { PACE, Pilot } from './bot.ts'
import {
  CLEAR_SECONDS,
  drawPanel,
  layout,
  paintTime,
  type PanelView,
  resetRect,
  rollSeconds,
} from './render.ts'
import {
  countPainted,
  DX,
  DY,
  generateLevel,
  LEVEL_SIZES,
  type Level,
  roll,
  startPaint,
  stuck,
} from './rules.ts'

/** Seconds added when a player restarts a level. */
const RESTART_COST = 5
/** Shortest swipe, in panel-local units. */
const SWIPE = 60
/** Seconds of stillness before the yellow arrows nudge a human player. */
const NUDGE = 2.5

interface Panel {
  /** Index of the level being played. */
  lv: number
  pos: number
  painted: number[]
  /** The last roll: from tile, direction, tiles entered, when it began. */
  from: number
  dir: number
  len: number
  rollAt: number
  /** Tiles the last roll painted for the first time. */
  newly: number[]
  /** Rolls made on this level. */
  moves: number
  /** Input waits until this game time (the roll animates). */
  busyUntil: number
  /** A swipe made while the ball is still rolling; played when it stops. */
  queued: number
  /** Game time the ball comes to rest (squash and thud), or -1. */
  stopAt: number
  /** Game time this level appeared (tiles pop in). */
  levelAt: number
  /** Game time the board was cleared (final level only), or -10. */
  clearAt: number
  /** Where the ball finished the previous level (its celebration wave starts there). */
  clearPos: number
  botT: number
}

export interface State extends RaceBase {
  panels: [Panel, Panel]
}

function fresh(level: Level, lv: number, t: number): Panel {
  return {
    lv,
    pos: level.start,
    painted: startPaint(level),
    from: level.start,
    dir: -1,
    len: 0,
    rollAt: -10,
    newly: [],
    moves: 0,
    busyUntil: t,
    queued: -1,
    stopAt: -1,
    levelAt: t,
    clearAt: -10,
    clearPos: -1,
    botT: 0,
  }
}

/** Back to the level's start tile, keeping the level's pop-in. */
function rewind(p: Panel, level: Level, t: number): void {
  p.pos = level.start
  p.painted = startPaint(level)
  p.from = level.start
  p.dir = -1
  p.len = 0
  p.rollAt = -10
  p.newly = []
  p.busyUntil = t
  p.queued = -1
  p.stopAt = -1
}

interface Anchor {
  x: number
  y: number
  /** Direction this finger last fired, so a long drag does not fire it twice. */
  fired: number
}

/** The swipe direction of a drag (dx, dy) in the player's frame. */
const dirOf = (dx: number, dy: number): number =>
  Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0

class MazePaint extends PuzzleRace<State> {
  protected recordId = 'maze-paint'
  // Derived from the seed on both phones: never sent over the wire.
  private levels: Level[] = []
  private pilots: [Pilot | null, Pilot | null] = [null, null]
  /** Swipe anchors per pointer id, in panel-local units (host only: it is input, not state). */
  private anchors: [Map<number, Anchor>, Map<number, Anchor>] = [new Map(), new Map()]
  /** Newly painted tiles already given their splash, per side (cosmetic). */
  private splashed: [number, number] = [0, 0]

  protected setup(): State {
    const rng = new Rng(this.ctx.seed)
    this.levels = LEVEL_SIZES.map((n) => generateLevel(rng, n))
    const first = this.levels[0] as Level
    return { race: newRace(), panels: [fresh(first, 0, 0), fresh(first, 0, 0)] }
  }

  protected progressOf(side: Side): number {
    const p = this.s.panels[side]
    const lv = this.levels[p.lv] as Level
    return (p.lv + countPainted(p.painted) / lv.floors) / this.levels.length
  }

  private level(side: Side): Level {
    return this.levels[this.s.panels[side].lv] as Level
  }

  private pilot(side: Side): Pilot {
    const cur = this.pilots[side]
    if (cur) return cur
    const made = new Pilot(this.level(side), this.ctx.difficulty, this.ctx.rng)
    this.pilots[side] = made
    return made
  }

  /** True while a side still shows the level it just cleared (before the next pops in). */
  private showingPrev(side: Side): boolean {
    const p = this.s.panels[side]
    return p.lv > 0 && this.time < p.levelAt
  }

  /** The level the last roll was made on (the previous one right after a clear). */
  private rollLevel(side: Side): Level {
    const p = this.s.panels[side]
    const prev = p.lv > 0 && p.rollAt < p.levelAt
    return this.levels[prev ? p.lv - 1 : p.lv] as Level
  }

  /** World position of a tile on a side's board (of `lv`, by default the current level). */
  private tileWorld(side: Side, tile: number, lv = this.level(side)): { x: number; y: number } {
    const f = this.frames[side]
    const l = layout(f.w, f.h, lv.n)
    const lx = l.x0 + ((tile % lv.n) + 0.5) * l.c
    const ly = l.y0 + (Math.floor(tile / lv.n) + 0.5) * l.c
    return toWorld(f, lx, ly)
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const p = this.s.panels[side]
    this.splash(side)
    if (p.stopAt >= 0 && this.time >= p.stopAt) this.settle(side)
    if (this.isBot(side)) {
      p.botT += dt
      if (p.botT >= PACE[this.ctx.difficulty] && this.time >= p.busyUntil) {
        p.botT = 0
        const m = this.pilot(side).decide(p.pos, p.painted)
        if (m === 'reset') this.restart(side)
        else this.roll(side, m)
      }
      return
    }
    this.readSwipes(side)
    const f = this.frames[side]
    const rr = resetRect(f.w, f.h)
    if (taps.some((t) => t.x >= rr.x && t.x <= rr.x + rr.w && t.y >= rr.y && t.y <= rr.y + rr.h)) {
      this.restart(side)
    }
    if (p.queued >= 0 && this.time >= p.busyUntil) {
      const d = p.queued
      p.queued = -1
      this.roll(side, d)
    }
  }

  /**
   * Swipes fire as soon as the finger has travelled far enough (no need to
   * lift), read in the player's own frame. One drag can bend into a second
   * direction; it never fires the same direction twice in a row.
   */
  private readSwipes(side: Side): void {
    const f = this.frames[side]
    const inp = this.ctx.input.player(side)
    const anchors = this.anchors[side]
    const check = (id: number, x: number, y: number, x0: number, y0: number): void => {
      let a = anchors.get(id)
      if (!a) {
        const l = toLocal(f, x0, y0)
        a = { x: l.x, y: l.y, fired: -1 }
        anchors.set(id, a)
      }
      const b = toLocal(f, x, y)
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (Math.hypot(dx, dy) < SWIPE) return
      const d = dirOf(dx, dy)
      a.x = b.x
      a.y = b.y
      if (d === a.fired) return
      a.fired = d
      this.swipe(side, d)
    }
    for (const p of inp.held.values()) check(p.id, p.x, p.y, p.x0, p.y0)
    for (const up of inp.ups) {
      check(up.id, up.x, up.y, up.x0, up.y0)
      anchors.delete(up.id)
    }
  }

  private swipe(side: Side, d: number): void {
    const p = this.s.panels[side]
    if (this.time >= p.busyUntil) this.roll(side, d)
    else p.queued = d
  }

  /** Roll the ball in `d` until it hits a wall, painting every tile it passes. */
  private roll(side: Side, d: number): void {
    const p = this.s.panels[side]
    const lv = this.level(side)
    const r = roll(lv, p.pos, d)
    if (r.path.length === 0) {
      p.busyUntil = this.time + 0.12
      this.ctx.audio.play('click')
      return
    }
    const duration = rollSeconds(r.path.length)
    p.from = p.pos
    p.dir = d
    p.len = r.path.length
    p.rollAt = this.time
    p.busyUntil = this.time + duration
    p.stopAt = this.time + duration
    p.pos = r.end
    p.moves++
    p.newly = r.path.filter((t) => !p.painted[t])
    for (const t of p.newly) p.painted[t] = 1
    this.splashed[side] = 0
    this.ctx.audio.play('roll', 1.15 - Math.min(0.35, r.path.length * 0.05))
    if (countPainted(p.painted) === lv.floors) this.clearLevel(side)
  }

  /** The ball came to rest: a thud, a puff and a little shake. */
  private settle(side: Side): void {
    const p = this.s.panels[side]
    p.stopAt = -1
    const lv = this.rollLevel(side)
    const tile = lv === this.level(side) ? p.pos : p.clearPos
    // Dust kicks up where the ball meets the wall, flying back along the roll.
    const f = this.frames[side]
    const l = layout(f.w, f.h, lv.n)
    const dx = DX[p.dir] ?? 0
    const dy = DY[p.dir] ?? 0
    const lx = l.x0 + ((tile % lv.n) + 0.5 + dx * 0.42) * l.c
    const ly = l.y0 + (Math.floor(tile / lv.n) + 0.5 + dy * 0.42) * l.c
    const at = toWorld(f, lx, ly)
    const back = toWorld(f, lx - dx * 10, ly - dy * 10)
    this.ctx.audio.play('wall', 1.1 - Math.min(0.3, p.len * 0.05))
    this.ctx.fx.burst(at.x, at.y, C.cream, {
      count: 6,
      speed: 260,
      size: 7,
      life: 0.3,
      spread: 1.8,
      dir: Math.atan2(back.y - at.y, back.x - at.x),
    })
    if (p.len >= 3) this.ctx.fx.shake(0.06 + Math.min(0.06, p.len * 0.01))
  }

  /** Splash each newly painted tile as the ball passes over it. */
  private splash(side: Side): void {
    const p = this.s.panels[side]
    const lv = this.rollLevel(side)
    const n = lv.n
    const fr = Math.floor(p.from / n)
    const fc = p.from % n
    while (this.splashed[side] < p.newly.length) {
      const t = p.newly[this.splashed[side]] as number
      const k = Math.abs(Math.floor(t / n) - fr) + Math.abs((t % n) - fc) - 1
      if (this.time < paintTime(p.rollAt, p.len, k)) break
      this.splashed[side]++
      const at = this.tileWorld(side, t, lv)
      this.ctx.fx.burst(at.x, at.y, SIDE[side].light, { count: 5, speed: 200, size: 9, life: 0.35 })
      this.ctx.audio.play('tick', 1 + Math.min(0.6, this.splashed[side] * 0.08))
    }
  }

  /**
   * Every floor is painted. The ball still has to arrive: the board flashes in
   * a wave from where it stops, then the next level pops in (or the race ends).
   */
  private clearLevel(side: Side): void {
    const p = this.s.panels[side]
    const lv = p.lv
    const arrive = this.time + rollSeconds(p.len)
    const at = this.tileWorld(side, p.pos)
    const f = this.frames[side]
    const l = layout(f.w, f.h, this.level(side).n)
    const mid = toWorld(f, f.w / 2, l.y0 + l.size / 2)
    this.ctx.audio.play('score', 1 + lv * 0.1)
    this.ctx.fx.ring(at.x, at.y, SIDE[side].light, 300)
    this.ctx.fx.burst(at.x, at.y, C.yellow, { count: 24, speed: 460, size: 12, life: 0.7 })
    this.ctx.fx.shake(0.22)
    if (lv + 1 >= this.levels.length) {
      p.clearAt = arrive
      this.ctx.fx.stop(6)
      this.ctx.fx.flash(SIDE[side].light, 0.25)
      this.ctx.fx.burst(mid.x, mid.y, SIDE[side].main, { count: 40, speed: 700, size: 16, life: 1 })
      this.ctx.fx.confetti(this.solo ? undefined : side)
      this.complete(side)
      return
    }
    this.ctx.fx.float(`Level ${lv + 1} clear!`, mid.x, mid.y, C.yellow, 60, side)
    const next = fresh(this.levels[lv + 1] as Level, lv + 1, arrive + CLEAR_SECONDS)
    next.clearPos = p.pos
    // Keep the finished roll on screen until the next level appears.
    next.from = p.from
    next.dir = p.dir
    next.len = p.len
    next.rollAt = p.rollAt
    next.newly = p.newly
    next.stopAt = p.stopAt
    next.busyUntil = next.levelAt + 0.25
    this.s.panels[side] = next
    this.pilots[side] = null
  }

  /** Back to the level's start, at a time penalty. */
  private restart(side: Side): void {
    const p = this.s.panels[side]
    const lv = this.level(side)
    if (p.pos === lv.start && countPainted(p.painted) === 1) return
    this.penalize(side, RESTART_COST)
    const at = this.tileWorld(side, lv.start)
    this.ctx.fx.puff(at.x, at.y, 'rgba(255,255,255,0.6)', 8)
    this.ctx.audio.play('swish')
    rewind(p, lv, this.time + 0.35)
    this.pilots[side]?.reset()
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const p = this.s.panels[side]
    const human = !this.isBot(side)
    if (this.showingPrev(side)) {
      // The cleared board, fully painted, with the last roll finishing and a wave.
      const prev = this.levels[p.lv - 1] as Level
      drawPanel(g, w, h, {
        side,
        walls: prev.walls,
        start: prev.start,
        painted: prev.walls.map((v) => 1 - v),
        pos: p.clearPos,
        from: p.from,
        dir: p.dir,
        len: p.len,
        rollAt: p.rollAt,
        newly: p.newly,
        levelNo: p.lv,
        levels: this.levels.length,
        levelAt: -10,
        clearAt: p.rollAt + rollSeconds(p.len),
        now: this.time,
        hint: false,
        arrows: 0,
        stuck: false,
        restartCost: RESTART_COST,
      })
      return
    }
    const lv = this.level(side)
    // A roll made on the previous level does not belong on this board.
    const own = p.rollAt >= p.levelAt || p.lv === 0
    const len = own ? p.len : 0
    const restAt = own && len > 0 ? p.rollAt + rollSeconds(len) : p.levelAt + 0.4
    const idle = this.time - restAt
    const fresh = p.lv === 0 && p.moves === 0
    const view: PanelView = {
      side,
      walls: lv.walls,
      start: lv.start,
      painted: p.painted,
      pos: p.pos,
      from: own ? p.from : p.pos,
      dir: own ? p.dir : -1,
      len,
      rollAt: own ? p.rollAt : -10,
      newly: own ? p.newly : [],
      levelNo: p.lv + 1,
      levels: this.levels.length,
      levelAt: p.levelAt,
      clearAt: p.clearAt,
      now: this.time,
      hint: human && fresh && this.time < 8,
      arrows:
        human && p.clearAt < 0 && idle > 0
          ? Math.min(1, (idle - (fresh ? 0.6 : NUDGE)) * 3) * 0.9
          : 0,
      stuck: human && p.clearAt < 0 && idle > 0.3 && stuck(lv, p.pos, p.painted),
      restartCost: RESTART_COST,
    }
    drawPanel(g, w, h, view)
  }
}

export default () => new MazePaint()
