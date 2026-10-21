// Review helper: tile the card captures into one image (6 per row).
//   node scripts/contact-sheet.mjs out.png [id ...]
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const [out = 'sheet.png', ...only] = process.argv.slice(2)
const files = readdirSync('src/assets/thumbs')
  .filter((f) => f.endsWith('.webp') && (!only.length || only.includes(f.replace('.webp', ''))))
  .sort()
const cols = 6
const inputs = files.flatMap((f) => ['-i', `src/assets/thumbs/${f}`])
const n = files.length
const pad = Math.ceil(n / cols) * cols - n
const scale = files.map((f, i) => `[${i}:v]scale=240:197[v${i}]`)
const blanks = Array.from({ length: pad }, (_, i) => `color=c=black:s=240x197[b${i}]`)
const cells = [
  ...files.map((_, i) => `[v${i}]`),
  ...Array.from({ length: pad }, (_, i) => `[b${i}]`),
]
const layout = cells.map((_, i) => `${(i % cols) * 240}_${Math.floor(i / cols) * 197}`).join('|')
const graph = [
  ...scale,
  ...blanks,
  `${cells.join('')}xstack=inputs=${cells.length}:layout=${layout}[out]`,
].join(';')
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  ...inputs,
  '-filter_complex',
  graph,
  '-map',
  '[out]',
  '-frames:v',
  '1',
  out,
])
console.log(
  `${n} captures → ${out}, row by row:\n${files.map((f) => f.replace('.webp', '')).join(' ')}`,
)
