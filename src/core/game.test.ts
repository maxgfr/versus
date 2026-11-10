import { describe, expect, it } from 'vitest'
import { type OptionSpec, optionValues } from './game.ts'

const SPECS: OptionSpec[] = [
  {
    id: 'lang',
    label: 'Language',
    choices: [
      ['fr', 'Français'],
      ['en', 'English'],
    ],
    default: 'fr',
  },
  {
    id: 'words',
    label: 'Words',
    choices: [
      ['on', 'On'],
      ['off', 'Off'],
    ],
    default: 'on',
  },
]

describe('optionValues', () => {
  it('keeps saved choices that are still offered, defaults the rest', () => {
    expect(optionValues(SPECS)).toEqual({ lang: 'fr', words: 'on' })
    expect(optionValues(SPECS, { lang: 'en' })).toEqual({ lang: 'en', words: 'on' })
    expect(optionValues(SPECS, { lang: 'de', words: 'off', gone: 'x' })).toEqual({
      lang: 'fr',
      words: 'off',
    })
  })
})
