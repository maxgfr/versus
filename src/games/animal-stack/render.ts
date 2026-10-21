import { outBack } from '../../core/fx/ease.ts'
import type { Mode, Side } from '../../core/game.ts'
import { namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type BodySnap, drawShape, extent } from '../../engines/ragdoll/index.ts'
import { ISLAND, PIECES, shapeOf } from './rules.ts'

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
  hx: number
  ha: number
  hoverY: number
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
  glyph: string
  fellAt: number
  loser: Side | null
}

const SEA_Y = ISLAND.top + 330

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

function clouds(g: Draw, cam: number): void {
  // Parallax: clouds drift past slower than the tower.
  for (let i = 0; i < 9; i++) {
    const y = ISLAND.top - 250 - i * 520 + cam * 0.45
    const x = ((i * 389) % 1100) - 50
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

function hover(g: Draw, v: SceneView): void {
  const k = v.piece
  const p = PIECES[k]
  if (!p) return
  const bob = v.aiming ? 0 : Math.sin(v.time * 3) * 8
  const y = v.hoverY + bob
  const { hh } = extent(shapeOf(k))
  const col = SIDE[v.turn]
  // Drop guide down to the tower.
  g.dashed(v.hx, y + hh + 16, v.hx, ISLAND.top, alpha(col.main, 0.55), 6, [18, 16])
  // The team's crane hook holding the block.
  g.line(v.hx, y - hh - 220, v.hx, y - hh - 10, alpha(C.ink, 0.6), 8)
  g.circle(v.hx, y - hh - 12, 16, col.main)
  drawShape(g, shapeOf(k), v.hx, y, v.ha, p.color, p.glyph)
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

function nextPreview(g: Draw, side: Side, k: number, at: { x: number; y: number }): void {
  const p = PIECES[k]
  if (!p) return
  g.forSide(side, at.x, at.y, () => {
    g.rrect(-74, -74, 148, 148, 34, alpha(C.ink, 0.62))
    g.rrect(-74, -74, 148, 148, 34, undefined, alpha('#ffffff', 0.2), 3)
    g.text('next', 0, -46, { size: 34, weight: 600, color: alpha('#ffffff', 0.85) })
    g.emoji(p.glyph, 0, 16, 64)
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

export function drawScene(g: Draw, v: SceneView): void {
  const c = g.ctx
  c.save()
  c.translate(W / 2, MID)
  c.rotate(v.rot)
  c.translate(-W / 2, -MID)
  sky(g, v.cam, v.time)
  c.translate(0, v.cam)
  clouds(g, v.cam)
  sea(g, v.time)
  island(g)
  for (const b of v.bodies) {
    const p = PIECES[b.k]
    if (p) drawShape(g, p.shape, b.x, b.y, b.a, p.color, p.glyph)
  }
  if (v.showHover) hover(g, v)
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
  if (!v.over && v.showHover && !v.bots[v.turn]) {
    rotateButton(g, side, ROTATE_BTN[side])
    nextPreview(g, side, v.next, NEXT_AT[side])
  }
  toppled(g, v)
  if (v.loading) g.both('Loading…', { size: 48, color: shade(C.white, -0.2) })
}
