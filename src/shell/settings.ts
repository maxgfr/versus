import { audio } from '../core/audio.ts'
import type { Difficulty } from '../core/game.ts'
import { resetScores, save, store } from '../core/store.ts'
import { h, onTap } from './dom.ts'
import { icon } from './icons.ts'
import { ui } from './state.ts'

/** Bottom sheet; tap the backdrop or Done to close. */
export function sheet(
  parent: HTMLElement,
  title: string,
  body: Node[],
  onClose?: () => void,
): () => void {
  const close = () => {
    backdrop.remove()
    onClose?.()
  }
  const done = h('button.btn.ghost.tile', { style: { minHeight: '42px' } }, 'Done')
  onTap(done, close)
  const panel = h(
    'section.sheet',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-grip'),
    h('div.sheet-head', h('h2', title), done),
    ...body,
  )
  const backdrop = h('div.backdrop', panel)
  backdrop.addEventListener('pointerup', (e) => {
    if (e.target === backdrop) close()
  })
  parent.append(backdrop)
  return close
}

export function switchEl(
  on: boolean,
  label: string,
  change: (v: boolean) => void,
): HTMLButtonElement {
  const b = h('button.switch', { role: 'switch', 'aria-checked': String(on), 'aria-label': label })
  onTap(b, () => {
    const v = b.getAttribute('aria-checked') !== 'true'
    b.setAttribute('aria-checked', String(v))
    change(v)
  })
  return b
}

export function segmented<T extends string>(
  options: [T, string][],
  value: T,
  change: (v: T) => void,
  label: string,
): HTMLElement {
  const el = h('div.seg', { role: 'group', 'aria-label': label })
  const render = (v: T) =>
    el.replaceChildren(
      ...options.map(([id, text]) => {
        const b = h('button', { 'aria-pressed': String(id === v) }, text)
        onTap(b, () => {
          render(id)
          change(id)
        })
        return b
      }),
    )
  render(value)
  return el
}

export function openSettings(parent: HTMLElement, changed: () => void): void {
  const s = store.settings
  const nameField = (i: 0 | 1) => {
    const f = h('input.field', {
      value: s.names[i],
      maxlength: 12,
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
    })
    f.addEventListener('change', () => {
      const v = f.value.trim().slice(0, 12)
      s.names[i] = v || (i === 0 ? 'Red' : 'Blue')
      f.value = s.names[i]
      save()
    })
    return f
  }
  const reset = h(
    'button.btn.ghost.tile',
    { style: { minHeight: '44px', fontSize: '16px' } },
    icon('refresh'),
    'Reset',
  )
  onTap(reset, () => {
    resetScores()
    ui.shownScore = null
    reset.textContent = 'Done'
    reset.setAttribute('disabled', '')
  })
  sheet(
    parent,
    'Settings',
    [
      h(
        'div.names',
        h('label.red-l', 'Red player', nameField(0)),
        h('label.blue-l', 'Blue player', nameField(1)),
      ),
      h(
        'div.row',
        h('span', 'Sound'),
        switchEl(s.sound, 'Sound', (v) => {
          s.sound = v
          audio.enabled = v
          if (v) audio.play('pop')
          save()
        }),
      ),
      h(
        'div.row',
        h('span', 'Vibration', h('span.sub', 'Where the phone supports it')),
        switchEl(s.haptics, 'Vibration', (v) => {
          s.haptics = v
          save()
        }),
      ),
      h(
        'div.row',
        h('span', 'Computer'),
        segmented<Difficulty>(
          [
            ['easy', 'Easy'],
            ['normal', 'Normal'],
            ['hard', 'Hard'],
          ],
          s.difficulty,
          (v) => {
            s.difficulty = v
            save()
          },
          'Computer difficulty',
        ),
      ),
      h(
        'div.row',
        h('span', 'Scoreboard', h('span.sub', `Red ${store.score[0]} · Blue ${store.score[1]}`)),
        reset,
      ),
      h(
        'p.fine',
        'versus is free and works offline. No ads, no accounts, no tracking: scores and names stay on this phone. Online play connects the two phones directly. ',
        h(
          'a',
          { href: 'https://github.com/maxgfr/versus', target: '_blank', rel: 'noopener' },
          'Source code',
        ),
        ' · MIT licence · v',
        __APP_VERSION__,
      ),
    ],
    changed,
  )
}
