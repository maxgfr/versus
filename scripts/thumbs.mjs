// Card art: capture each game in action (computer vs computer) and save a
// small WebP under src/assets/thumbs/. Run against a dev or preview server:
//   BASE=http://localhost:5173/versus/ node scripts/thumbs.mjs [--force] [id ...]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { webkit } from '@playwright/test'

const base = process.env.BASE ?? 'http://localhost:4173/versus/'
const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))
const ids = readdirSync('src/games').filter(
  (id) => existsSync(`src/games/${id}/index.ts`) && (!only.length || only.includes(id)),
)
const out = 'src/assets/thumbs'
mkdirSync(out, { recursive: true })
mkdirSync('.thumbs-tmp', { recursive: true })

// Card art is 1 : 0.82. Default framing: the middle band of a phone-shaped
// stage. 'wide' framing: a square viewport, so the stage is letterboxed by the
// game's own backdrop and the frame shows most of the field.
// 'half': split-screen games, where each player owns a half: show red's
// half alone, upright and whole.
const FRAMES = {
  band: { w: 400, h: 720, at: 0.5 },
  wide: { w: 720, h: 760, at: 0.5 },
  half: { w: 400, h: 720, at: 0.75 },
}
// Default framing by family (read from the registry table).
const BY_FAMILY = { puzzle: 'half', runner: 'half' }
// Reflex games that give each player their own half.
const HALF = [
  'hammer-hit',
  'whack-a-mole',
  'fruit-duel',
  'money-grabber',
  'star-catcher',
  'lumber-jack',
  'rat-race',
  'disco-battle',
  'knife-thrower',
]
const registry = readFileSync('src/registry.ts', 'utf8')
const familyOf = (id) => {
  const before = registry.slice(0, registry.indexOf(`'${id}'`))
  return [...before.matchAll(/^ {2}([a-z]+): \[$/gm)].at(-1)?.[1]
}
// Per game: framing and when to grab the frame (ms of real time at 2x speed).
const PER = {
  'air-hockey': { frame: 'wide', wait: 4200 },
  'animal-stack': { frame: 'wide', wait: 6000 },
  'cannon-duel': { frame: 'wide', wait: 7000 },
  'find-match': { frame: 'wide', wait: 4000 },
  'reflex-race': { frame: 'wide', wait: 5000 },
  'sea-battle': { frame: 'wide', wait: 12000 },
  tanks: { frame: 'wide', wait: 4500 },
  'cup-pong': { frame: 'half', wait: 5000 },
  throw: { frame: 'wide', wait: 6000 },
  'target-practice': { frame: 'half', wait: 6000 },
  'archery-master': { frame: 'half', wait: 3000 },
  'beach-ball': { frame: 'wide', wait: 4000 },
  'brainrot-stack': { frame: 'wide', wait: 9000 },
  'crabby-volley': { frame: 'wide', wait: 4000 },
  'happy-hippos': { frame: 'wide', wait: 5000 },
  'penalty-kicks': { frame: 'wide', wait: 2600 },
  bowling: { frame: 'half', wait: 3600 },
  'water-game': { frame: 'half', wait: 4000 },
  'road-dodge': { frame: 'half', wait: 5000 },
  'spike-attacks': { frame: 'wide', wait: 2600 },
  stampede: { wait: 6400 },
}

const browser = await webkit.launch()
let done = 0
for (const id of ids) {
  const file = `${out}/${id}.webp`
  if (existsSync(file) && !force) continue
  const cfg = PER[id] ?? {}
  const { w, h, at } =
    FRAMES[
      cfg.frame ?? (HALF.includes(id) ? 'half' : undefined) ?? BY_FAMILY[familyOf(id)] ?? 'band'
    ]
  const png = `.thumbs-tmp/${id}.png`
  const ch = Math.round(w * 0.82)
  // A capture must show play, never the result screen: retry earlier if the game already ended.
  for (let wait = cfg.wait ?? 3200; wait >= 400; wait = Math.round(wait / 2)) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
    })
    const page = await ctx.newPage()
    await page.goto(`${base}#/play/${id}?demo&clean&speed=2`)
    await page.waitForSelector('.stage')
    await page.waitForTimeout(wait)
    const ended = await page.evaluate(() => document.body.dataset.result !== undefined)
    if (!ended)
      await page.screenshot({
        path: png,
        clip: { x: 0, y: Math.min(h - ch, Math.round(h * at - ch / 2)), width: w, height: ch },
      })
    await ctx.close()
    if (!ended) break
  }
  execFileSync('cwebp', ['-quiet', '-q', '72', '-resize', '480', '0', png, '-o', file])
  done++
  console.log(`thumb ${id}`)
}
await browser.close()
rmSync('.thumbs-tmp', { recursive: true, force: true })
console.log(`${done} captured, ${ids.length - done} kept`)
