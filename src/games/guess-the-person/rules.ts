import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure Guess the Person rules. Both boards show the same cast of 24 faces; each
 * side has a secret face among them. Asking a trait question tells the asker
 * the truth about the rival's secret, and the asker's impossible faces go down.
 * Guessing names the rival's face outright. Everything here is unit-tested.
 */

export const FACES = 24
export const COLS = 6
export const ROWS = 4

/** One face. Plain numbers and booleans, so it survives the online snapshot. */
export interface Face {
  /** 0 (lightest) .. 4 (darkest). */
  skin: number
  /** 0 bald, 1 short, 2 long, 3 curly. */
  hair: number
  /** 0 blond, 1 brown, 2 black, 3 red. Always 0 for a bald face. */
  colour: number
  /** 0 blue, 1 green, 2 brown. */
  eyes: number
  glasses: boolean
  hat: boolean
  beard: boolean
  smile: boolean
  /** 0..3, always 0 without a hat. */
  hatColour: number
}

export interface Question {
  id: string
  text: string
  test: (f: Face) => boolean
}

/** The fixed menu of trait questions. Each side may ask each one once. */
export const QUESTIONS: Question[] = [
  { id: 'glasses', text: 'Glasses?', test: (f) => f.glasses },
  { id: 'hat', text: 'Hat?', test: (f) => f.hat },
  { id: 'beard', text: 'Beard?', test: (f) => f.beard },
  { id: 'smile', text: 'Smiling?', test: (f) => f.smile },
  { id: 'blond', text: 'Blond?', test: (f) => f.hair !== 0 && f.colour === 0 },
  { id: 'red', text: 'Redhead?', test: (f) => f.hair !== 0 && f.colour === 3 },
  { id: 'black', text: 'Dark hair?', test: (f) => f.hair !== 0 && f.colour === 2 },
  { id: 'curly', text: 'Curly hair?', test: (f) => f.hair === 3 },
  { id: 'long', text: 'Long hair?', test: (f) => f.hair === 2 },
  { id: 'bald', text: 'Bald?', test: (f) => f.hair === 0 },
  { id: 'blue', text: 'Blue eyes?', test: (f) => f.eyes === 0 },
  { id: 'dark', text: 'Dark skin?', test: (f) => f.skin >= 3 },
]

export interface Round {
  faces: Face[]
  /** Each side's secret: an index into `faces`. The rival is the one who asks about it. */
  secret: [number, number]
  /** Per side, per face: ruled out on that side's own board. */
  down: [boolean[], boolean[]]
  /** Per side, per question: the answer it got, or null if not asked yet. */
  answers: [(boolean | null)[], (boolean | null)[]]
}

const other = (s: Side): Side => (s === 0 ? 1 : 0)

export function randomFace(rng: Rng): Face {
  const hair = rng.int(0, 3)
  const hat = rng.chance(0.25)
  return {
    skin: rng.int(0, 4),
    hair,
    colour: hair === 0 ? 0 : rng.int(0, 3),
    eyes: rng.int(0, 2),
    glasses: rng.chance(0.3),
    hat,
    beard: rng.chance(0.3),
    smile: rng.chance(0.5),
    hatColour: hat ? rng.int(0, 3) : 0,
  }
}

/** The answer to every question about `f`, as a string of 0s and 1s. */
export function signature(f: Face): string {
  return QUESTIONS.map((q) => (q.test(f) ? '1' : '0')).join('')
}

/**
 * 24 faces whose answers to all twelve questions are pairwise different, so
 * the full set of questions can always name any one of them.
 */
export function makeCast(rng: Rng): Face[] {
  const faces: Face[] = []
  const seen = new Set<string>()
  while (faces.length < FACES) {
    const f = randomFace(rng)
    const key = signature(f)
    if (seen.has(key)) continue
    seen.add(key)
    faces.push(f)
  }
  return faces
}

export function newRound(faces: Face[], secret: [number, number]): Round {
  const blank = () => Array.from({ length: FACES }, () => false)
  return {
    faces,
    secret,
    down: [blank(), blank()],
    answers: [QUESTIONS.map(() => null), QUESTIONS.map(() => null)],
  }
}

/** Faces `side` has not ruled out. */
export function candidates(r: Round, side: Side): number[] {
  const out: number[] = []
  for (let i = 0; i < r.faces.length; i++) if (!r.down[side][i]) out.push(i)
  return out
}

/** Questions `side` can still ask. */
export function open(r: Round, side: Side): number[] {
  const out: number[] = []
  for (let q = 0; q < QUESTIONS.length; q++) if (r.answers[side][q] === null) out.push(q)
  return out
}

export interface Answer {
  yes: boolean
  /** Faces the asker rules out now, in board order. */
  flipped: number[]
}

/**
 * `side` asks question `q` about the rival's secret. The answer is the truth;
 * the asker's candidates that cannot match it go down.
 */
export function ask(r: Round, side: Side, q: number): Answer {
  const question = QUESTIONS[q]
  if (!question) throw new Error(`No question ${q}`)
  if (r.answers[side][q] !== null) throw new Error(`Question ${q} already asked`)
  const yes = question.test(r.faces[r.secret[other(side)]] as Face)
  r.answers[side][q] = yes
  const flipped: number[] = []
  for (const i of candidates(r, side)) {
    if (question.test(r.faces[i] as Face) !== yes) {
      r.down[side][i] = true
      flipped.push(i)
    }
  }
  return { yes, flipped }
}

/** `side` names face `i` as the rival's secret. True when it is right. */
export function guess(r: Round, side: Side, i: number): boolean {
  return i === r.secret[other(side)]
}
