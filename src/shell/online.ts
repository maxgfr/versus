import { Link, newCode, type Role } from '../core/net/link.ts'
import { audio } from '../core/audio.ts'
import qrcode from 'qrcode-generator'
import { h, onTap } from './dom.ts'
import { icon } from './icons.ts'
import { go } from './router.ts'
import { ROOM_KEY, ui } from './state.ts'
import { toast } from './toast.ts'

/** Guests follow the host: when the host starts a round, jump into that game. */
let pending: { seed: number; target?: number } | undefined

export function takePending(): { seed: number; target?: number } | undefined {
  const p = pending
  pending = undefined
  return p
}

function remember(room: { code: string; role: Role } | null): void {
  try {
    if (room) sessionStorage.setItem(ROOM_KEY, JSON.stringify(room))
    else sessionStorage.removeItem(ROOM_KEY)
  } catch {
    // Private mode: a reload just leaves the room.
  }
}

/** Back into the room this tab was in (iOS often reloads Safari after the share sheet). */
export function rejoin(room: { code: string; role: Role }): void {
  if (/^[A-Z]{4}$/.test(room.code) && (room.role === 'host' || room.role === 'guest'))
    connect(room.code, room.role)
}

function connect(code: string, role: Role): Link {
  ui.link?.leave()
  const link = new Link(code, role)
  ui.link = link
  ui.mode = 'online'
  remember({ code, role })
  if (role === 'guest') {
    link.on('round', (d) => {
      const r = d as { id: string; seed: number; target?: number }
      // Whatever the home toggle says, the host's game is an online one.
      ui.mode = 'online'
      if (location.hash === `#/play/${r.id}`) return
      pending = r.target === undefined ? { seed: r.seed } : { seed: r.seed, target: r.target }
      go(`/play/${r.id}`)
    })
  }
  link.on('quit', () => {
    if (location.hash.startsWith('#/play/')) {
      go('/')
      toast('Your friend left the game.')
    }
  })
  link.watch((c) => {
    if (c) {
      audio.play('coin')
      toast(
        location.hash.startsWith('#/play/')
          ? 'Your friend is back.'
          : role === 'host'
            ? 'Friend connected! Pick a game.'
            : 'Connected! Your friend picks the game.',
      )
      if (location.hash.startsWith('#/online')) go('/')
    } else {
      toast('Your friend disconnected.')
    }
  })
  return link
}

export function leaveRoom(): void {
  ui.link?.leave()
  ui.link = null
  remember(null)
  if (ui.mode === 'online') ui.mode = '2p'
}

function inviteUrl(code: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/online/${code}`
}

function qrImage(text: string): HTMLImageElement {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return h('img', { src: q.createDataURL(6, 0), alt: 'QR code to join this room' })
}

export function lobby(root: HTMLElement, code: string): () => void {
  const page = h('div.screen.page')
  root.append(page)
  const back = h('button.icon-btn.tile', { 'aria-label': 'Back' }, icon('back'))
  onTap(back, () => go('/'))
  const head = h('header.page-head', back, h('h1', 'Play online'))
  const body = h('div')
  page.append(head, body)

  if (code && !(ui.link && ui.link.code === code.toUpperCase())) {
    connect(code.toUpperCase(), 'guest')
  }

  const render = () => {
    const link = ui.link
    if (!link) {
      const create = h('button.btn.big.tile.live', { style: { width: '100%' } }, 'Create a room')
      onTap(create, () => {
        audio.unlock()
        connect(newCode(), 'host')
        render()
      })
      const field = h('input.field.code-input', {
        maxlength: 4,
        placeholder: 'CODE',
        autocomplete: 'off',
        autocapitalize: 'characters',
        spellcheck: 'false',
        inputmode: 'text',
        enterkeyhint: 'go',
        'aria-label': 'Room code',
      })
      const join = h(
        'button.btn.big.tile.blue',
        { style: { width: '100%', marginTop: '12px' } },
        'Join',
      )
      const doJoin = () => {
        const v = field.value.trim().toUpperCase()
        if (!/^[A-Z]{4}$/.test(v)) {
          toast('Room codes are 4 letters.')
          return
        }
        audio.unlock()
        connect(v, 'guest')
        render()
      }
      onTap(join, () => void doJoin())
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void doJoin()
      })
      body.replaceChildren(
        h(
          'section.panel',
          h('h2', 'Host'),
          h(
            'p',
            'Create a room and send the code to your friend. You play Red and pick the games.',
          ),
          create,
        ),
        h(
          'section.panel',
          h('h2', 'Join'),
          h('p', 'Got a code from a friend? Type it here. You play Blue.'),
          field,
          join,
        ),
        h(
          'p.fine',
          'The two phones connect directly when they can; otherwise moves pass through a public relay. Nothing is stored anywhere.',
        ),
      )
      return
    }
    const status = link.connected
      ? h('p.status', icon('check'), 'Connected')
      : h(
          'p.status',
          h('span.spinner'),
          link.role === 'host' ? 'Waiting for your friend…' : 'Looking for the room…',
        )
    const share = h('button.btn.tile.live', icon('share'), 'Send invite')
    onTap(share, async () => {
      const url = inviteUrl(link.code)
      try {
        if (navigator.share)
          await navigator.share({
            title: 'Play versus with me',
            text: `Join my versus room: ${link.code}`,
            url,
          })
        else {
          await navigator.clipboard.writeText(url)
          toast('Invite link copied.')
        }
      } catch {
        // Share sheet dismissed.
      }
    })
    const leave = h('button.btn.tile.ghost', icon('close'), 'Leave room')
    onTap(leave, () => {
      leaveRoom()
      render()
    })
    const games = h('button.btn.tile.blue', 'Go to games')
    onTap(games, () => go('/'))
    body.replaceChildren(
      h(
        'section.panel',
        { style: { textAlign: 'center' } },
        h('h2', link.role === 'host' ? 'Your room' : 'Joining room'),
        h('div.code', ...[...link.code].map((ch) => h('span', ch))),
        link.role === 'host' && !link.connected ? h('div.qr', qrImage(inviteUrl(link.code))) : null,
        status,
      ),
      h('div.actions', link.role === 'host' && !link.connected ? share : games, leave),
    )
  }
  render()
  const unwatch = ui.link?.watch(() => render())
  return () => unwatch?.()
}
