import { outBack, Spring } from '../../core/fx/ease.ts'
import type { Mode, Side } from '../../core/game.ts'
import { namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { BodySnap } from '../../engines/ragdoll/index.ts'
import { ISLAND, toyOf } from './rules.ts'
import { drawToy, type Mood } from './toy.ts'

/** Rotate button per side, in fixed world coords (the host hit-tests the guest's touches against these). */
export const ROTATE_BTN: [
  { x: number; y: number; r: number },
  { x: number; y: number; r: number },
] = [
  { x: W - 120, y: 1630, r: 66 },
  { x: 120, y: 170, r: 66 },
]
const NEXT_AT: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 120, y: 1630 },
  { x: W - 120, y: 170 },
]

export interface SceneView {
  bodies: BodySnap[]
  piece: number
  next: number
  /** The hand's x (where the rope hangs from) and the piece's x after the sway. */
  hx: number
  x: number
  ha: number
  hoverY: number
  /** Where the hovering piece would touch down if it fell straight (null: into the sea). */
  landing: number | null
  showHover: boolean
  cam: number
  rot: number
  turn: Side
  n: number
  time: number
  names: [string, string]
  bots: [boolean, boolean]
  mode: Mode
  over: boolean
  loading: boolean
  aiming: boolean
  fellAt: number
  loser: Side | null
  /** 0..1 tower wobble. */
  wob: number
  /** Seconds left to drop, or -1. */
  clock: number
  /** Game time of the last drop and the x it was let go at. */
  dropAt: number
  dropX: number
}

const SEA_Y = ISLAND.top + 330

/**
 * Faces for the tower: each animal's mood, blink and landing squash, read from
 * how its snapshot moves (so the online guest, which only gets snapshots, sees
 * the same reactions). Cosmetic only.
 */
export class Faces {
  private seen = new Map<
    number,
    { x: number; y: number; a: number; dy: number; landed: number; spring: Spring }
  >()
  private last: readonly BodySnap[] | null = null

  update(bodies: readonly BodySnap[], time: number): void {
    for (const f of this.seen.values()) f.spring.update(1 / 60)
    if (bodies === this.last) return
    this.last = bodies
    const live = new Set<number>()
    for (const b of bodies) {
      live.add(b.id)
      const f = this.seen.get(b.id)
      if (!f) {
        this.seen.set(b.id, {
          x: b.x,
          y: b.y,
          a: b.a,
          dy: 0,
          landed: -10,
          spring: new Spring(1, 300, 11),
        })
        continue
      }
      const dy = b.y - f.y
      // A landing: it was dropping fast and has just stopped.
      if (f.dy > 5 && dy < 1.5) {
        f.spring.kick(-Math.min(9, f.dy * 0.6))
        f.landed = time
      }
      f.dy = dy
      f.x = b.x
      f.y = b.y
      f.a = b.a
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id)
  }

  /** How animal `id` looks right now. */
  of(
    b: BodySnap,
    time: number,
    wob: number,
    fell: boolean,
  ): { mood: Mood; squash: number; blink: boolean } {
    const f = this.seen.get(b.id)
    // Idle life: a slow breath, out of step from one animal to the next.
    const breathe = 1 + Math.sin(time * 2.2 + b.id * 1.7) * 0.012
    const squash = (f?.spring.value ?? 1) * breathe
    const blink = (time + b.id * 1.37) % 3.4 < 0.12
    let mood: Mood = 'happy'
    if (fell) mood = b.y > ISLAND.top ? 'wow' : 'sad'
    else if (f && f.dy > 5) mood = 'wow'
    else if (f && time - f.landed < 0.6) mood = 'grin'
    else if (wob > 0.35) mood = 'scared'
    return { mood, squash, blink }
  }
}

/** Day at the bottom of the tower, dusk higher up, stars at the top. */
function sky(g: Draw, cam: number, time: number): void {
  const alt = Math.min(1.6, cam / 1400)
  const pick = (day: string, dusk: string, night: string) =>
    alt < 0.8 ? mix(day, dusk, alt / 0.8) : mix(dusk, night, Math.min(1, (alt - 0.8) / 0.8))
  const top = pick('#6fc3ff', '#6a4fa8', '#0f0c29')
  const bottom = pick('#dff4ff', '#ffb38a', '#3b2a6b')
  g.rect(
    -1000,
    -1000,
    W + 2000,
    1800 + 2000,
    g.lin(0, 0, 0, 1800, [
      [0, top],
      [1, bottom],
    ]),
  )
  if (alt > 0.7) {
    g.alpha(Math.min(1, (alt - 0.7) * 1.5), () => {
      for (let i = 0; i < 60; i++) {
        const x = ((i * 157) % (W + 400)) - 200
        const y = ((i * 271) % 1300) - 100
        const tw = 0.5 + 0.5 * Math.sin(time * 2 + i)
        g.circle(x, y, 3 + (i % 3), alpha('#ffffff', 0.4 + tw * 0.5))
      }
    })
  }
}

function clouds(g: Draw, cam: number, time: number): void {
  // Parallax: clouds drift past slower than the tower, and slowly sideways.
  for (let i = 0; i < 9; i++) {
    const y = ISLAND.top - 250 - i * 520 + cam * 0.45
    const x = ((i * 389 + time * (8 + i * 2)) % 1300) - 150
    g.alpha(0.85, () => {
      g.ellipse(x, y, 120, 46, '#ffffff')
      g.ellipse(x + 80, y - 26, 90, 54, '#ffffff')
      g.ellipse(x + 160, y, 80, 38, '#ffffff')
    })
  }
}

function sea(g: Draw, time: number): void {
  g.rect(
    -1000,
    SEA_Y,
    W + 2000,
    3000,
    g.lin(0, SEA_Y, 0, SEA_Y + 900, [
      [0, '#3fb4f0'],
      [1, '#145a9c'],
    ]),
  )
  for (let row = 0; row < 4; row++) {
    const y = SEA_Y + 30 + row * 70
    const off = Math.sin(time * 1.5 + row) * 30
    for (let x = -200 + off + (row % 2) * 60; x < W + 200; x += 120) {
      g.arc(x, y, 26, Math.PI * 1.15, Math.PI * 1.85, alpha('#ffffff', 0.45 - row * 0.08), 6)
    }
  }
}

function island(g: Draw): void {
  const { x, top, w } = ISLAND
  // Rock tapering into the sea.
  g.poly(
    [
      x - w / 2,
      top + 20,
      x + w / 2,
      top + 20,
      x + w / 2 - 70,
      top + 170,
      x + 60,
      top + 360,
      x - 90,
      top + 330,
      x - w / 2 + 60,
      top + 160,
    ],
    '#8c5a2b',
  )
  g.poly(
    [
      x - w / 2 + 30,
      top + 60,
      x + w / 2 - 30,
      top + 60,
      x + w / 2 - 90,
      top + 150,
      x - w / 2 + 80,
      top + 140,
    ],
    '#a86d36',
  )
  g.rrect(x - w / 2, top, w, ISLAND.h, 18, '#6b4220')
  g.rrect(x - w / 2, top - 4, w, 38, 18, C.grass)
  g.rect(x - w / 2 + 14, top + 26, w - 28, 8, C.grassDark)
  // Grass tufts on the rim only, never on the building surface.
  for (const tx of [x - w / 2 + 18, x + w / 2 - 18])
    g.poly([tx - 16, top + 4, tx, top - 22, tx + 16, top + 4], C.grassDark)
}

/** The crane: a rope from the hand down to the piece, swinging with the sway. */
function crane(g: Draw, v: SceneView, y: number, col: string): void {
  const t = toyOf(v.piece)
  const hookY = y - t.radius - 10
  const topY = hookY - 260
  g.line(v.hx, topY, v.x, hookY, alpha(C.ink, 0.6), 8)
  g.rrect(v.hx - 36, topY - 20, 72, 30, 12, shade(col, -0.3))
  g.circle(v.x, hookY, 16, col)
  g.ring(v.x, hookY, 16, alpha('#ffffff', 0.5), 3)
}

function hover(g: Draw, v: SceneView): void {
  const t = toyOf(v.piece)
  // Idle: a gentle bob; while aiming the hand holds it steady.
  const bob = v.aiming ? 0 : Math.sin(v.time * 3) * 8
  const y = v.hoverY + bob
  const col = SIDE[v.turn]
  // Landing preview: a dashed drop line and a ghost where it would touch down.
  if (v.landing !== null) {
    g.dashed(v.x, y + t.radius * 0.5, v.x, v.landing, alpha(col.light, 0.55), 6, [18, 16])
    drawToy(g, t, v.x, v.landing, v.ha, { ghost: 0.28 })
  } else {
    // Nothing underneath: it would fall straight into the sea.
    g.dashed(v.x, y + t.radius * 0.5, v.x, SEA_Y, alpha(C.red, 0.5), 6, [18, 16])
  }
  crane(g, v, y, col.main)
  drawToy(g, t, v.x, y, v.ha, {
    mood: v.landing === null ? 'scared' : 'happy',
    look: [0, 1],
    blink: v.time % 2.9 < 0.12,
  })
}

/** The rope swinging back up after a drop. */
function emptyHook(g: Draw, v: SceneView): void {
  const e = v.time - v.dropAt
  if (e < 0 || e > 0.6) return
  const k = e / 0.6
  const y = v.hoverY - 120 - k * 220
  g.alpha(1 - k, () => {
    g.line(v.dropX, y - 260, v.dropX, y, alpha(C.ink, 0.6), 8)
    g.circle(v.dropX, y, 16, SIDE[v.turn === 0 ? 1 : 0].main)
  })
}

function rotateButton(g: Draw, side: Side, at: { x: number; y: number; r: number }): void {
  const col = SIDE[side]
  g.circle(at.x, at.y + 10, at.r, col.dark)
  g.circle(at.x, at.y, at.r, col.main)
  g.forSide(side, at.x, at.y, () => {
    g.arc(0, 0, at.r * 0.45, -Math.PI * 0.2, Math.PI * 1.35, '#ffffff', 10)
    const a = Math.PI * 1.35
    const ex = Math.cos(a) * at.r * 0.45
    const ey = Math.sin(a) * at.r * 0.45
    g.poly([ex - 16, ey + 2, ex + 14, ey - 10, ex + 6, ey + 18], '#ffffff')
  })
}

function nextPreview(
  g: Draw,
  side: Side,
  k: number,
  at: { x: number; y: number },
  time: number,
): void {
  const t = toyOf(k)
  g.forSide(side, at.x, at.y, () => {
    g.rrect(-74, -74, 148, 148, 34, alpha(C.ink, 0.62))
    g.rrect(-74, -74, 148, 148, 34, undefined, alpha('#ffffff', 0.2), 3)
    g.text('next', 0, -46, { size: 34, weight: 600, color: alpha('#ffffff', 0.85) })
    // A small copy of the real piece, scaled to fit.
    const s = Math.min(0.5, 62 / t.radius)
    g.at(0, 18, 0, () => drawToy(g, t, 0, 0, 0, { blink: time % 3.1 < 0.12 }), s)
  })
}

/** The turn clock's last seconds, by the mover's rotate button. */
function clock(g: Draw, side: Side, left: number): void {
  if (left > 5 || left <= 0) return
  const n = Math.ceil(left)
  const f = n - left
  const s = 1 + 0.25 * Math.max(0, 1 - f * 4)
  const at = ROTATE_BTN[side]
  const x = side === 0 ? at.x - 150 : at.x + 150
  g.forSide(side, x, at.y, () => {
    g.circle(0, 0, 50 * s, alpha(C.ink, 0.8))
    g.arc(
      0,
      0,
      50 * s,
      -Math.PI / 2,
      -Math.PI / 2 + (left / 5) * Math.PI * 2,
      n <= 2 ? C.red : C.yellow,
      8,
    )
    g.text(n, 0, 3, { size: 52 * s, weight: 700, color: n <= 2 ? C.red : C.yellow })
  })
}

/** The fall: a "Toppled!" stamp for whoever knocked it over, upright for them. */
function toppled(g: Draw, v: SceneView): void {
  if (v.fellAt < 0 || v.loser === null) return
  const loser = v.loser
  const t = v.time - v.fellAt
  const s = outBack(Math.min(1, t / 0.35))
  const a = Math.min(1, t * 6)
  const stamp = (side: Side | undefined, y: number) =>
    g.forSide(side, W / 2, y, () =>
      g.alpha(a, () =>
        g.at(
          0,
          0,
          -0.1,
          () => {
            const label = 'Toppled!'
            const w = g.measure(label, 84, 700) + 200
            g.rrect(-w / 2, -72, w, 144, 48, shade(SIDE[loser].main, -0.45))
            g.rrect(-w / 2, -72, w, 144, 48, undefined, C.yellow, 8)
            g.emoji('💥', -w / 2 + 80, 0, 88)
            g.text(label, 60, 4, {
              size: 84,
              weight: 700,
              color: C.white,
              drop: alpha('#000', 0.35),
            })
          },
          s,
        ),
      ),
    )
  if (v.mode === '2p') stamp(loser, loser === 0 ? MID + 280 : MID - 280)
  else stamp(undefined, MID - 280)
}

export function drawScene(g: Draw, v: SceneView, faces: Faces): void {
  const c = g.ctx
  c.save()
  c.translate(W / 2, MID)
  c.rotate(v.rot)
  c.translate(-W / 2, -MID)
  sky(g, v.cam, v.time)
  c.translate(0, v.cam)
  clouds(g, v.cam, v.time)
  sea(g, v.time)
  island(g)
  const fell = v.fellAt >= 0
  // Pupils follow the hanging piece (or look up at the one falling in).
  for (const b of v.bodies) {
    const f = faces.of(b, v.time, v.wob, fell)
    const lx = Math.max(-1, Math.min(1, (v.x - b.x) / 300))
    drawToy(g, toyOf(b.k), b.x, b.y, b.a, { ...f, look: [lx, -0.7] })
  }
  if (v.showHover) hover(g, v)
  else emptyHook(g, v)
  c.restore()

  // HUD at the players' edges, outside the turning scene.
  for (const side of [0, 1] as Side[]) {
    const active = !v.over && v.turn === side
    const bot = v.bots[side]
    const text = active
      ? bot
        ? 'Thinking…'
        : v.mode === 'online' || v.mode === '1p'
          ? 'Your turn'
          : 'Drag, then let go'
      : undefined
    namePill(g, side, v.names[side], text ? { active, text } : { active })
  }
  const side = v.mode === '1p' ? 0 : v.turn
  // Online, each phone shows only its own player's controls.
  const own = g.viewer === null || g.viewer === v.turn
  if (!v.over && v.showHover && !v.bots[v.turn] && own) {
    rotateButton(g, side, ROTATE_BTN[side])
    nextPreview(g, side, v.next, NEXT_AT[side], v.time)
  }
  if (!v.over && v.showHover) clock(g, side, v.clock)
  toppled(g, v)
  if (v.loading) g.both('Loading…', { size: 48, color: shade(C.white, -0.2) })
}
