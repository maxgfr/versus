import type { Side } from '../../core/game.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, bigScore, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { drawStrip, type Grid, solidCell } from '../../engines/arena/index.ts'
import { MID } from '../../core/stage.ts'
import { COOLDOWN, isCorner, type Fare, type Taxi } from './rules.ts'
import type { Hop, PadLook, State } from './index.ts'

const ROAD = '#2a3150'
const KERB = '#3d4468'
const PLOT = '#161b2e'
const LANE = alpha(C.white, 0.22)
const ROOFS = ['#4d3d7a', '#3a5b7e', '#5b3c5f', '#2f5d64', '#4a4a7a', '#6a4a3a']
const WINDOW_ON = '#ffd98a'
/** Each passenger gets a colour, shared by their ring and their destination flag. */
const FARE_COLS = [C.green, C.pink, C.cyan, C.orange, C.purple, C.teal]

const fareCol = (id: number): string => FARE_COLS[id % FARE_COLS.length] as string

/** Deterministic 0..1 noise per cell, for windows and rooftop clutter. */
function noise(a: number, b: number, c = 0): number {
  const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return h - Math.floor(h)
}

// ---------- the city ----------

function streets(g: Draw, grid: Grid): void {
  const cell = grid.cell
  g.rect(grid.x0, grid.y0, grid.cols * cell, grid.rows * cell, PLOT)
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      if (solidCell(grid, c, r)) continue
      const x = grid.x0 + c * cell
      const y = grid.y0 + r * cell
      g.rect(x, y, cell, cell, ROAD)
      // Sidewalk kerbs along the buildings.
      if (solidCell(grid, c - 1, r) && c > 0) g.rect(x, y, 10, cell, KERB)
      if (solidCell(grid, c + 1, r) && c < grid.cols - 1) g.rect(x + cell - 10, y, 10, cell, KERB)
      if (solidCell(grid, c, r - 1) && r > 0) g.rect(x, y, cell, 10, KERB)
      if (solidCell(grid, c, r + 1) && r < grid.rows - 1) g.rect(x, y + cell - 10, cell, 10, KERB)
      const cx = x + cell / 2
      const cy = y + cell / 2
      if (!solidCell(grid, c + 1, r) && !isCorner(grid, c, r) && !isCorner(grid, c + 1, r))
        g.dashed(cx, cy, cx + cell, cy, LANE, 5, [16, 14])
      if (!solidCell(grid, c, r + 1) && !isCorner(grid, c, r) && !isCorner(grid, c, r + 1))
        g.dashed(cx, cy, cx, cy + cell, LANE, 5, [16, 14])
    }
}

/** Warm street-lamp pools on some corners: the floodlit night city. */
function lamps(g: Draw, grid: Grid): void {
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  for (let r = 0; r < grid.rows; r++)
    for (let col = 0; col < grid.cols; col++) {
      if (solidCell(grid, col, r) || !isCorner(grid, col, r) || (col + r) % 3 !== 0) continue
      const x = grid.x0 + (col + 0.5) * grid.cell
      const y = grid.y0 + (r + 0.5) * grid.cell
      g.circle(
        x,
        y,
        150,
        g.rad(x, y, 0, 150, [
          [0, 'rgba(255,214,140,0.13)'],
          [1, 'rgba(255,214,140,0)'],
        ]),
      )
    }
  c.restore()
}

function buildings(g: Draw, grid: Grid, t: number): void {
  const cell = grid.cell
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      if (!solidCell(grid, c, r)) continue
      const x = grid.x0 + c * cell
      g.rect(x + 10, grid.y0 + r * cell + 16, cell - 8, cell - 8, alpha('#000000', 0.3))
    }
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      if (!solidCell(grid, c, r)) continue
      const x = grid.x0 + c * cell
      const y = grid.y0 + r * cell
      const roof = ROOFS[(c * 7 + r * 3) % ROOFS.length] as string
      g.tile(x + 6, y + 4, cell - 12, cell - 6, 16, roof, 16)
      // Windows: a few lit warm, the rest dark; one flickers now and then.
      for (let i = 0; i < 4; i++) {
        const wx = x + cell * (i % 2 === 0 ? 0.32 : 0.64)
        const wy = y + cell * (i < 2 ? 0.3 : 0.56)
        const on = noise(c, r, i) > 0.45
        const flick = noise(c, r, i + 9) > 0.92 && Math.sin(t * 2.2 + c * 3 + r) > 0.6
        g.rrect(
          wx - 8,
          wy - 8,
          16,
          16,
          4,
          on && !flick ? alpha(WINDOW_ON, 0.85) : alpha('#000000', 0.25),
        )
      }
      // Rooftop clutter: an AC box or a water tank.
      if (noise(c, r, 5) > 0.55) {
        const bx = x + cell * (noise(c, r, 6) > 0.5 ? 0.72 : 0.22)
        g.circle(bx, y + cell * 0.74, 10, shade(roof, -0.35))
        g.circle(bx, y + cell * 0.72, 10, shade(roof, 0.25))
      }
    }
}

// ---------- passengers ----------

/** A destination flag on its pole: small and dim while its passenger waits, big when someone carries them. */
function flag(g: Draw, f: Fare, now: number): void {
  const col = fareCol(f.id)
  const carried = f.carried >= 0
  const k = carried ? 1 : 0.62
  g.alpha(carried ? 1 : 0.7, () => {
    if (carried) {
      const p = 0.5 + 0.5 * Math.sin(now * 6)
      const team = SIDE[f.carried as Side]
      g.circle(f.tx, f.ty, 44 + p * 6, alpha(team.main, 0.22))
      g.ring(f.tx, f.ty, 44 + p * 6, team.light, 7)
    }
    g.shadow(f.tx + 4, f.ty + 26 * k, 20 * k, 8 * k, 0.4)
    g.at(
      f.tx,
      f.ty,
      0,
      () => {
        g.line(-14, 26, -14, -46, '#e9e4f5', 6)
        const wave = Math.sin(now * 7 + f.id) * 5
        g.path((p) => {
          p.moveTo(-12, -46)
          p.quadraticCurveTo(10, -50 + wave, 32, -36)
          p.quadraticCurveTo(10, -24 - wave, -12, -18)
          p.closePath()
        }, col)
        g.circle(-14, -48, 5, C.white)
      },
      k,
    )
  })
}

/** A waiting passenger on their corner: a ring in their colour, bobbing and waving. */
function waiting(g: Draw, f: Fare, x: number, y: number, now: number, scale = 1): void {
  const col = fareCol(f.id)
  const bob = Math.abs(Math.sin(now * 4 + f.id)) * 8
  g.circle(x, y, 38, alpha(col, 0.18))
  g.ring(x, y, 36 + Math.sin(now * 3 + f.id) * 3, col, 5)
  g.shadow(x, y + 22, 18, 7, 0.4)
  g.emoji('🙋', x, y - 12 - bob, 62 * scale)
}

/** Passenger tweens: hopping into a cab, cheering off at the flag, tumbling out after a bump. */
function hop(g: Draw, h: Hop, s: State, now: number): void {
  const t = now - h.at
  if (t < 0) return
  if (h.kind === 'in') {
    if (t > 0.3) return
    const taxi = s.taxis[h.side]
    const k = outCubic(t / 0.3)
    const x = h.x + (taxi.x - h.x) * k
    const y = h.y + (taxi.y - h.y) * k - Math.sin(k * Math.PI) * 70
    g.emoji('🙋', x, y, 62 * (1 - 0.6 * k))
  } else if (h.kind === 'out') {
    if (t > 0.9) return
    const k = t / 0.9
    g.alpha(1 - Math.max(0, (k - 0.6) / 0.4), () =>
      g.emoji('🙌', h.x + 40 * k, h.y - 30 - Math.abs(Math.sin(t * 12)) * 30, 64),
    )
  }
}

/** Where a waiting passenger is drawn: sliding from the cab to the kerb right after a drop. */
function waitingAt(f: Fare, s: State, now: number): { x: number; y: number; scale: number } {
  const h = s.hops.find((d) => d.kind === 'drop' && d.id === f.id)
  if (!h) return { x: f.fx, y: f.fy, scale: 1 }
  const k = outBack(clamp((now - h.at) / 0.45, 0, 1))
  return {
    x: h.x + (f.fx - h.x) * k,
    y: h.y + (f.fy - h.y) * k - Math.sin(clamp(k, 0, 1) * Math.PI) * 60,
    scale: 0.7 + 0.3 * k,
  }
}

// ---------- taxis ----------

/** A cab from above in its team colour, nose toward local -y. */
function taxi(g: Draw, t: Taxi, fare: Fare | undefined, s: State, now: number): void {
  const col = SIDE[t.side]
  const moving = Math.abs(t.vx) + Math.abs(t.vy) > 1
  const dazed = s.t < t.calmT
  g.shadow(t.x + 7, t.y + 14, 40, 54, 0.4)
  // Headlight beams ahead when driving.
  if (moving) {
    g.at(t.x, t.y, t.a + Math.PI / 2, () => {
      const c = g.ctx
      c.save()
      c.globalCompositeOperation = 'lighter'
      g.poly(
        [-24, -46, 24, -46, 64, -190, -64, -190],
        g.lin(0, -46, 0, -190, [
          [0, 'rgba(255,240,190,0.24)'],
          [1, 'rgba(255,240,190,0)'],
        ]),
      )
      c.restore()
    })
  }
  // Arrow to the destination while carrying, in the passenger's colour.
  if (fare) {
    const a = Math.atan2(fare.ty - t.y, fare.tx - t.x)
    const p = 0.5 + 0.5 * Math.sin(now * 8)
    g.at(t.x, t.y, a, () =>
      g.poly([78 + p * 8, 0, 56 + p * 8, -16, 56 + p * 8, 16], fareCol(fare.id), C.ink, 4),
    )
  }
  g.at(t.x, t.y, t.a + Math.PI / 2, () => {
    for (const sx of [-1, 1])
      for (const wy of [-26, 28]) g.rrect(sx * 30 - 8, wy - 12, 16, 24, 5, '#0b0912')
    g.rrect(-31, -48, 62, 96, 20, shade(col.main, -0.45))
    g.rrect(
      -29,
      -46,
      58,
      91,
      18,
      g.lin(-29, 0, 29, 0, [
        [0, shade(col.main, -0.1)],
        [0.3, shade(col.main, 0.18)],
        [0.7, col.main],
        [1, shade(col.main, -0.2)],
      ]),
    )
    // Checker band along both flanks: a cab at a glance.
    for (const sx of [-1, 1])
      for (let i = 0; i < 5; i++)
        g.rect(sx > 0 ? 21 : -29, -20 + i * 9, 8, 9, i % 2 ? C.ink : C.white)
    g.poly([-22, -32, 22, -32, 19, -16, -19, -16], '#0e1424')
    g.line(-12, -29, -4, -19, alpha('#ffffff', 0.35), 3)
    g.poly([-19, 28, 19, 28, 22, 38, -22, 38], alpha('#0b1020', 0.75))
    g.rrect(-24, -49, 13, 7, 3, '#fff6c8')
    g.rrect(11, -49, 13, 7, 3, '#fff6c8')
    g.rrect(-24, 42, 12, 6, 3, '#ff4b5c')
    g.rrect(12, 42, 12, 6, 3, '#ff4b5c')
    // Roof sign: lit yellow while the cab is free, dark with a fare aboard.
    const free = !fare
    if (free) g.circle(0, -4, 26, alpha(C.yellow, 0.22 + 0.1 * Math.sin(now * 5)))
    g.rrect(-17, -14, 34, 20, 6, free ? C.yellow : shade(C.yellow, -0.6))
    g.sideMark(t.side, 0, -4, 6, free ? col.dark : alpha(C.white, 0.4))
    // The passenger riding in the back.
    if (fare) {
      g.circle(0, 20, 13, fareCol(fare.id))
      g.circle(0, 16, 9, '#ffd2a8')
    }
  })
  if (dazed) {
    const k = clamp((t.calmT - s.t) / COOLDOWN, 0, 1)
    g.alpha(k, () => {
      for (let i = 0; i < 3; i++) {
        const a = now * 5 + (i * Math.PI * 2) / 3
        g.emoji('💫', t.x + Math.cos(a) * 38, t.y - 50 + Math.sin(a) * 12, 30)
      }
    })
  }
}

// ---------- strips and HUD ----------

function pad(g: Draw, side: Side, p: PadLook): void {
  const col = SIDE[side]
  g.alpha(p.on ? 0.95 : 0.5, () => {
    g.circle(p.bx, p.by, 110, alpha(col.dark, 0.4), alpha(col.light, 0.5), 5)
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2
      g.at(p.bx + Math.cos(a) * 84, p.by + Math.sin(a) * 84, a, () =>
        g.poly([10, 0, -6, -10, -6, 10], alpha(col.light, 0.5)),
      )
    }
    g.shadow(p.kx + 4, p.ky + 10, 46, 18, 0.35)
    g.ball(p.kx, p.ky, 50, col.main, 0.7)
  })
}

/** Each player's own clock in their strip, upright for them. */
function sideClock(g: Draw, side: Side, left: number, now: number): void {
  const sec = Math.max(0, Math.ceil(left))
  const label = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const urgent = sec <= 5
  const x = side === 0 ? 800 : 200
  const y = side === 0 ? hudY(g, 0, 52) - 140 : hudY(g, 1, 52) + 140
  const pop = urgent ? 1 + 0.08 * Math.max(0, Math.sin(now * Math.PI * 2)) : 1
  g.forSide(side, x, y, () => {
    g.rrect(-92 * pop, -38 * pop, 184 * pop, 76 * pop, 24, alpha(C.ink, 0.75))
    g.text(`⏱ ${label}`, 0, 3, { size: 40 * pop, weight: 700, color: urgent ? C.yellow : C.white })
  })
}

function score(g: Draw, s: State, side: Side, now: number): void {
  const t = s.taxis[side]
  const dt = now - s.scoredAt[side]
  const k = dt < 0.5 ? 1 + 0.5 * (1 - outBack(clamp(dt / 0.5, 0, 1))) : 1
  bigScore(g, side, t.fares, { inset: 52, x: 130, size: 76 * k })
  const y = hudY(g, side, 52) + (side === 0 ? -80 : 80)
  g.sideText(side, `${t.points} pts`, 130, y, {
    size: 34,
    weight: 600,
    color: alpha(C.white, 0.6),
  })
}

function ending(g: Draw, s: State, names: [string, string], now: number): void {
  if (s.endAt < 0) return
  const t = now - s.endAt
  const w = s.winner
  const text = w === 'draw' || w === null ? 'Draw!' : `${names[w]} wins!`
  banner(g, undefined, t < 0.8 ? 'Time!' : text, MID, {
    size: 64 + 12 * (1 - outBack(clamp(t / 0.3, 0, 1))),
    alpha: clamp(t * 4, 0, 1),
    color: t < 0.8 || w === 'draw' || w === null ? C.yellow : SIDE[w].light,
  })
}

export function renderCity(
  g: Draw,
  s: State,
  grid: Grid,
  names: [string, string],
  left: number,
  now: number,
): void {
  g.fillView(PLOT)
  drawStrip(g, grid.y0, grid.y0 + grid.rows * grid.cell)
  const v = g.stage.view
  const bottom = grid.y0 + grid.rows * grid.cell
  // Team rims where the strips meet the city.
  g.rect(v.x - 2, grid.y0 - 8, v.w + 4, 8, SIDE[1].main)
  g.rect(v.x - 2, bottom, v.w + 4, 8, SIDE[0].main)
  streets(g, grid)
  lamps(g, grid)
  for (const f of s.fares) flag(g, f, now)
  buildings(g, grid, now)
  for (const f of s.fares) {
    if (f.carried >= 0) continue
    const p = waitingAt(f, s, now)
    waiting(g, f, p.x, p.y, now, p.scale)
  }
  for (const side of [0, 1] as Side[]) {
    const t = s.taxis[side]
    taxi(
      g,
      t,
      s.fares.find((f) => f.id === t.carry),
      s,
      now,
    )
  }
  for (const h of s.hops) hop(g, h, s, now)
  for (const side of [0, 1] as Side[]) pad(g, side, s.pads[side])
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, names[side], { inset: 52 })
    score(g, s, side, now)
    if (s.endAt < 0) sideClock(g, side, left, now)
  }
  ending(g, s, names, now)
}
