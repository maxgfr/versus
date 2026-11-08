import type { Draw } from '../../core/render/draw.ts'
import { OPT, PANEL, type OptionLabel } from '../math-quiz/render.ts'
import { COUNTRIES } from './countries.ts'

/** The scoreboard is taller than Math Quiz's: a flag needs the room to be told from its lookalike. */
export const FLAG_PANEL = { ...PANEL, h2p: 540, h1p: 400 }
export const FLAG_GAP = 134
const FLAG_SIZE = { shared: 260, alone: 340 }

const NAME_WIDTH = OPT.w - 56
const NAME_SIZES = [64, 58, 52, 46, 40] as const
const MAX_LINES = 3

/** Words packed into as few lines as fit `width`, or null if a single word is too wide. */
function wrap(g: Draw, name: string, size: number, width: number): string[] | null {
  const lines: string[] = []
  for (const word of name.split(' ')) {
    if (g.measure(word, size, 700) > width) return null
    const last = lines[lines.length - 1]
    if (last !== undefined && g.measure(`${last} ${word}`, size, 700) <= width)
      lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

/** A country name on its button, on up to three lines at the largest size that fits. */
export const nameLabel: OptionLabel = (g, v, color, drop) => {
  const name = COUNTRIES[v]?.name ?? ''
  let size: number = NAME_SIZES[NAME_SIZES.length - 1] ?? 40
  let lines = [name]
  for (const s of NAME_SIZES) {
    const fit = wrap(g, name, s, NAME_WIDTH)
    if (fit && fit.length <= MAX_LINES) {
      size = s
      lines = fit
      break
    }
  }
  const lead = size * 1.08
  lines.forEach((line, i) =>
    g.text(line, 0, (i - (lines.length - 1) / 2) * lead, {
      size,
      weight: 700,
      color,
      drop,
      maxWidth: NAME_WIDTH,
    }),
  )
}

export function drawFlag(g: Draw, country: number): void {
  g.emoji(COUNTRIES[country]?.flag ?? '', 0, 0, g.flipTop ? FLAG_SIZE.shared : FLAG_SIZE.alone)
}
