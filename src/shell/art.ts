import { EMOJI_FONT, shade } from '../core/render/palette.ts'
import { FAMILIES, type GameMeta } from '../registry.ts'

/**
 * Card art, drawn procedurally: the family's motif in its colour, the game's
 * glyph on top. Rendered once per game into a PNG blob URL so the home grid
 * holds lightweight <img>s instead of a hundred live canvases (iOS caps canvas
 * memory).
 */

const W = 320
const H = 262
const urls = new Map<string, string>()

// Real captures of each game in action (scripts/thumbs.mjs). Only their URLs
// are bundled; the images load lazily as cards scroll into view.
const captures = import.meta.glob<string>('../assets/thumbs/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
})

export function capture(id: string): string | undefined {
  return captures[`../assets/thumbs/${id}.webp`]
}
let canvas: HTMLCanvasElement | null = null

/** Stable per-game pseudo-random, so the art never reshuffles between visits. */
function hashRng(id: string): () => number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

export function familyColor(g: GameMeta): string {
  return FAMILIES.find((f) => f.id === g.family)?.color ?? '#5a4f80'
}

export async function cardArt(g: GameMeta): Promise<string> {
  const hit = urls.get(g.id)
  if (hit) return hit
  canvas ??= document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')
  if (!c) return ''
  paint(c, g)
  const blob = await new Promise<Blob | null>((r) => canvas?.toBlob(r, 'image/png'))
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  urls.set(g.id, url)
  return url
}

function paint(c: CanvasRenderingContext2D, g: GameMeta): void {
  const col = familyColor(g)
  const rnd = hashRng(g.id)
  const bg = c.createLinearGradient(0, 0, W * 0.4, H)
  bg.addColorStop(0, shade(col, 0.08))
  bg.addColorStop(1, shade(col, -0.32))
  c.fillStyle = bg
  c.fillRect(0, 0, W, H)
  c.save()
  c.globalAlpha = 0.22
  c.strokeStyle = shade(col, -0.55)
  c.fillStyle = shade(col, -0.55)
  c.lineWidth = 10
  c.lineCap = 'round'
  motif(c, g.family, rnd)
  c.restore()
  // Floodlight: a soft pool behind the glyph.
  const pool = c.createRadialGradient(W / 2, H * 0.54, 10, W / 2, H * 0.54, H * 0.6)
  pool.addColorStop(0, 'rgba(255,255,255,0.32)')
  pool.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = pool
  c.fillRect(0, 0, W, H)
  // Glyph with a contact shadow, slightly tilted per game.
  const tilt = (rnd() - 0.5) * 0.3
  c.save()
  c.translate(W / 2, H * 0.53)
  c.fillStyle = 'rgba(0,0,0,0.28)'
  c.beginPath()
  c.ellipse(0, 86, 74, 14, 0, 0, Math.PI * 2)
  c.fill()
  c.rotate(tilt)
  c.font = `150px ${EMOJI_FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.shadowColor = 'rgba(0,0,0,0.35)'
  c.shadowBlur = 18
  c.shadowOffsetY = 10
  c.fillText(g.glyph, 0, 8)
  c.restore()
}

function motif(c: CanvasRenderingContext2D, family: GameMeta['family'], rnd: () => number): void {
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    c.beginPath()
    c.moveTo(x0, y0)
    c.lineTo(x1, y1)
    c.stroke()
  }
  const dot = (x: number, y: number, r: number) => {
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fill()
  }
  switch (family) {
    case 'board': {
      const s = 64
      for (let x = s / 2; x < W; x += s) line(x, 0, x, H)
      for (let y = s / 2; y < H; y += s) line(0, y, W, y)
      break
    }
    case 'dice': {
      for (let i = 0; i < 7; i++) {
        const x = rnd() * W
        const y = rnd() * H
        c.save()
        c.translate(x, y)
        c.rotate(rnd() * Math.PI)
        c.beginPath()
        c.roundRect(-34, -34, 68, 68, 14)
        c.stroke()
        dot(0, 0, 7)
        c.restore()
      }
      break
    }
    case 'cards': {
      for (let i = 0; i < 4; i++) {
        c.save()
        c.translate(W * (0.15 + i * 0.25), H * (0.3 + rnd() * 0.4))
        c.rotate((rnd() - 0.5) * 0.9)
        c.beginPath()
        c.roundRect(-46, -66, 92, 132, 14)
        c.stroke()
        c.restore()
      }
      break
    }
    case 'puck': {
      line(0, H / 2, W, H / 2)
      c.beginPath()
      c.arc(W / 2, H / 2, 70, 0, Math.PI * 2)
      c.stroke()
      c.beginPath()
      c.arc(W / 2, -10, 90, 0, Math.PI)
      c.stroke()
      c.beginPath()
      c.arc(W / 2, H + 10, 90, Math.PI, Math.PI * 2)
      c.stroke()
      break
    }
    case 'aim': {
      const x = W * (0.2 + rnd() * 0.6)
      const y = H * (0.3 + rnd() * 0.4)
      for (let r = 40; r < 400; r += 50) {
        c.beginPath()
        c.arc(x, y, r, 0, Math.PI * 2)
        c.stroke()
      }
      break
    }
    case 'reflex': {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rnd() * 0.1
        c.beginPath()
        c.moveTo(W / 2, H / 2)
        c.arc(W / 2, H / 2, 400, a, a + 0.16)
        c.closePath()
        c.fill()
      }
      break
    }
    case 'arena': {
      const s = 52
      for (let y = 0; y < H; y += s)
        for (let x = (y / s) % 2 ? 0 : s; x < W; x += s * 2) c.fillRect(x, y, s, s)
      break
    }
    case 'runner': {
      for (let i = 0; i < 12; i++) {
        const y = rnd() * H
        const x = rnd() * W
        line(x, y, x + 80 + rnd() * 140, y)
      }
      break
    }
    case 'ragdoll': {
      for (let i = 0; i < 6; i++) {
        c.save()
        c.translate(W * (0.1 + rnd() * 0.8), H * (0.15 + rnd() * 0.75))
        c.rotate((rnd() - 0.5) * 1.2)
        c.beginPath()
        c.roundRect(-40, -22, 80, 44, 10)
        c.stroke()
        c.restore()
      }
      break
    }
    case 'puzzle': {
      const s = 58
      for (let y = 8; y < H; y += s)
        for (let x = 8; x < W; x += s) {
          c.beginPath()
          c.roundRect(x, y, s - 12, s - 12, 9)
          if (rnd() < 0.3) c.fill()
          else c.stroke()
        }
      break
    }
  }
}
