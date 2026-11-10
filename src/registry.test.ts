import { describe, expect, it } from 'vitest'
import { findGame, GAMES, matches } from './registry.ts'

const game = (id: string) => {
  const g = findGame(id)
  if (!g) throw new Error(`no ${id}`)
  return g
}

describe('matches', () => {
  it('finds a game by part of its name, whatever the case', () => {
    expect(matches(game('chess'), 'CHE')).toBe(true)
    expect(matches(game('chess'), 'pong')).toBe(false)
  })

  it('needs every word, in any order', () => {
    expect(matches(game('ultimate-tic-tac-toe'), 'toe ultimate')).toBe(true)
    expect(matches(game('tic-tac-toe'), 'toe ultimate')).toBe(false)
  })

  it('also finds a game by its family and ignores accents and spaces', () => {
    expect(matches(game('air-hockey'), ' ball ')).toBe(true)
    expect(matches(game('chess'), 'bóard')).toBe(true)
  })

  it('lets every game through an empty search', () => {
    expect(GAMES.every((g) => matches(g, '  '))).toBe(true)
  })
})
