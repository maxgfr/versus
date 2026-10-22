import { joinRoom, type JsonValue, type MessageAction, type Room } from 'trystero/nostr'
import { Relay } from './relay.ts'

/**
 * One link to the other phone. Signalling goes through public Nostr relays
 * (trystero); after the handshake, game traffic is a direct WebRTC data
 * channel. When no direct channel can be opened (or while it is still being
 * set up), messages go through the MQTT relay instead (see relay.ts).
 * Messages are tagged JSON: `send('snap', …)`, `on('snap', fn)`.
 */

const APP_ID = 'versus-2p-games-v1'

export type Role = 'host' | 'guest'

type Handler = (data: unknown) => void

export class Link {
  private room: Room | null = null
  private action: MessageAction<JsonValue> | null = null
  private relay: Relay
  private handlers = new Map<string, Set<Handler>>()
  /** The other phone over WebRTC. */
  peer: string | null = null
  /** Everyone in the room right now, so a friend who reloads is picked up again. */
  private present = new Set<string>()
  private watchers = new Set<(connected: boolean) => void>()
  private was = false
  /** Relay only: pointer moves waiting to go, the latest per finger. */
  private moves = new Map<string, unknown>()
  private flushTimer = 0

  constructor(
    readonly code: string,
    readonly role: Role,
  ) {
    const room = 'room-' + code.toLowerCase()
    this.relay = new Relay(
      room,
      () => this.changed(),
      (d) => this.dispatch(d),
    )
    try {
      this.room = joinRoom({ appId: APP_ID }, room)
    } catch {
      // No WebRTC here: the relay carries everything.
      return
    }
    this.action = this.room.makeAction<JsonValue>('m')
    this.action.onMessage = (data, ctx) => {
      if (this.peer === null) this.peer = ctx.peerId
      if (ctx.peerId !== this.peer) return
      this.dispatch(data)
    }
    this.room.onPeerJoin = (id) => {
      this.present.add(id)
      // Two phones per room: a third visitor is ignored.
      if (this.peer !== null && this.peer !== id) return
      this.peer = id
      this.changed()
    }
    this.room.onPeerLeave = (id) => {
      this.present.delete(id)
      if (id !== this.peer) return
      // A reloaded page rejoins under a new id, often before the old one times out.
      const next = this.present.values().next()
      this.peer = next.done ? null : next.value
      this.changed()
    }
  }

  get connected(): boolean {
    return this.peer !== null || this.relay.peer !== null
  }

  /** Connected, but only through the relay: keep traffic light. */
  get relayed(): boolean {
    return this.peer === null && this.relay.peer !== null
  }

  private changed(): void {
    const now = this.connected
    if (now === this.was) return
    this.was = now
    for (const w of this.watchers) w(now)
  }

  private dispatch(data: unknown): void {
    if (!Array.isArray(data)) return
    const [type, payload] = data as [string, unknown]
    const set = this.handlers.get(type)
    if (set) for (const h of set) h(payload)
  }

  /**
   * Send a message. On the relay, messages with a `coalesce` key (pointer
   * moves) are batched: only the latest per key goes, at most every 50 ms.
   */
  send(type: string, payload?: unknown, coalesce?: string): void {
    const msg = [type, (payload ?? null) as JsonValue] as JsonValue
    if (this.peer && this.action) {
      void this.action.send(msg, { target: this.peer }).catch(() => {
        // A dropped frame is fine: snapshots supersede each other.
      })
      return
    }
    if (!this.relay.peer) return
    if (coalesce) {
      this.moves.set(coalesce, msg)
      this.flushTimer ||= window.setTimeout(() => this.flush(), 50)
      return
    }
    // Keep the order: pending moves go before this message.
    this.flush()
    this.relay.message(msg)
  }

  private flush(): void {
    clearTimeout(this.flushTimer)
    this.flushTimer = 0
    for (const m of this.moves.values()) this.relay.message(m)
    this.moves.clear()
  }

  /** Connection status changes. Returns an unsubscribe function. */
  watch(fn: (connected: boolean) => void): () => void {
    this.watchers.add(fn)
    return () => this.watchers.delete(fn)
  }

  on(type: string, fn: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) this.handlers.set(type, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  }

  leave(): void {
    this.handlers.clear()
    this.watchers.clear()
    clearTimeout(this.flushTimer)
    this.relay.close()
    void this.room?.leave()
  }
}

/** 4 letters, no vowels-that-spell-words-by-accident ambiguity (no I/O/0/1). */
export function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  let s = ''
  const r = crypto.getRandomValues(new Uint8Array(4))
  for (const b of r) s += A[b % A.length]
  return s
}
