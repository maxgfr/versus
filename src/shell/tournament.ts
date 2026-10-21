import type { Result } from '../core/game.ts'
import { store } from '../core/store.ts'
import { builtGames, loadGame, type GameMeta } from '../registry.ts'
import { h, onTap } from './dom.ts'
import { icon } from './icons.ts'
import { go } from './router.ts'
import { digits } from './scoreboard.ts'
import { Session } from './session.ts'
import { segmented } from './settings.ts'

interface Cup {
  games: GameMeta[]
  results: (Result['winner'] | null)[]
  at: number
}

let cup: Cup | null = null

/** A spread of families first, then anything: a tournament should feel varied. */
function draw(n: number): GameMeta[] {
  const pool = builtGames().sort(() => Math.random() - 0.5)
  const out: GameMeta[] = []
  const fams = new Set<string>()
  for (const g of pool) {
    if (out.length < n && !fams.has(g.family)) {
      out.push(g)
      fams.add(g.family)
    }
  }
  for (const g of pool) if (out.length < n && !out.includes(g)) out.push(g)
  return out
}

function tally(c: Cup): [number, number] {
  return [c.results.filter((r) => r === 0).length, c.results.filter((r) => r === 1).length]
}

export function tournament(root: HTMLElement): () => void {
  const page = h('div.screen.page')
  root.append(page)
  let session: Session | null = null
  let length = 5

  const render = () => {
    session?.destroy()
    session = null
    const back = h('button.icon-btn.tile', { 'aria-label': 'Back' }, icon('back'))
    onTap(back, () => {
      cup = null
      go('/')
    })
    const [rn, bn] = store.settings.names
    if (!cup) {
      const start = h(
        'button.btn.big.tile.live',
        { style: { width: '100%' } },
        icon('trophy'),
        'Start',
      )
      onTap(start, () => {
        cup = { games: draw(length), results: [], at: 0 }
        render()
      })
      page.replaceChildren(
        h('header.page-head', back, h('h1', 'Tournament')),
        h(
          'section.panel',
          h('h2', 'Random games, one champion'),
          h('p', `${rn} and ${bn} play a run of random games. Most wins takes the cup.`),
          h(
            'div.row',
            h('span', 'Games'),
            segmented(
              [
                ['3', '3'],
                ['5', '5'],
                ['7', '7'],
              ],
              String(length) as '5',
              (v) => (length = Number(v)),
              'Number of games',
            ),
          ),
        ),
        start,
      )
      return
    }
    const c = cup
    const [r, b] = tally(c)
    const done = c.at >= c.games.length || r > c.games.length / 2 || b > c.games.length / 2
    const list = h(
      'ol.t-list',
      ...c.games.map((g, i) =>
        h(
          `li${i === c.at && !done ? '.now' : ''}`,
          h('span.g', { 'aria-hidden': 'true' }, g.glyph),
          h('span.grow', g.name),
          c.results[i] === undefined
            ? null
            : h(
                `span.w.${c.results[i] === 'draw' ? 'draw' : c.results[i] === 0 ? 'red' : 'blue'}`,
                {
                  'aria-label':
                    c.results[i] === 'draw'
                      ? 'Draw'
                      : c.results[i] === 0
                        ? `${rn} won`
                        : `${bn} won`,
                },
              ),
        ),
      ),
    )
    const standings = h(
      'div.t-standings',
      h('div.t-team.red', h('div', rn), digits(r)),
      h('div.t-team.blue', h('div', bn), digits(b)),
    )
    if (done) {
      const winner = r === b ? null : r > b ? rn : bn
      const again = h('button.btn.big.tile.live', { style: { width: '100%' } }, 'New tournament')
      onTap(again, () => {
        cup = null
        render()
      })
      page.replaceChildren(
        h('header.page-head', back, h('h1', 'Tournament')),
        h(
          'div.podium',
          icon('trophy'),
          h(
            'h2.result-title',
            { style: { fontSize: '44px' } },
            winner ? `${winner} takes the cup!` : 'A tie!',
          ),
        ),
        standings,
        list,
        again,
      )
      return
    }
    const next = h(
      'button.btn.big.tile.live',
      { style: { width: '100%' } },
      icon('play'),
      `Play ${c.games[c.at]?.name ?? ''}`,
    )
    onTap(next, () => void play())
    page.replaceChildren(
      h('header.page-head', back, h('h1', `Game ${c.at + 1} of ${c.games.length}`)),
      standings,
      list,
      next,
    )
  }

  const play = async () => {
    const c = cup
    const meta = c?.games[c.at]
    if (!c || !meta) return
    const factory = await loadGame(meta.id)
    page.replaceChildren()
    session = new Session(page, {
      meta,
      factory,
      mode: '2p',
      link: null,
      banner: `Game ${c.at + 1} of ${c.games.length}`,
      onExit: () => render(),
      onResult: (res) => {
        c.results[c.at] = res.winner
      },
      onNext: () => {
        c.at++
        render()
      },
    })
  }

  render()
  return () => session?.destroy()
}
