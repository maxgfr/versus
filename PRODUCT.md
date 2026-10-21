# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vanilla TypeScript + CSS shell, one shared Canvas 2D renderer for every game, Vite 8, vite-plugin-pwa. Hosted on GitHub Pages at `https://maxgfr.github.io/versus/`. No UI framework.

## Users

Everyone, all ages: families, friends, couples, siblings — two people sitting across from each other with one phone between them (a café table, a train tray, a sofa, a waiting room). Secondary: one person alone playing the computer, or two people on two phones playing online.

## Product Purpose

A free arcade of ~114 short two-player mini-games played face to face on one phone. Pick a game, both tap ready, play a round in under two minutes, rematch or switch. Success is "one more game": low friction from launch to play, rules understood in one glance, and a running red-vs-blue score that keeps the rivalry going across games.

## Positioning

Free, offline, installable, no ads, no accounts, no tracking — the thing every comparable app store title is not. Original game names and art (no trademarked names, no ripped assets).

## Operating Context

- The phone lies flat on a table. Red plays from the bottom edge, blue from the top edge; the top half is rendered upside down so each player reads their own side.
- Both players touch the screen at the same time (multi-touch is core).
- Sessions are short and social; people talk, laugh, glance away. Sound is often on but may be off.
- iPhone Safari / home-screen install is the primary target; Android Chrome and desktop are supported.
- Modes: 2P on one phone, 1P vs computer (easy/normal/hard), online P2P with a 4-letter room code or link (host-authoritative, WebRTC via Nostr signalling), 2 vs 2 on one phone for some games, tournaments of 3/5/7 random games.

## Capabilities and Constraints

- Works fully offline once loaded (every game chunk is precached).
- Only outbound traffic is online play signalling (Nostr relays) and WebRTC.
- Portrait only; landscape shows a "rotate your phone" screen.
- Language: English only.
- Performance budget: home < 300 KB gzipped, each game chunk < 50 KB gzipped excluding shared libraries.

## Brand Commitments

- Name: **versus** (lowercase).
- Never ads, accounts, analytics or tracking. Not now, not later.
- All game names and visuals are original; no third-party trademarks.
- Red = bottom player, blue = top player, everywhere.
- MIT licensed.

## Evidence on Hand

No testimonials, ratings, user counts or press exist. Do not fabricate any.

## Product Principles

1. Table first: every screen works for two people reading from opposite edges.
2. Zero friction to the first tap: no sign-up, no tutorial walls, rules in one to three sentences.
3. Fair and readable: both players always know whose side is whose and who is winning.
4. Every hit feels good: games are short, so feedback (sound, motion, particles) carries the fun.
5. Respect the player: offline, private, free, no dark patterns.

## Accessibility & Inclusion

- Kid-safe content and wording an 8-year-old can read; no fail-shaming.
- Side identity never relies on colour alone (red = circle, blue = square marks).
- Touch targets ≥ 44 pt; `prefers-reduced-motion` reduces shake, flashes and particle counts.
