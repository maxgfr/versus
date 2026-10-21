/**
 * Arena engine: top-down action on a tile map — drive, shoot, bump, explode.
 *
 * The map is static per round, so it is NOT stored in the snapshot: keep a map
 * index (or seed) in `this.s` and rebuild the `Grid` with `parseMap` when it
 * changes (also after `restore` on the online guest). Actors and projectiles
 * are plain objects inside `this.s` so they travel in snapshots.
 *
 * Building a new arena game (copy src/games/tanks):
 * 1. Maps: strings, '#' = wall, '.' = floor, letters = spawns. `mirrorMap(top)`
 *    builds a fair, point-symmetric map from its top half (blue's side) and
 *    swaps blue spawn letters for red ones.
 * 2. Physics per step: move actors, then `collideCircle(grid, actor, r)` against
 *    walls and `separate(a, b, ra, rb)` between actors. Projectiles use
 *    `moveBouncing(grid, p, dt)` which reflects off walls and returns the bounce
 *    count for this step.
 * 3. Controls: `sideControls(stage, side, teams)` gives each player a floating
 *    Joystick + fire Button in their strip (outside the arena), upright and
 *    lane-aware for 2 vs 2. Call `update(input)` on each, and `snapControl`
 *    to copy their look into the state so the online guest can draw them with
 *    `drawControl`.
 * 4. Bots: `lineOfSight` for "can I shoot it", `bfsNext` for "where do I go",
 *    `threat` for "is that shell coming at me". Drive the same Joystick /
 *    Button with `set()` / `press()`.
 * 5. Render: `drawFloor`, `drawWalls`, then your actors; `drawStrip` paints the
 *    players' control strips.
 */
import { Button, Joystick } from '../../core/controls.ts'
import type { Side } from '../../core/game.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, W, type Stage } from '../../core/stage.ts'

// ---------- grid ----------

export interface Grid {
  cols: number
  rows: number
  cell: number
  /** World position of the grid's top-left corner. */
  x0: number
  y0: number
  /** 1 = wall, row-major. */
  solid: Uint8Array
  /** Spawn letters → world positions (cell centres). */
  spawns: Record<string, { x: number; y: number }>
}

export const ARENA = { x0: 0, y0: 300, cols: 10, rows: 12, cell: 100 }

/** Parse map rows ('#' wall, '.' floor, letters = spawns). */
export function parseMap(rows: readonly string[], o: Partial<typeof ARENA> = {}): Grid {
  const cfg = { ...ARENA, ...o, rows: rows.length, cols: rows[0]?.length ?? 0 }
  const solid = new Uint8Array(cfg.cols * cfg.rows)
  const spawns: Grid['spawns'] = {}
  rows.forEach((line, r) => {
    for (let c = 0; c < cfg.cols; c++) {
      const ch = line[c] ?? '#'
      if (ch === '#') solid[r * cfg.cols + c] = 1
      else if (ch !== '.')
        spawns[ch] = { x: cfg.x0 + (c + 0.5) * cfg.cell, y: cfg.y0 + (r + 0.5) * cfg.cell }
    }
  })
  return { cols: cfg.cols, rows: cfg.rows, cell: cfg.cell, x0: cfg.x0, y0: cfg.y0, solid, spawns }
}

/**
 * Full map from its top half, rotated 180° for the bottom half so both sides
 * get the same arena. Spawn letters in the top half are blue's; their mirrors
 * become red's via `swap` (default B→R, b→r).
 */
export function mirrorMap(
  top: readonly string[],
  swap: Record<string, string> = { B: 'R', b: 'r' },
): string[] {
  const bottom = [...top].reverse().map((row) =>
    [...row]
      .reverse()
      .map((ch) => swap[ch] ?? ch)
      .join(''),
  )
  return [...top, ...bottom]
}

export function cellOf(g: Grid, x: number, y: number): { c: number; r: number } {
  return { c: Math.floor((x - g.x0) / g.cell), r: Math.floor((y - g.y0) / g.cell) }
}

export function cellCenter(g: Grid, c: number, r: number): { x: number; y: number } {
  return { x: g.x0 + (c + 0.5) * g.cell, y: g.y0 + (r + 0.5) * g.cell }
}

/** Outside the map counts as wall. */
export function solidCell(g: Grid, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return true
  return g.solid[r * g.cols + c] === 1
}

export function solidAt(g: Grid, x: number, y: number): boolean {
  const { c, r } = cellOf(g, x, y)
  return solidCell(g, c, r)
}

// ---------- collision ----------

/** Push a circle out of every wall tile it overlaps. Returns true if it touched a wall. */
export function collideCircle(g: Grid, b: { x: number; y: number }, r: number): boolean {
  let hit = false
  const c0 = Math.floor((b.x - r - g.x0) / g.cell)
  const c1 = Math.floor((b.x + r - g.x0) / g.cell)
  const r0 = Math.floor((b.y - r - g.y0) / g.cell)
  const r1 = Math.floor((b.y + r - g.y0) / g.cell)
  for (let pass = 0; pass < 2; pass++) {
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (!solidCell(g, cc, rr)) continue
        const x0 = g.x0 + cc * g.cell
        const y0 = g.y0 + rr * g.cell
        const nx = Math.max(x0, Math.min(b.x, x0 + g.cell))
        const ny = Math.max(y0, Math.min(b.y, y0 + g.cell))
        let dx = b.x - nx
        let dy = b.y - ny
        const d2 = dx * dx + dy * dy
        if (d2 >= r * r) continue
        hit = true
        if (d2 < 1e-6) {
          // Centre inside the tile: push out along the shallowest axis.
          const left = b.x - x0
          const right = x0 + g.cell - b.x
          const up = b.y - y0
          const down = y0 + g.cell - b.y
          const m = Math.min(left, right, up, down)
          if (m === left) b.x = x0 - r
          else if (m === right) b.x = x0 + g.cell + r
          else if (m === up) b.y = y0 - r
          else b.y = y0 + g.cell + r
          continue
        }
        const d = Math.sqrt(d2)
        dx /= d
        dy /= d
        b.x = nx + dx * r
        b.y = ny + dy * r
      }
    }
  }
  return hit
}

/** Push two circles apart equally. Returns true if they overlapped. */
export function separate(
  a: { x: number; y: number },
  b: { x: number; y: number },
  ra: number,
  rb: number,
): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const min = ra + rb
  if (d >= min || d < 1e-6) return false
  const push = (min - d) / 2
  a.x -= (dx / d) * push
  a.y -= (dy / d) * push
  b.x += (dx / d) * push
  b.y += (dy / d) * push
  return true
}

export interface Mover {
  x: number
  y: number
  vx: number
  vy: number
}

/** Move a point projectile, reflecting off walls axis by axis. Returns bounces this step. */
export function moveBouncing(g: Grid, p: Mover, dt: number, substeps = 3): number {
  let n = 0
  const h = dt / substeps
  for (let i = 0; i < substeps; i++) {
    const nx = p.x + p.vx * h
    if (solidAt(g, nx, p.y)) {
      p.vx = -p.vx
      n++
    } else p.x = nx
    const ny = p.y + p.vy * h
    if (solidAt(g, p.x, ny)) {
      p.vy = -p.vy
      n++
    } else p.y = ny
  }
  return n
}

/** Clear straight line between two points (sampled every `step` units). */
export function lineOfSight(
  g: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 12,
): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0)
  const n = Math.ceil(d / step)
  for (let i = 1; i < n; i++) {
    const t = i / n
    if (solidAt(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false
  }
  return true
}

/** Breadth-first search; returns the next cell centre to head for (or the target if already there / unreachable). */
export function bfsNext(
  g: Grid,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): { x: number; y: number; steps: number } {
  const from = cellOf(g, fx, fy)
  const to = cellOf(g, tx, ty)
  const idx = (c: number, r: number) => r * g.cols + c
  if (from.c === to.c && from.r === to.r) return { x: tx, y: ty, steps: 0 }
  const prev = new Int32Array(g.cols * g.rows).fill(-1)
  const start = idx(from.c, from.r)
  const goal = idx(to.c, to.r)
  if (start < 0 || start >= prev.length) return { x: tx, y: ty, steps: -1 }
  prev[start] = start
  const q = [start]
  let found = false
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] as number
    if (cur === goal) {
      found = true
      break
    }
    const c = cur % g.cols
    const r = (cur - c) / g.cols
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc
      const nr = r + dr
      if (solidCell(g, nc, nr)) continue
      const ni = idx(nc, nr)
      if (prev[ni] !== -1) continue
      prev[ni] = cur
      q.push(ni)
    }
  }
  if (!found) return { x: tx, y: ty, steps: -1 }
  let cur = goal
  let steps = 0
  while (prev[cur] !== start) {
    cur = prev[cur] as number
    steps++
  }
  const c = cur % g.cols
  return { ...cellCenter(g, c, (cur - c) / g.cols), steps: steps + 1 }
}

/** All floor cells reachable from (c, r). */
export function reachable(g: Grid, c: number, r: number): number {
  const seen = new Uint8Array(g.cols * g.rows)
  const q = [r * g.cols + c]
  seen[q[0] as number] = 1
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] as number
    const cc = cur % g.cols
    const rr = (cur - cc) / g.cols
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = cc + dc
      const nr = rr + dr
      if (solidCell(g, nc, nr)) continue
      const ni = nr * g.cols + nc
      if (seen[ni]) continue
      seen[ni] = 1
      q.push(ni)
    }
  }
  return q.length
}

/**
 * How dangerous is a projectile to a body at (x, y)? Returns the time to the
 * closest approach (s) when it passes within `radius` in the next `horizon`
 * seconds and is not blocked by a wall before then, else null.
 */
export function threat(
  g: Grid,
  p: Mover,
  x: number,
  y: number,
  radius: number,
  horizon = 0.8,
): number | null {
  const rx = x - p.x
  const ry = y - p.y
  const v2 = p.vx * p.vx + p.vy * p.vy
  if (v2 < 1) return null
  const t = (rx * p.vx + ry * p.vy) / v2
  if (t < 0 || t > horizon) return null
  const cx = p.x + p.vx * t - x
  const cy = p.y + p.vy * t - y
  if (cx * cx + cy * cy > radius * radius) return null
  if (!lineOfSight(g, p.x, p.y, p.x + p.vx * t, p.y + p.vy * t)) return null
  return t
}

/** Shortest signed angle from a to b. */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

// ---------- controls ----------

export interface SideControl {
  side: Side
  /** Which tank / actor of the side this drives (0 unless 2 vs 2). */
  lane: 0 | 1
  stick: Joystick
  fire: Button
}

/** Visual state of a control, copied into the snapshot so the guest can draw it. */
export interface ControlLook {
  side: Side
  bx: number
  by: number
  kx: number
  ky: number
  r: number
  on: boolean
  fx: number
  fy: number
  fr: number
  pressed: boolean
  /** 0..1 reload progress for the button ring. */
  ready: number
}

/**
 * Joystick + fire button(s) for a side, in its strip outside the arena
 * (red: below `arenaBottom`, blue: above `arenaTop`). Laid out from the
 * player's point of view: stick under the left thumb, button under the right.
 */
export function sideControls(
  stage: Stage,
  side: Side,
  teams: boolean,
  /** World y of the arena's bottom edge; blue's strip mirrors red's. */
  arenaBottom = ARENA.y0 + ARENA.rows * ARENA.cell,
): SideControl[] {
  const v = stage.view
  // Red's layout in world space; blue's is the same rotated 180° about the centre.
  const y0 = arenaBottom + 10
  const y1 = Math.max(stage.edge(0), arenaBottom + 220)
  const rad = teams ? 86 : 104
  // Keep the knob on screen at full deflection (travel `rad` plus its own radius).
  const cy = Math.min((y0 + y1) / 2, y1 - 120, stage.edge(0) - rad - 50)
  const left = v.x
  const red: {
    lane: 0 | 1
    zone: { x: number; y: number; w: number; h: number }
    hx: number
    bx: number
    br: number
  }[] = teams
    ? [
        {
          lane: 0,
          zone: { x: left, y: y0, w: 340 - left, h: y1 + 200 - y0 },
          hx: 170,
          bx: 410,
          br: 66,
        },
        { lane: 1, zone: { x: 510, y: y0, w: 310, h: y1 + 200 - y0 }, hx: 660, bx: 900, br: 66 },
      ]
    : [
        {
          lane: 0,
          zone: { x: left, y: y0, w: 650 - left, h: y1 + 200 - y0 },
          hx: 250,
          bx: 820,
          br: 92,
        },
      ]
  return red.map((l) => {
    if (side === 0) {
      return {
        side,
        lane: l.lane,
        stick: new Joystick(0, l.zone, rad, l.hx, cy, teams ? l.lane : undefined),
        fire: new Button(0, l.bx, cy, l.br),
      }
    }
    const z = l.zone
    const mirror = { x: W - (z.x + z.w), y: H - (z.y + z.h), w: z.w, h: z.h }
    // Rotating the layout swaps world lanes: red's left lane maps onto blue's right.
    const lane = (1 - l.lane) as 0 | 1
    return {
      side,
      lane,
      stick: new Joystick(1, mirror, rad, W - l.hx, H - cy, teams ? lane : undefined),
      fire: new Button(1, W - l.bx, H - cy, l.br),
    }
  })
}

/**
 * Did the fire button get pressed this step? `Button.hit` only sees fingers
 * still down at step time, so a very quick tap (down and up between two steps)
 * would be lost; this also counts presses that landed this step.
 */
export function firePressed(c: SideControl, input: PlayerInput): boolean {
  return c.fire.hit || input.pressedNear(c.fire.x, c.fire.y, c.fire.r * 1.25) !== undefined
}

export function snapControl(c: SideControl, ready: number): ControlLook {
  return {
    side: c.side,
    bx: c.stick.baseX,
    by: c.stick.baseY,
    kx: c.stick.knobX,
    ky: c.stick.knobY,
    r: c.stick.radius,
    on: c.stick.active,
    fx: c.fire.x,
    fy: c.fire.y,
    fr: c.fire.r,
    pressed: c.fire.pressed,
    ready,
  }
}

/** Draw a control from its snapshot: stick base + knob, and a round fire button with reload ring. */
export function drawControl(g: Draw, c: ControlLook): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.55, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.45), alpha(col.light, 0.5), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
  const depth = c.fr * 0.16
  const p = c.pressed ? depth : 0
  g.circle(c.fx, c.fy + depth, c.fr, shade(col.main, -0.45))
  g.circle(
    c.fx,
    c.fy + p,
    c.fr,
    g.rad(
      c.fx,
      c.fy,
      c.fr * 0.1,
      c.fr,
      [
        [0, shade(col.main, 0.3)],
        [1, col.main],
      ],
      c.fx - c.fr * 0.3,
      c.fy - c.fr * 0.4,
    ),
  )
  if (c.ready < 1)
    g.arc(
      c.fx,
      c.fy + p,
      c.fr + 10,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * c.ready,
      alpha(C.white, 0.7),
      7,
    )
  // Crosshair glyph, upright for its player.
  g.forSide(c.side, c.fx, c.fy + p, () => {
    const k = c.fr * 0.42
    g.ring(0, 0, k, C.white, c.fr * 0.1)
    g.line(-k * 1.45, 0, -k * 0.55, 0, C.white, c.fr * 0.1)
    g.line(k * 0.55, 0, k * 1.45, 0, C.white, c.fr * 0.1)
    g.line(0, -k * 1.45, 0, -k * 0.55, C.white, c.fr * 0.1)
    g.line(0, k * 0.55, 0, k * 1.45, C.white, c.fr * 0.1)
  })
}

// ---------- drawing ----------

/** Team-coloured control strips above and below the arena, bleeding into the letterbox. */
export function drawStrip(
  g: Draw,
  top = ARENA.y0,
  bottom = ARENA.y0 + ARENA.rows * ARENA.cell,
): void {
  const v = g.stage.view
  g.rect(v.x - 2, v.y - 2, v.w + 4, top - v.y + 2, shade(C.blue, -0.76))
  g.rect(v.x - 2, bottom, v.w + 4, v.y + v.h - bottom + 2, shade(C.red, -0.76))
}

/** Checkered floor, faintly tinted toward each team's end. */
export function drawFloor(g: Draw, grid: Grid, a: string = '#2a2f4a', b: string = '#262a43'): void {
  const w = grid.cols * grid.cell
  const h = grid.rows * grid.cell
  g.rect(grid.x0, grid.y0, w, h, a)
  for (let r = 0; r < grid.rows; r++)
    for (let c = r % 2; c < grid.cols; c += 2)
      g.rect(grid.x0 + c * grid.cell, grid.y0 + r * grid.cell, grid.cell, grid.cell, b)
  g.rect(
    grid.x0,
    grid.y0,
    w,
    h,
    g.lin(0, grid.y0, 0, grid.y0 + h, [
      [0, alpha(C.blue, 0.1)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.1)],
    ]),
  )
}

/** Raised wall blocks (toy crates) with contact shadows, plus a rim around the arena. */
export function drawWalls(g: Draw, grid: Grid, face: string = '#c98a4b'): void {
  const w = grid.cols * grid.cell
  const h = grid.rows * grid.cell
  const s = grid.cell
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      if (!solidCell(grid, c, r)) continue
      g.rect(grid.x0 + c * s + 8, grid.y0 + r * s + 14, s, s, alpha('#000000', 0.28))
    }
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      if (!solidCell(grid, c, r)) continue
      const x = grid.x0 + c * s
      const y = grid.y0 + r * s
      g.tile(x + 3, y - 8, s - 6, s + 6, 16, face, 14)
      g.line(x + 20, y + 4, x + s - 20, y + s - 30, alpha(shade(face, -0.45), 0.55), 7)
      g.line(x + s - 20, y + 4, x + 20, y + s - 30, alpha(shade(face, -0.45), 0.55), 7)
    }
  // Rim.
  g.rrect(grid.x0 - 10, grid.y0 - 10, w + 20, h + 20, 28, undefined, shade(C.ink, 0.15), 20)
  g.rrect(grid.x0 - 10, grid.y0 - 10, w + 20, h + 20, 28, undefined, alpha(C.white, 0.08), 4)
}
