/**
 * Exact dice odds for five-dice hold decisions, shared by the Yazy games' bots.
 * Hands and keeps are multisets (face counts), so there are only 252 hands and
 * 462 keeps: every expectation is computed once and memoised.
 */

/** A hand or a keep as counts of faces 1..6. */
export type Counts = number[]

const keyOf = (c: Counts): number => c.reduce((k, n) => k * 6 + n, 0)
const toDice = (c: Counts): number[] => c.flatMap((n, f) => Array<number>(n).fill(f + 1))

export const countsOf = (dice: readonly number[]): Counts => {
  const c = [0, 0, 0, 0, 0, 0]
  for (const v of dice) c[v - 1] = (c[v - 1] ?? 0) + 1
  return c
}

/** Every multiset of `r` dice (0..5) with its probability. */
const OUTCOMES: { c: Counts; p: number }[][] = []
{
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1))
  for (let r = 0; r <= 5; r++) {
    const out: { c: Counts; p: number }[] = []
    const walk = (face: number, left: number, c: Counts) => {
      if (face === 5) {
        const full = [...c, left]
        const ways = fact(r) / full.reduce((a, n) => a * fact(n), 1)
        out.push({ c: full, p: ways / 6 ** r })
        return
      }
      for (let n = 0; n <= left; n++) walk(face + 1, left - n, [...c, n])
    }
    walk(0, r, [])
    OUTCOMES.push(out)
  }
}

/** Every sub-multiset of a hand (including empty and the whole hand). */
function subKeeps(c: Counts): Counts[] {
  const out: Counts[] = []
  const walk = (i: number, cur: Counts) => {
    if (i === 6) {
      out.push(cur)
      return
    }
    for (let n = 0; n <= (c[i] ?? 0); n++) walk(i + 1, [...cur, n])
  }
  walk(0, [])
  return out
}

/**
 * Expected values over rerolls for one decision. `stand(dice)` is the value of
 * scoring a final hand. `keep(k, level)` is the expectation after rolling the
 * dice not in keep `k`, then (level 1) playing one more reroll perfectly.
 */
export class Odds {
  private v0m = new Map<number, number>()
  private v1m = new Map<number, number>()
  private keepM = [new Map<number, number>(), new Map<number, number>()]

  constructor(private stand: (dice: readonly number[]) => number) {}

  v0(c: Counts): number {
    const k = keyOf(c)
    let v = this.v0m.get(k)
    if (v === undefined) {
      v = this.stand(toDice(c))
      this.v0m.set(k, v)
    }
    return v
  }

  keep(keep: Counts, level: 0 | 1): number {
    const k = keyOf(keep)
    const m = this.keepM[level] as Map<number, number>
    let v = m.get(k)
    if (v !== undefined) return v
    const r = 5 - keep.reduce((a, n) => a + n, 0)
    v = 0
    for (const o of OUTCOMES[r] ?? []) {
      const hand = keep.map((n, i) => n + (o.c[i] ?? 0))
      v += o.p * (level === 0 ? this.v0(hand) : this.v1(hand))
    }
    m.set(k, v)
    return v
  }

  /** Best value of a hand with one reroll left: stand, or the best keep. */
  v1(c: Counts): number {
    const k = keyOf(c)
    let v = this.v1m.get(k)
    if (v !== undefined) return v
    v = this.v0(c)
    for (const sub of subKeeps(c)) v = Math.max(v, this.keep(sub, 0))
    this.v1m.set(k, v)
    return v
  }
}

/**
 * Best dice to hold before rerolling, with `rerolls` (1 or 2) left, by exact
 * expectation. Holding everything (standing) is never returned: compare `ev`
 * with the value of scoring now.
 */
export function bestHold(
  dice: readonly number[],
  stand: (dice: readonly number[]) => number,
  rerolls: 1 | 2,
): { held: boolean[]; ev: number } {
  const odds = new Odds(stand)
  const level = rerolls === 2 ? 1 : 0
  let best = { held: dice.map(() => true), ev: -Infinity }
  for (let m = 0; m < (1 << dice.length) - 1; m++) {
    const held = dice.map((_, i) => !!(m & (1 << i)))
    const ev = odds.keep(countsOf(dice.filter((_, i) => held[i])), level)
    if (ev > best.ev + 1e-9) best = { held, ev }
  }
  return best
}
