# Credits

versus is MIT licensed. Every game, rule set, name and picture in it is original: there are no third-party characters, trademarks or ripped assets.

## Art and sound

- **Pictures** are drawn in code at run time (shapes, gradients, the blob cast) plus the device's own colour emoji. The card images in `src/assets/thumbs/` are captures of the games themselves, produced by `scripts/thumbs.mjs`.
- **Sounds** are synthesised in the browser by `src/core/audio.ts`; there are no audio files.

## Font

- [Fredoka](https://github.com/hafontia/Fredoka-One) by The Fredoka Project Authors, SIL Open Font License 1.1, via [@fontsource-variable/fredoka](https://fontsource.org/fonts/fredoka). Self-hosted.
- Twemoji Country Flags, a subset of [Twemoji](https://github.com/twitter/twemoji) reduced to the flags, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), via [country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill). Self-hosted, and only loaded by Flag Quiz on systems without flag emoji (Windows).

## Libraries shipped in the app

| Library                                                                              | Used for                                                | License      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------ |
| [matter-js](https://github.com/liabru/matter-js)                                     | stacking and floppy-physics games (loaded only by them) | MIT          |
| [chess.js](https://github.com/jhlywa/chess.js)                                       | chess move legality                                     | BSD-2-Clause |
| [trystero](https://github.com/dmotz/trystero)                                        | peer-to-peer online play (Nostr signalling, WebRTC)     | MIT          |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)                | room invite QR codes                                    | MIT          |
| [workbox](https://github.com/GoogleChrome/workbox) via vite-plugin-pwa               | offline cache                                           | MIT          |
| [country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill) | flag emoji on Windows (Flag Quiz)                       | MIT          |

## Services

- Public [Nostr](https://nostr.com) relays help the two phones find each other for online play.
- Public MQTT brokers ([EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker), [HiveMQ](https://www.hivemq.com/mqtt/public-mqtt-broker/)) carry the moves when no direct connection is possible.

## Tools

Vite, TypeScript, Vitest, Playwright, oxlint, Prettier, @vite-pwa/assets-generator.
