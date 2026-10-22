# versus

Two-player mini-games for one phone, played face to face: put the phone flat on the table, red plays from the bottom, blue from the top. Also against the computer, or online between two phones.

**Play now: https://maxgfr.github.io/versus/** — then _Share → Add to Home Screen_ to install it. It works offline.

- 114 original mini-games: board classics, dice, cards and quizzes, ball games, aiming, reflex duels, arena battles, runners, physics and puzzle races.
- **2P on one phone** with the top half upside down, **1P against the computer** (easy, normal, hard), **online** with a 4-letter room code, link or QR, and **2 vs 2** on one phone for some games.
- Choose the match length before each game (rounds to win, points, duration), keep a red-vs-blue scoreboard across games, run **tournaments** of 3, 5 or 7 random games.
- Free, no ads, no accounts, no tracking. Scores and names stay on your phone.

## Games

<!-- games:start -->

114 games, all playable two players on one phone.

**Board** (11): ❌ Tic Tac Toe · 🔲 Ultimate Tic Tac Toe · 🔴 4 in a Row · ♟️ Chess · 🏁 Checkers · ⚪ Reversi · 🫘 Mancala · ✏️ Dots and Boxes · 🚢 Sea Battle · 🎨 Color Wars · 🫧 Pop It

**Dice** (6): 🎲 Backgammon · 🐎 Ludo · 🪜 Snakes & Ladders · 💯 Yazy · 📋 Yazy Classic · 📦 Shut the Box

**Cards & quiz** (7): 🕵️ Guess the Person · 🃏 Triple · 🧠 Memory · 🍕 Pizza Memory · ➗ Math Quiz · ⚡ Reflex Race · 🔍 Find Match

**Ball** (20): 🏓 Ping Pong · 🎾 Tennis · 🏒 Air Hockey · ⚽ Penalty Kicks · 🥅 Mini Soccer · 🏟️ Soccer Pool · 🏀 Basket Ball · 🏐 Beach Ball · 🦀 Crabby Volley · 🎱 Pool · ⛳ Mini Golf · 🎳 Bowling · 🟤 Carrom · 🥋 Sumo · 🧱 Brick Blast · 🪀 Sling Puck · 🦛 Happy Hippos · 🌀 Spin War · 👑 King of the Hill · 🕹️ Pinball

**Aim** (13): 🏌️ Golf · 🏈 Golf Football · 🎯 Darts · 🏹 Archery · 🌽 Cornhole · 🎪 Target Practice · 🍎 Archery Master · 🔪 Knife Thrower · ⚔️ Sword Thrower · 🥎 Throw · 💣 Cannon Duel · 🎋 Shuriken Bamboo · 🥤 Cup Pong

**Reflex** (15): 🪢 Pull the Rope · 🔨 Hammer Hit · 👋 Hand Slap · 🍣 The Last Sashimi · 🐹 Whack a Mole · 🥔 Hot Potato · 💎 Light Fingers · 🍉 Fruit Duel · 🎣 Unfair Fishing · 💰 Money Grabber · ⭐ Star Catcher · 🐸 Sticky Tongues · 🪓 Lumber Jack · 🐀 Rat Race · 🪩 Disco Battle

**Arena** (21): 🪖 Tanks · ⛵ Ship Battle · 🤖 Robot Arena · 🧨 Explosive Festival · 🖌️ Paint Fight · 🪷 Frogs Fight · 🪲 Dung Battle · 🥷 Guard and Thief · 🦔 Spike Attacks · 🗡️ Fatal Knights · 🐧 Frozen Penguins · 🧊 Broken Tiles · 💫 Snakes · 🐍 Neon Snake · 🏎️ Racing Cars · 🚗 Slot Cars · 🚦 Traffic Jam · 🚙 Road Dodge · 🚕 Taxi Race · 🐟 Piranha Rush · 🦬 Stampede

**Runner** (7): 🧲 Gravity Run · 🐔 Chicken Jump · 🐦 Happy Birds · 🦘 Flappy Jump · 🏍️ Wheelie · 🚧 Crash It · 🔮 Ball Run

**Physics** (5): 🤸 Ballgames Physics · 🤼 Wrestle · 🦒 Animal Stack · 🗿 Brainrot Stack · 💧 Water Game

**Puzzle race** (9): 🔢 Sudoku · 🧩 Sliding Puzzle · 🟦 Blocks · ♠️ Solitaire · 🀄 Tap Match · 🔟 Number Match · 🔩 Nuts and Bolts · 🖍️ Maze Paint · 🍒 Fruit Merge
<!-- games:end -->

## Privacy

Everything runs in your browser. Nothing is collected or sent anywhere. Online play connects the two phones directly over WebRTC; public Nostr relays are only used for the two phones to find each other. When no direct connection is possible (some Wi-Fi networks block it), moves pass through public MQTT brokers instead. Nothing is stored.

## Develop

```sh
pnpm install
pnpm dev            # http://localhost:5173/versus/
pnpm verify         # typecheck, lint, unit tests, build, size budget
pnpm test:e2e       # Playwright (iPhone profile): every game computer vs computer, home, offline
ONLINE=1 pnpm test:e2e e2e/online.spec.ts   # real peer-to-peer match between two browsers
```

How the code is organised and how to add a game: [docs/AUTHORING.md](docs/AUTHORING.md). Card images: `node scripts/thumbs.mjs` against a running dev server.

## Credits and license

Original games, names and art; synthesised sounds; Fredoka font (OFL). See [CREDITS.md](CREDITS.md). Code under the [MIT license](LICENSE).
