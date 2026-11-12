import { describe, expect, it } from 'vitest'
import { paceAt, paceStep } from './pace.ts'

describe('pace ramp', () => {
  const ramp = { max: 1.4, over: 100 }

  it('starts at 1, climbs steadily, then holds at its top', () => {
    expect(paceAt(0, ramp)).toBe(1)
    expect(paceAt(50, ramp)).toBeCloseTo(1.2, 9)
    expect(paceAt(100, ramp)).toBeCloseTo(1.4, 9)
    expect(paceAt(1000, ramp)).toBeCloseTo(1.4, 9)
    expect(paceAt(-5, ramp)).toBe(1)
  })

  it('counts its tenths, for the "Faster!" call', () => {
    expect(paceStep(1)).toBe(0)
    expect(paceStep(1.09)).toBe(0)
    expect(paceStep(1.1)).toBe(1)
    expect(paceStep(paceAt(100, ramp))).toBe(4)
  })
})
