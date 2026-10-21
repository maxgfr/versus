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
import { banner } from '../../core/hud.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import { HP, SHELL_R, TANK_R, type Tank } from './rules.ts'

const TREAD = '#1c1a26'

function tank(g: Draw, t: Tank, now: number): void {
  const col = SIDE[t.side]
  g.shadow(t.x + 6, t.y + 14, TANK_R * 1.25, TANK_R * 0.75, 0.35)
  if (!t.alive) {
    // Scorched wreck.
    g.at(t.x, t.y, t.a, () => {
      g.rrect(-40, -36, 80, 72, 16, '#2b2733')
      g.rrect(-30, -24, 60, 48, 12, '#3a3542')
      g.circle(0, 0, 18, '#24202b')
      g.line(0, 0, 40, 6, '#24202b', 12)
    })
    return
  }
  const recoil = Math.max(0, 1 - (now - t.fireT) / 0.18)
  const hurt = now - t.hitT < 0.18
  g.at(t.x, t.y, t.a, () => {
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
  })
  // Life pips under the tank, upright for its player.
  g.forSide(t.side, t.x, t.y, () => {
    for (let i = 0; i < HP; i++) {
      const x = (i - (HP - 1) / 2) * 20
      g.circle(x, 56, 7.5, i < t.hp ? col.light : alpha('#000000', 0.45))
    }
  })
}

function shells(g: Draw, s: State): void {
  for (const sh of s.w.shells) {
    const col = SIDE[sh.side]
    const m = Math.hypot(sh.vx, sh.vy) || 1
    g.line(
      sh.x,
      sh.y,
      sh.x - (sh.vx / m) * 40,
      sh.y - (sh.vy / m) * 40,
      alpha(col.light, 0.45),
      SHELL_R * 1.4,
    )
    g.circle(sh.x, sh.y, SHELL_R + 3, shade(col.main, -0.5))
    g.ball(sh.x, sh.y, SHELL_R, col.light, 0.8)
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
  for (const t of s.w.tanks) if (!t.alive) tank(g, t, s.w.t)
  drawWalls(g, grid)
  for (const t of s.w.tanks) if (t.alive) tank(g, t, s.w.t)
  shells(g, s)
  for (const c of s.ctl) drawControl(g, c)
  status(g, s, 0, names[0], grid)
  status(g, s, 1, names[1], grid)
  const r = s.rounds
  if (over) return
  if (r.phase === 'between' && r.text)
    banner(g, undefined, r.text, MID, { size: 56, alpha: Math.min(1, (now - r.at) * 4) })
  else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1)
    banner(g, undefined, `Round ${r.round}`, MID, { size: 64 })
}
