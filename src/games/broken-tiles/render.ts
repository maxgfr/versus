import type { Side } from '../../core/game.ts'
import { namePill } from '../../core/hud.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { drawRounds } from '../../engines/reflex/index.ts'
import type { State } from './index.ts'
import {
  type Board,
  COLS,
  CRACK,
  DROP,
  GONE,
  HOLES,
  INTACT,
  ROWS,
  STAND,
  TILE,
  tileCentre,
} from './rules.ts'

/** A joystick's visuals, copied into the state so the online guest can draw it. */
export interface StickLook {
  side: Side
  on: boolean
  bx: number
  by: number
  kx: number
  ky: number
  r: number
}

/** Seconds a dropped tile (or a body) takes to tumble out of sight. */
const SINK = 0.9
/** Drawn radius of a body (its footprint in the rules is smaller). */
const R = 44
/** Slab thickness: tiles read as pillars floating over the void. */
const DEPTH = 20
const FACE_BLUE = mix('#f2f7ff', C.blueLight, 0.4)
const FACE_RED = mix('#fff4f2', C.redLight, 0.38)

/** The odd middle row belongs to nobody: neutral stone, so neither half looks bigger. */
const FACE_MID = mix('#f6f2ff', C.purple, 0.16)

function faceOf(i: number): string {
  const r = Math.floor(i / COLS)
  if (ROWS % 2 === 1 && r === (ROWS - 1) / 2) return FACE_MID
  return r < ROWS / 2 ? FACE_BLUE : FACE_RED
}

/** Cheap deterministic hash in 0..1, for per-tile variety. */
function hash(i: number, k = 0): number {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 0..1: how close the tile under someone's feet is to cracking from standing. */
function warnOf(b: Board, i: number, now: number): number {
  let w = 0
  for (const p of b.p) {
    if (!p.alive || p.tile !== i) continue
    w = Math.max(w, (now - p.since - STAND * 0.45) / (STAND * 0.55))
  }
  return clamp(w, 0, 1)
}

/** Jagged cracks radiating from the tile's centre; `p` grows them from hairline to full. */
function cracks(g: Draw, i: number, p: number): void {
  for (let k = 0; k < 5; k++) {
    const a = k * 1.26 + hash(i, k) * 0.9
    const len = TILE * 0.5 * (0.3 + 0.7 * p) * (0.65 + hash(i, k + 7) * 0.35)
    const mx = Math.cos(a) * len * 0.5 + Math.cos(a + 1.3) * 9
    const my = Math.sin(a) * len * 0.5 + Math.sin(a + 1.3) * 9
    const ex = Math.cos(a) * len
    const ey = Math.sin(a) * len
    g.line(0, 0, mx, my, '#3a2131', 8)
    g.line(mx, my, ex, ey, '#3a2131', 6)
    g.line(1, 2, mx + 1, my + 2, alpha('#ffffff', 0.55), 2.5)
  }
}

/** The abyss: a deep, dim void with motes drifting far below the board. */
function table(g: Draw, now: number): void {
  g.fillView(
    g.rad(W / 2, H / 2, 80, 1300, [
      [0, '#1d1840'],
      [0.6, '#0e0b22'],
      [1, '#05040c'],
    ]),
  )
  const v = g.stage.view
  g.rect(
    v.x - 2,
    v.y - 2,
    v.w + 4,
    v.h + 4,
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, alpha(C.blue, 0.2)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.2)],
    ]),
  )
  // Motes far below: slow, faint, so the holes look deep.
  for (let k = 0; k < 46; k++) {
    const x = 40 + hash(k, 1) * 920
    const y = (((hash(k, 2) * H - now * (12 + hash(k, 3) * 22)) % H) + H) % H
    const tw = 0.5 + 0.5 * Math.sin(now * 2 + k)
    g.circle(x, y, 2 + hash(k, 4) * 3, alpha(k % 3 === 0 ? C.purple : C.cyan, 0.1 + 0.18 * tw))
  }
}

/** Pop-in scale of tile `i` at the start of a round: a wave rising out from the middle. */
function rise(i: number, since: number): number {
  const c = i % COLS
  const r = Math.floor(i / COLS)
  const d = Math.abs(c - (COLS - 1) / 2) + Math.abs(r - (ROWS - 1) / 2)
  return clamp((since - d * 0.035) / 0.38, 0, 1)
}

/** One tile slab, centred at (0, 0), drawn in its own little frame. */
function slab(g: Draw, face: string, depth = DEPTH): void {
  const h = TILE / 2
  g.tile(-h, -h, TILE, TILE + depth * 0.5, 20, face, depth)
}

/** Tiles that dropped: they tumble away into the void (smaller, darker, fading). */
function sinking(g: Draw, b: Board, now: number): void {
  for (let i = 0; i < b.st.length; i++) {
    if (b.st[i] !== GONE || HOLES.includes(i)) continue
    const f = (now - (b.t[i] ?? -9)) / SINK
    if (f < 0 || f >= 1) continue
    const c = tileCentre(i)
    const e = outCubic(f)
    const spin = (hash(i, 9) - 0.5) * 1.6 * e
    g.alpha(1 - f * f, () =>
      g.at(
        c.x,
        c.y + e * 40,
        spin,
        () => slab(g, mix(mix(faceOf(i), C.orange, 0.8), '#1a1433', e * 0.9)),
        1 - e * 0.72,
      ),
    )
  }
}

function tiles(
  g: Draw,
  b: Board,
  now: number,
  since: number,
  owner: (i: number) => Side | -1,
): void {
  for (let i = 0; i < b.st.length; i++) {
    const st = b.st[i]
    if (st === GONE) continue
    const c = tileCentre(i)
    const k = rise(i, since)
    if (k <= 0) continue
    const sc = 0.4 + 0.6 * outBack(k)
    const t0 = b.t[i] ?? -9
    if (st === INTACT) {
      const w = warnOf(b, i, now)
      const sx = w > 0 ? Math.sin(now * 60 + i) * 3.5 * w : 0
      const who = owner(i)
      g.alpha(k, () =>
        g.at(
          c.x + sx,
          c.y,
          0,
          () => {
            slab(g, faceOf(i))
            // The tile you stand on wears your colour.
            if (who >= 0) {
              const col = SIDE[who as Side]
              g.rrect(
                -TILE / 2 + 5,
                -TILE / 2 + 5,
                TILE - 10,
                TILE - 10,
                16,
                undefined,
                col.main,
                7,
              )
              g.alpha(0.18, () =>
                g.rrect(-TILE / 2 + 5, -TILE / 2 + 5, TILE - 10, TILE - 10, 16, col.main),
              )
            }
            if (w > 0) {
              g.alpha(w, () =>
                g.rrect(-TILE / 2, -TILE / 2, TILE, TILE, 20, undefined, C.yellow, 5 + 4 * w),
              )
              g.alpha(w * 0.8, () => cracks(g, i, 0.1 + 0.25 * w))
            }
          },
          sc,
        ),
      )
    } else if (st === CRACK) {
      const p = clamp((now - t0) / DROP, 0, 1)
      const sx = Math.sin(now * 90 + i) * (1.5 + 6 * p)
      const sy = Math.cos(now * 75 + i * 3) * (1 + 3 * p)
      g.at(c.x + sx, c.y + sy, (hash(i, 5) - 0.5) * 0.08 * p, () => {
        slab(g, mix(faceOf(i), C.orange, 0.45 + 0.4 * p), DEPTH * (1 - 0.4 * p))
        cracks(g, i, p)
        // Glowing seams once it is about to go.
        if (p > 0.5)
          g.alpha((p - 0.5) * 2 * (0.6 + 0.4 * Math.sin(now * 40)), () =>
            g.rrect(-TILE / 2, -TILE / 2, TILE, TILE, 20, undefined, C.yellow, 6),
          )
      })
    }
  }
}

/** Notches under the pause button: a dark socket so the board's edge reads as deliberate. */
function notches(g: Draw): void {
  for (const i of HOLES) {
    const c = tileCentre(i)
    g.rrect(
      c.x - TILE / 2 + 10,
      c.y - TILE / 2 + 10,
      TILE - 20,
      TILE - 20,
      18,
      undefined,
      alpha(C.white, 0.06),
      4,
    )
  }
}

interface Pose {
  side: Side
  x: number
  y: number
  vx: number
  vy: number
}

function blobAt(
  g: Draw,
  p: Pose,
  now: number,
  o: {
    mood: 'happy' | 'wow' | 'angry' | 'grin' | 'dizzy'
    hop: number
    sc?: number
    spin?: number
    colour?: string
  },
): void {
  const col = o.colour ?? SIDE[p.side].main
  const speed = Math.hypot(p.vx, p.vy)
  const th = g.orient(p.side)
  // Pupils look where the body is heading, in its own (upright) frame.
  const look: [number, number] =
    speed > 20
      ? [
          (Math.cos(th) * p.vx + Math.sin(th) * p.vy) / speed,
          (-Math.sin(th) * p.vx + Math.cos(th) * p.vy) / speed,
        ]
      : [0, 0.15]
  const walk = speed > 20 ? Math.sin(now * 18 + p.side * 2) : 0
  const sq = 1 + walk * 0.07 + o.hop * 0.0025
  const sc = o.sc ?? 1
  g.forSide(p.side, p.x, p.y - o.hop, () =>
    g.blob(0, 0, R * sc, col, {
      mood: o.mood,
      look,
      sx: 1 / sq,
      sy: sq,
      angle: (o.spin ?? 0) + walk * 0.06,
    }),
  )
}

/** A body that fell: tumbling away into the void, under the board. */
function falling(g: Draw, b: Board, side: Side, now: number): void {
  const p = b.p[side]
  if (p.alive) return
  const f = (now - p.fallT) / SINK
  if (f >= 1.4) return
  const e = outCubic(Math.min(1, f))
  g.alpha(clamp(1.3 - f, 0, 1), () =>
    blobAt(g, { side, x: p.x, y: p.y + e * 30, vx: 0, vy: 0 }, now, {
      mood: 'dizzy',
      hop: 0,
      sc: 1 - e * 0.7,
      spin: f * 7,
      colour: mix(SIDE[side].main, '#0b0918', e * 0.6),
    }),
  )
}

function piece(g: Draw, s: State, side: Side, now: number): void {
  const b = s.b
  const p = b.p[side]
  if (!p.alive) return
  const r = s.rounds
  const won = r.phase === 'between' && r.last === side
  const onCrack = p.tile >= 0 && b.st[p.tile] === CRACK
  const warn = p.tile >= 0 ? warnOf(b, p.tile, now) : 0
  const hop = won ? Math.abs(Math.sin((now - r.at) * 7)) * 34 : 0
  const mood = won ? 'grin' : onCrack ? 'wow' : warn > 0.5 ? 'angry' : 'happy'
  g.shadow(p.x, p.y + R * 0.78, R * (1.05 - hop / 140), R * 0.36, 0.42)
  blobAt(g, { side, x: p.x, y: p.y, vx: p.vx, vy: p.vy }, now, { mood, hop })
  // Red is a circle, blue a square, above the head (never colour alone).
  g.forSide(side, p.x, p.y - hop, () => {
    g.sideMark(side, 0, -R * 1.5, 11, C.white)
    g.sideMark(side, 0, -R * 1.5, 7, SIDE[side].main)
  })
}

function joystick(g: Draw, k: StickLook): void {
  if (!k.on) return
  const col = SIDE[k.side]
  g.alpha(0.9, () => {
    g.circle(k.bx, k.by, k.r, alpha(col.dark, 0.35), alpha(col.light, 0.5), 5)
    g.ball(k.kx, k.ky, k.r * 0.45, col.main, 0.6)
  })
}

export function renderBroken(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
  humans: readonly [boolean, boolean],
): void {
  const b = s.b
  const since = s.rounds.phase === 'play' ? now - s.rounds.at : 9
  // The first board is already standing during the countdown; later rounds rise in a wave.
  const built = s.rounds.round > 1 ? since : 9
  table(g, now)
  notches(g)
  sinking(g, b, now)
  falling(g, b, 0, now)
  falling(g, b, 1, now)
  const owner = (i: number): Side | -1 => {
    for (const side of [0, 1] as const) if (b.p[side].alive && b.p[side].tile === i) return side
    return -1
  }
  tiles(g, b, now, built, owner)
  // The body nearer the bottom of the screen is drawn last (in front).
  const order: Side[] = b.p[0].y >= b.p[1].y ? [1, 0] : [0, 1]
  for (const side of order) piece(g, s, side, now)
  for (const k of s.ctl) joystick(g, k)
  // A first-round hint for each human, upright in their half.
  if (s.rounds.round === 1 && since < 3.2)
    for (const side of [0, 1] as const) {
      if (!humans[side] || s.ctl[side]?.on) continue
      const y = side === 0 ? MID + 640 : MID - 640
      g.alpha(Math.min(1, (3.2 - since) * 2) * 0.95, () =>
        g.forSide(side, W / 2, y, () => {
          const tw = g.measure('Drag to move', 44, 700) + 64
          g.rrect(-tw / 2, -40, tw, 80, 40, alpha(C.ink, 0.82))
          g.rrect(-tw / 2, -40, tw, 80, 40, undefined, alpha(SIDE[side].main, 0.8), 4)
          g.text('Drag to move', 0, 2, { size: 44, weight: 700, color: C.white })
        }),
      )
    }
  namePill(g, 0, names[0], { active: b.p[0].alive, text: b.p[0].alive ? undefined : 'Fell!' })
  namePill(g, 1, names[1], { active: b.p[1].alive, text: b.p[1].alive ? undefined : 'Fell!' })
  drawRounds(g, s.rounds, now, { over })
}
