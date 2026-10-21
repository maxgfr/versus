# Writing a game for versus

Every game is a folder `src/games/<id>/` whose `<id>` matches an entry in `src/registry.ts`. The folder's existence (with an `index.ts`) is what makes the game appear on the home screen — no registry edit is needed.

## The table

The phone lies flat between two players. The world is a fixed **1000 × 1800** portrait stage:

- **Red = side 0** sits at the **bottom** (`y` near 1800). **Blue = side 1** sits at the **top** (`y` near 0). `MID = 900`.
- In local 2P the top half is read upside down: anything blue must read is drawn rotated with `g.forSide(1, …)`, `g.sideText(1, …)` or `g.orient(1)`. Never hard-code `Math.PI`; `orient` also handles 1P (nothing flipped) and the online guest (whole view rotated).
- The visible area can be larger than the stage (letterbox): paint backdrops with `g.fillView(...)` and place edge HUD with `hudY(g, side)` / `g.stage.edge(side)` (safe-area aware).
- Per-player panels (each player's own board, tray, keypad…): write the layout once as red sees it and place it for blue with `src/core/frame.ts` (`frame`, `toLocal`, `inFrame`, `textAngle`). Positions stay identical on every device; only text turns to face its reader.
- Keep tap targets away from the pause button (left edge, mid-height: world x < 110 around y 800–1000).
- Red is a **circle**, blue is a **square** wherever a marker distinguishes them (`g.sideMark`). Never rely on colour alone.

## Files

| File               | Purpose                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`         | The `Game`: `export default () => new MyGame()`. Extends `BaseGame<State>` (or an engine base such as `TurnGame`). Wires input, bots, fx, sound, calls `this.finish(...)`. |
| `rules.ts`         | Pure logic: no DOM, no canvas, no `Math.random` (take an `Rng`). Everything testable.                                                                                      |
| `bot.ts`           | The computer player, `easy` / `normal` / `hard`. Must be able to play **either side** (tests run computer vs computer).                                                    |
| `render.ts`        | Drawing helpers for this game (pure functions of state + time).                                                                                                            |
| `rules.test.ts`    | Vitest: rules edge cases + a bot-vs-bot run that reaches a result in bounded steps.                                                                                        |
| `ai.ts` (optional) | Heavy search run in a Web Worker via `think()` from `engines/board`. Exports `choose(state, difficulty, seed)`.                                                            |

## The contract (see `src/core/game.ts`)

- `setup()` returns the initial state. Keep **all** game state in `this.s`, as plain JSON (numbers, strings, arrays, plain objects). The online host streams `snapshot()` (which is `this.s`) to the guest; no class instances, Maps or functions in `this.s`.
- `step(dt)` runs at a fixed 60 Hz. Use `this.time` (seconds) for timers and animations stamped in state (e.g. `placedAt: this.time`). Never use `Date.now()` / `performance.now()`.
- `render(g, alpha)` draws from state only. It must not change `this.s` (the guest only renders).
- **Match length is the players' choice.** Export a spec from `index.ts`: `export const match: MatchSpec = { unit: 'wins' | 'points' | 'seconds' | 'rounds', default, min, max, step? }` (e.g. first to 3 round wins 1–9, first to 7 points 3–21, 45 seconds 15–180 step 15, 5 rounds 1–10). The ready screen shows a − / + stepper; read the chosen value as `this.ctx.target || match.default` and use it everywhere the old constant was (end condition, pips, clock, HUD). Never hard-code the match length.
- End the game with `this.finish(winner, { score?, note?, delay? })` — `winner` is `0`, `1` or `'draw'`. The shell shows the result screen after `delay` (default 1.4 s); `afterEnd(dt)` keeps animating meanwhile.
- `this.ctx` gives: `input`, `fx`, `audio`, `rng` (seeded — use it for anything that affects play), `mode` (`'1p' | '2p' | 'online'`), `difficulty`, `bots` (`[bool, bool]`), `teams` (2 vs 2), `names`, `local`, `seed`, `stage`.

## Input

`this.ctx.input.player(side)` is a `PlayerInput` with world-space pointers:

- `downs` (pressed this step), `ups` (released this step), `held` (Map of active pointers), helpers `tapped(lane?)`, `pressedIn(x,y,w,h)`, `pressedNear(x,y,r)`, `first(lane?)`.
- Local 2P routes touches by half (bottom → red, top → blue). Set `this.ctx.input.assign = (x, y) => side | null` to override (board games route the whole shared board to the player whose turn it is — `TurnGame.turnTap()` already does this).
- 1P: every human touch is red's. Online: every local touch is that device's side.
- 2 vs 2 (`ctx.teams`): each pointer has `lane` 0 (left) or 1 (right) fixed at press time.

Widgets in `src/core/controls.ts` (`Joystick`, `Button`, `DragAim`, `TapZone`) read a `PlayerInput` in `update(input)` and expose a value. **Bots drive the same widgets** (`joystick.set(x, y)`, `button.press()`, `aim.fire(dx, dy, power)`, `zone.tap()`), so game code never cares who is playing. In `step`, for each side: `if (this.isBot(side)) bot.drive(...) else widget.update(input)`.

## Look and feel

The direction is **Night Match Scoreboard**: a floodlit dark table, chunky glossy toy pieces, team colours owning whole regions.

- Palette: `C` and `SIDE` from `src/core/render/palette.ts`; `shade`, `alpha`, `mix` for variants. Yellow (`C.yellow`) marks the one active thing.
- Draw kit (`src/core/render/draw.ts`): `tile` (raised lipped block), `ball`, `disc`, `blob` (the mascot cast, with moods and squash), `emoji` (cached colour glyphs: fruit, animals, objects), `shadow`, `rrect`, `circle`, `line`, `poly`, `star`, `lin`/`rad` gradients, `text` / `sideText` / `both`.
- HUD kit (`src/core/hud.ts`): `namePill` (glows on your turn), `pips` (rounds won), `bigScore`, `clock`, `banner`.
- Juice is mandatory: every hit, score and win has feedback. `fx.burst`, `fx.sparks`, `fx.puff`, `fx.shake`, `fx.stop` (hit-stop), `fx.flash`, `fx.ring`, `fx.float(text, x, y, color, size, side)`, `fx.confetti(side)`, `floatFor(fx, side, '+1')`. Squash & stretch with `Spring` from `core/fx/ease.ts`.
- Sounds (`ctx.audio.play(name, pitch?)`): tap, click, pop, place, hit, bounce, wall, thud, score, coin, win, lose, draw, count, go, explode, shoot, whoosh, swish, splash, zap, boing, error, flip, roll, slide, tick, chomp, powerup, slap, buzz.
- Text is Fredoka; size ≥ 34 world units for anything a player must read (the world is ~2.5× CSS px on a phone).
- No trademarked names, characters or ripped assets. Emoji and procedural shapes only.

## Engines

Pick the engine of your family and copy its reference game. Each engine's `index.ts` starts with a how-to.

| Engine  | Folder                | Reference game  |
| ------- | --------------------- | --------------- |
| board   | `src/engines/board`   | `tic-tac-toe`   |
| dice    | `src/engines/dice`    | `yazy`          |
| cards   | `src/engines/cards`   | `memory`        |
| puck    | `src/engines/puck`    | `air-hockey`    |
| aim     | `src/engines/aim`     | `cannon-duel`   |
| reflex  | `src/engines/reflex`  | `pull-the-rope` |
| arena   | `src/engines/arena`   | `tanks`         |
| runner  | `src/engines/runner`  | `happy-birds`   |
| ragdoll | `src/engines/ragdoll` | `animal-stack`  |
| puzzle  | `src/engines/puzzle`  | `sudoku`        |

## Checks

```sh
pnpm exec tsc -p tsconfig.app.json --noEmit 2>&1 | grep src/games/<id>   # must print nothing
pnpm exec vitest run src/games/<id>
pnpm exec oxlint src/games/<id>
pnpm exec prettier --write src/games/<id>
# run your own dev server on a free port (each agent its own), then:
pnpm exec vite --port <port> --strictPort &
# computer vs computer at 8x, must reach the result screen without console errors:
BASE=http://localhost:<port>/versus/ GAMES=<id> pnpm exec playwright test e2e/games.spec.ts
# look at it (iPhone 15 viewport, 393 x 659 CSS px) — and actually open the PNGs:
BASE=http://localhost:<port>/versus/ node scripts/shot.mjs '/play/<id>' .impeccable/review/<id>.png --tap 196,580 --tap 196,80 --wait 4000
BASE=http://localhost:<port>/versus/ node scripts/shot.mjs '/play/<id>?demo&speed=2' .impeccable/review/<id>-demo.png --wait 6000
```
