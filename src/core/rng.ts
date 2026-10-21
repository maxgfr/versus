/** Seeded PRNG (mulberry32). Same seed, same sequence, on every device. */
export class Rng {
  private a: number

  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) {
    this.a = seed >>> 0
  }

  /** Float in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = this.a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = items[i] as T
      items[i] = items[j] as T
      items[j] = t
    }
    return items
  }

  /** Independent stream derived from this one. */
  fork(): Rng {
    return new Rng((this.next() * 2 ** 32) >>> 0)
  }

  get state(): number {
    return this.a
  }

  set state(v: number) {
    this.a = v >>> 0
  }
}
