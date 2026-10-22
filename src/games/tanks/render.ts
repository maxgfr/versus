import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import {
  drawControl,
  drawFloor,
  drawStrip,
  drawWalls,
  type Grid,
} from '../../engines/arena/index.ts'
import { lerp, outBack } from '../../core/fx/ease.ts'
import { banner } from '../../core/hud.ts'
import { MID, W } from '../../core/stage.ts'
import { angleTo } from '../../engines/arena/index.ts'
import type { State } from './index.ts'
import { HP, SHELL_R, SPEED, TANK_R, type Tank } from './rules.ts'

const TREAD = '#1c1a26'

/** Cosmetic extras from the game: interpolation and springs (never in the state). */
export interface Look {
  alpha: number
  /** Previous step's poses by id (tanks by id, shells by 1000 + id). */
  prev: Map<number, { x: number; y: number; a: number }>
  /** Squash per tank id (1 = rest). */
  squash: number[]
}

function tank(g: Draw, t: Tank, now: number, look: Look): void {
  const col = SIDE[t.side]
  const p = look.prev.get(t.id)
  const x = p ? lerp(p.x, t.x, look.alpha) : t.x
  const y = p ? lerp(p.y, t.y, look.alpha) : t.y
  const a = p ? p.a + angleTo(p.a, t.a) * look.alpha : t.a
  g.shadow(x + 6, y + 14, TANK_R * 1.25, TANK_R * 0.75, 0.35)
  if (!t.alive) {
    // Scorched wreck.
    g.at(x, y, a, () => {
      g.rrect(-40, -36, 80, 72, 16, '#2b2733')
      g.rrect(-30, -24, 60, 48, 12, '#3a3542')
      g.circle(0, 0, 18, '#24202b')
      g.line(0, 0, 40, 6, '#24202b', 12)
    })
    return
  }
  const recoil = Math.max(0, 1 - (now - t.fireT) / 0.18)
  const hurt = now - t.hitT < 0.18
  // Squash along the hull (recoil, hits), a lean into speed, and an idle hum.
  const sq = look.squash[t.id] ?? 1
  const sp = Math.hypot(t.vx, t.vy) / SPEED
  const hum = 1 + Math.sin(now * 9 + t.id * 2) * (0.012 + sp * 0.01)
  const sx = sq * (1 + sp * 0.04)
  const sy = (1 / Math.sqrt(Math.max(0.4, sq))) * hum
  // Recoil shove and hit wobble in the hull's own frame.
  const wob = Math.sin((now - t.hitT) * 40) * Math.max(0, 1 - (now - t.hitT) / 0.3) * 0.12
  g.at(
    x,
    y,
    a + wob,
    () => {
      // Tracks with moving treads.
      for (const sy of [-1, 1]) {
        g.rrect(-42, sy * 30 - 13, 84, 26, 11, TREAD)
        const off = t.tread % 14
        for (let x = -38 + off; x < 38; x += 14)
          g.line(x, sy * 30 - 10, x, sy * 30 + 10, '#3a3648', 4)
      }
      // Hull with a lip and a glossy top.
      g.rrect(-36, -24, 72, 54, 15, shade(col.main, -0.4))
      g.rrect(
        -36,
        -28,
        72,
        52,
        15,
        g.lin(0, -28, 0, 24, [
          [0, shade(col.main, 0.18)],
          [1, shade(col.main, -0.12)],
        ]),
      )
      g.rrect(-28, -24, 56, 14, 7, alpha('#ffffff', 0.22))
      // Barrel (recoils), then turret with eyes looking down the barrel.
      const bl = 52 - recoil * 12
      g.rrect(4, -8, bl, 16, 6, shade(col.main, -0.5))
      g.rrect(bl - 2, -11, 12, 22, 5, shade(col.main, -0.55))
      g.circle(0, -2, 22, shade(col.main, -0.35))
      g.circle(0, -4, 22, shade(col.main, 0.12))
      for (const ey of [-8, 8]) {
        g.circle(8, ey - 4, 6.5, '#fff')
        g.circle(10.5, ey - 4, 3.5, C.ink)
      }
      if (hurt) g.alpha(0.75, () => g.rrect(-44, -38, 88, 76, 18, '#fff'))
    },
    sx,
    sy,
  )
  // Life pips under the tank, upright for its player; the one just lost pops out.
  const lost = (now - t.hitT) / 0.35
  g.forSide(t.side, x, y, () => {
    for (let i = 0; i < HP; i++) {
      const px = (i - (HP - 1) / 2) * 20
      g.circle(px, 56, 7.5, i < t.hp ? col.light : alpha('#000000', 0.45))
      if (i === t.hp && lost < 1)
        g.alpha(1 - lost, () => g.circle(px, 56, 7.5 + lost * 14, C.white))
    }
  })
}

function shells(g: Draw, s: State, look: Look): void {
  for (const sh of s.w.shells) {
    const col = SIDE[sh.side]
    const p = look.prev.get(1000 + sh.id)
    // Blend only within a straight flight (a bounce flips the velocity).
    const ok = p && Math.abs(p.x - sh.x) + Math.abs(p.y - sh.y) < 40
    const x = ok ? lerp(p.x, sh.x, look.alpha) : sh.x
    const y = ok ? lerp(p.y, sh.y, look.alpha) : sh.y
    const m = Math.hypot(sh.vx, sh.vy) || 1
    // A longer, brighter tail for a faster shell.
    const tail = 30 + (m / 640) * 22
    g.line(
      x,
      y,
      x - (sh.vx / m) * tail,
      y - (sh.vy / m) * tail,
      alpha(col.light, 0.4),
      SHELL_R * 1.5,
    )
    g.line(
      x,
      y,
      x - (sh.vx / m) * tail * 0.5,
      y - (sh.vy / m) * tail * 0.5,
      alpha(C.white, 0.35),
      SHELL_R * 0.7,
    )
    g.circle(x, y, SHELL_R + 3, shade(col.main, -0.5))
    g.ball(x, y, SHELL_R, col.light, 0.8)
  }
}

/**
 * Status column just outside the arena, upright for its player: name, lives
 * left, round pips, stacked in the gap between the stick and the fire button
 * so the stick's knob never covers the name.
 */
function status(g: Draw, s: State, side: Side, name: string, grid: Grid): void {
  const y = side === 0 ? grid.y0 + grid.rows * grid.cell + 40 : grid.y0 - 40
  const lives = s.w.tanks.filter((t) => t.side === side).reduce((n, t) => n + Math.max(0, t.hp), 0)
  const col = SIDE[side]
  const r = s.rounds
  // 2 vs 2 puts a fire button and a second stick in that gap: the name goes
  // to the far left instead, above the first stick.
  const teams = s.ctl.filter((c) => c.side === side).length > 1
  g.forSide(side, W / 2, y, () => {
    if (teams)
      g.text(name, -360, 2, {
        size: 34,
        weight: 700,
        color: col.light,
        align: 'left',
        maxWidth: 260,
      })
    else g.text(name, 0, 2, { size: 36, weight: 700, color: col.light, maxWidth: 240 })
    const ly = teams ? 2 : 46
    g.text(`${lives} ${lives === 1 ? 'life' : 'lives'}`, 0, ly, {
      size: 34,
      weight: 600,
      color: alpha(C.white, 0.75),
    })
    for (let i = 0; i < r.target; i++) {
      const x = (i - (r.target - 1) / 2) * 36
      const on = i < r.wins[side]
      g.circle(x, ly + 44, 13, on ? col.main : alpha('#ffffff', 0.16))
      if (on) g.circle(x - 4, ly + 40, 4, alpha(C.white, 0.6))
    }
  })
}

export function renderTanks(
  g: Draw,
  s: State,
  grid: Grid,
  now: number,
  names: [string, string],
  over: boolean,
  look: Look,
): void {
  // The arena does not span the whole view: paint the side gutters too, or
  // they keep stale pixels from the ready screen.
  g.fillView(
    g.lin(0, grid.y0, 0, grid.y0 + grid.rows * grid.cell, [
      [0, shade(C.blue, -0.82)],
      [1, shade(C.red, -0.82)],
    ]),
  )
  drawStrip(g, grid.y0, grid.y0 + grid.rows * grid.cell)
  drawFloor(g, grid)
  for (const t of s.w.tanks) if (!t.alive) tank(g, t, s.w.t, look)
  drawWalls(g, grid)
  for (const t of s.w.tanks) if (t.alive) tank(g, t, s.w.t, look)
  shells(g, s, look)
  for (const c of s.ctl) drawControl(g, c)
  status(g, s, 0, names[0], grid)
  status(g, s, 1, names[1], grid)
  const r = s.rounds
  if (over) return
  if (r.phase === 'between' && r.text)
    banner(g, undefined, r.text, MID, { size: 56, alpha: Math.min(1, (now - r.at) * 4) })
  else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
    // Pops in, then fades as the tanks roll.
    const k = now - r.at
    const size = 64 * outBack(Math.min(1, k / 0.3))
    banner(g, undefined, `Round ${r.round}`, MID, { size, alpha: Math.min(1, (1.1 - k) / 0.3) })
  }
}
