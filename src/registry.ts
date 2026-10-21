import type { Family, GameModule } from './core/game.ts'

export interface GameMeta {
  id: string
  name: string
  family: Family
  /** Card art: a colour emoji drawn over the family pattern. */
  glyph: string
  /** One to three short sentences, shown to both players before the game. */
  rules: string
  /** Playable over P2P. */
  online: boolean
  /** 2 vs 2 on one phone (two players per half). */
  teams: boolean
  /** Has a computer opponent (puzzle races use 1P as a solo time trial instead). */
  ai: boolean
  isNew?: boolean
}

export interface FamilyMeta {
  id: Family
  label: string
  color: string
}

export const FAMILIES: FamilyMeta[] = [
  { id: 'board', label: 'Board', color: '#9d6bff' },
  { id: 'dice', label: 'Dice', color: '#ff8b3d' },
  { id: 'cards', label: 'Cards & quiz', color: '#ff6fb5' },
  { id: 'puck', label: 'Ball', color: '#3edc8a' },
  { id: 'aim', label: 'Aim', color: '#ffcd3c' },
  { id: 'reflex', label: 'Reflex', color: '#ff4b5c' },
  { id: 'arena', label: 'Arena', color: '#3b8cff' },
  { id: 'runner', label: 'Runner', color: '#46dcf0' },
  { id: 'ragdoll', label: 'Physics', color: '#22c3b0' },
  { id: 'puzzle', label: 'Puzzle race', color: '#c98a4b' },
]

type Row = [id: string, name: string, glyph: string, rules: string, flags?: string]

// Flags: o = online, t = 2 vs 2, n = new, x = no computer opponent.
const TABLE: Record<Family, Row[]> = {
  board: [
    ['tic-tac-toe', 'Tic Tac Toe', '❌', 'Take turns placing your mark. Three in a row wins.', 'o'],
    [
      'ultimate-tic-tac-toe',
      'Ultimate Tic Tac Toe',
      '🔲',
      'Nine boards in one. Where you play sends your rival to that board. Win three boards in a row.',
      'o',
    ],
    [
      'four-in-a-row',
      '4 in a Row',
      '🔴',
      'Drop discs into the columns. Line up four in any direction.',
      'o',
    ],
    ['chess', 'Chess', '♟️', 'The classic. Checkmate the king to win.', 'o'],
    [
      'checkers',
      'Checkers',
      '🏁',
      'Jump diagonally over rival pieces; captures are compulsory. Reach the far row to crown a king.',
      'o',
    ],
    [
      'reversi',
      'Reversi',
      '⚪',
      'Trap rival discs between yours to flip them. Most discs when the board fills wins.',
      'o',
    ],
    [
      'mancala',
      'Mancala',
      '🫘',
      'Sow seeds around the board. End in your store to play again; end in an empty pit on your side to capture.',
      'o',
    ],
    [
      'dots-and-boxes',
      'Dots and Boxes',
      '✏️',
      'Draw a line between two dots. Close a box to claim it and play again.',
      'o',
    ],
    [
      'sea-battle',
      'Sea Battle',
      '🚢',
      "Hide your fleet, then take turns firing at your rival's waters. Sink every ship first.",
      'o',
    ],
    [
      'color-wars',
      'Color Wars',
      '🎨',
      'Tap your cells to add dots. At four they burst and take over the neighbours. Wipe your rival off the board.',
      'o',
    ],
    [
      'pop-it',
      'Pop It',
      '🫧',
      'Pop as many bubbles as you like from one row. Whoever pops the last bubble loses.',
      'o',
    ],
  ],
  dice: [
    [
      'backgammon',
      'Backgammon',
      '🎲',
      'Race your fifteen checkers home and bear them off. Hit a lone checker to send it back.',
      'o',
    ],
    [
      'ludo',
      'Ludo',
      '🐎',
      'Roll a six to leave base. Race your tokens around and home; land on a rival to send it back.',
      'o',
    ],
    [
      'snakes-and-ladders',
      'Snakes & Ladders',
      '🪜',
      'Roll and climb. Ladders lift you, snakes slide you down. First to 100 wins.',
      'o',
    ],
    [
      'yazy',
      'Yazy',
      '💯',
      'Five dice, three rolls a turn. Fill a short score sheet with combos; highest total wins.',
      'o',
    ],
    [
      'yazy-classic',
      'Yazy Classic',
      '📋',
      'The full thirteen-row dice classic: upper bonus, straights, full house and five of a kind.',
      'o',
    ],
    [
      'shut-the-box',
      'Shut the Box',
      '📦',
      'Roll and shut tiles that add up to the roll. Lowest total left open wins.',
      'o',
    ],
  ],
  cards: [
    [
      'guess-the-person',
      'Guess the Person',
      '🕵️',
      "Ask yes/no questions about your rival's secret face and flip down the ones it can't be. Name it first to win.",
      'o',
    ],
    [
      'triple',
      'Triple',
      '🃏',
      'Spot three cards that are all the same or all different on every trait. First to tap a real triple scores.',
      'o',
    ],
    [
      'memory',
      'Memory',
      '🧠',
      'Flip two cards a turn. A pair is yours and you go again. Most pairs wins.',
      'o',
    ],
    [
      'pizza-memory',
      'Pizza Memory',
      '🍕',
      'Watch the order arrive, then rebuild it topping by topping. One slip ends your turn.',
      'o',
    ],
    [
      'math-quiz',
      'Math Quiz',
      '➗',
      'Tap the right answer before your rival. A wrong answer costs a point.',
      'o',
    ],
    [
      'reflex-race',
      'Reflex Race',
      '⚡',
      'Hit your button the moment the picture matches the rule. Too early costs you.',
      'o',
    ],
    [
      'find-match',
      'Find Match',
      '🔍',
      'Two cards always share exactly one symbol. Spot it first.',
      'o',
    ],
  ],
  puck: [
    ['ping-pong', 'Ping Pong', '🏓', 'Slide your paddle to return the ball. First to 7.'],
    [
      'tennis',
      'Tennis',
      '🎾',
      'Run to the ball and the racket swings itself; where it hits decides the angle. First to 7.',
    ],
    ['air-hockey', 'Air Hockey', '🏒', "Smash the puck into your rival's goal. First to 7.", 't'],
    [
      'penalty-kicks',
      'Penalty Kicks',
      '⚽',
      'Swipe to shoot, then dive to save. Best of five each.',
    ],
    [
      'mini-soccer',
      'Mini Soccer',
      '🥅',
      'Flick your players into the ball. Most goals when time runs out.',
      't',
    ],
    [
      'soccer-pool',
      'Soccer Pool',
      '🏟️',
      'Take turns flicking your discs to knock the ball into the goal.',
    ],
    [
      'basket-ball',
      'Basket Ball',
      '🏀',
      'Flick the ball into the hoop. Most baskets in 45 seconds.',
    ],
    ['beach-ball', 'Beach Ball', '🏐', "Keep it up and land it on your rival's sand.", 't'],
    [
      'crabby-volley',
      'Crabby Volley',
      '🦀',
      'Scuttle and hop to volley the ball over the net. First to 7.',
      't',
    ],
    ['pool', 'Pool', '🎱', 'Pot your colour, then the black. Pull back to set the power.'],
    ['mini-golf', 'Mini Golf', '⛳', 'Pull back to putt. Fewest strokes over the course wins.'],
    ['bowling', 'Bowling', '🎳', 'Swipe to roll and curve into the pins. Five frames.'],
    ['carrom', 'Carrom', '🟤', 'Flick the striker to pot your pieces before your rival does.'],
    ['sumo', 'Sumo', '🥋', 'Charge and shove. Push your rival out of the ring.', 't'],
    [
      'brick-blast',
      'Brick Blast',
      '🧱',
      'Keep the ball alive and smash more bricks than your rival.',
    ],
    ['sling-puck', 'Sling Puck', '🪀', 'Fling your pucks through the gap. Empty your side to win.'],
    ['happy-hippos', 'Happy Hippos', '🦛', 'Tap to chomp. Gobble the most marbles.'],
    [
      'spin-war',
      'Spin War',
      '🌀',
      "Steer your spinning top and knock your rival's out of the bowl.",
      't',
    ],
    [
      'king-of-the-hill',
      'King of the Hill',
      '👑',
      'Stay on the crown zone and bump your rival off. Hold it the longest.',
    ],
    ['pinball', 'Pinball', '🕹️', "Flip the ball past your rival's flippers. First to 5.", 'o'],
  ],
  aim: [
    ['golf', 'Golf', '🏌️', 'Pull back to swing, mind the wind. Hole out in fewer strokes.'],
    [
      'golf-football',
      'Golf Football',
      '🏈',
      'Kick through the posts from ever further out. Miss and your rival can steal it.',
    ],
    ['darts', 'Darts', '🎯', 'Three darts a turn. Highest total after five rounds.'],
    [
      'archery',
      'Archery',
      '🏹',
      'Pull, aim, release, mind the wind. Best score after five arrows.',
    ],
    [
      'cornhole',
      'Cornhole',
      '🌽',
      'Toss bean bags at the board: in the hole is 3, on the board is 1. First to 11.',
    ],
    [
      'target-practice',
      'Target Practice',
      '🎪',
      'Targets pop up everywhere. Hit more of them than your rival.',
    ],
    [
      'archery-master',
      'Archery Master',
      '🍎',
      "Shoot the apple off the dummy's head. Hit the dummy and you lose a life.",
      'o',
    ],
    [
      'knife-thrower',
      'Knife Thrower',
      '🔪',
      "Tap to throw into the spinning log. Hit another knife and you're out.",
    ],
    [
      'sword-thrower',
      'Sword Thrower',
      '⚔️',
      "Throw swords at your rival's spinning shield. Most hits wins.",
    ],
    ['throw', 'Throw', '🥎', 'Swing and let go at the right moment. Longest throw of three wins.'],
    [
      'cannon-duel',
      'Cannon Duel',
      '💣',
      "Aim your cannon, mind the wind, and blow up your rival's fort.",
    ],
    [
      'shuriken-bamboo',
      'Shuriken Bamboo',
      '🎋',
      'Throw shurikens to slice the bamboo before your rival does.',
    ],
    ['cup-pong', 'Cup Pong', '🥤', "Flick the ball into your rival's cups. Clear them all first."],
  ],
  reflex: [
    [
      'pull-the-rope',
      'Pull the Rope',
      '🪢',
      'Tap as fast as you can to drag the rope over to your side.',
      'ot',
    ],
    [
      'hammer-hit',
      'Hammer Hit',
      '🔨',
      'Stop the swinging gauge at the top. Ring the bell higher than your rival.',
    ],
    [
      'hand-slap',
      'Hand Slap',
      '👋',
      "Slap when it's real, pull back when it's a fake. Flinch and you lose the point.",
    ],
    [
      'the-last-sashimi',
      'The Last Sashimi',
      '🍣',
      "Wait for the signal, then grab the last piece first. Grab too soon and it's gone.",
    ],
    ['whack-a-mole', 'Whack a Mole', '🐹', 'Bonk the moles on your side. Spare the bunnies.', 'ot'],
    [
      'hot-potato',
      'Hot Potato',
      '🥔',
      "Tap to throw the potato back. Don't be holding it when it blows.",
    ],
    [
      'light-fingers',
      'Light Fingers',
      '💎',
      'Snatch gems while the guard sleeps. Get caught and you drop them.',
    ],
    ['fruit-duel', 'Fruit Duel', '🍉', 'Slice the fruit flying over your half. Never the bombs.'],
    ['unfair-fishing', 'Unfair Fishing', '🎣', 'Reel in when it bites. Big fish fight back.'],
    ['money-grabber', 'Money Grabber', '💰', 'Grab the falling cash, dodge the bombs.'],
    ['star-catcher', 'Star Catcher', '⭐', 'Slide your basket and catch more falling stars.'],
    [
      'sticky-tongues',
      'Sticky Tongues',
      '🐸',
      "Tap to flick your frog's tongue. Catch the most flies.",
    ],
    [
      'lumber-jack',
      'Lumber Jack',
      '🪓',
      'Chop left or right and dodge the branches. Fastest to the top wins.',
    ],
    [
      'rat-race',
      'Rat Race',
      '🐀',
      'Mash to run, keep the rhythm for a boost. First across the line.',
    ],
    ['disco-battle', 'Disco Battle', '🪩', 'Hit the arrows on the beat. Best groove wins.'],
  ],
  arena: [
    [
      'tanks',
      'Tanks',
      '🪖',
      "Drive and fire; shells bounce off walls. Three hits and you're out.",
      't',
    ],
    ['ship-battle', 'Ship Battle', '⛵', 'Sail and fire broadsides. Sink your rival.'],
    ['robot-arena', 'Robot Arena', '🤖', "Ram and zap your rival's robot until it breaks."],
    [
      'explosive-festival',
      'Explosive Festival',
      '🧨',
      'Drop bombs, blast crates and catch your rival in the blast.',
    ],
    [
      'paint-fight',
      'Paint Fight',
      '🖌️',
      'Roll over the floor to paint it. Most paint when time runs out.',
      't',
    ],
    [
      'frogs-fight',
      'Frogs Fight',
      '🪷',
      'Hop across lily pads and knock your rival into the pond.',
    ],
    ['dung-battle', 'Dung Battle', '🪲', 'Roll your ball bigger and flatten your rival.'],
    [
      'guard-and-thief',
      'Guard and Thief',
      '🥷',
      'The thief grabs the loot, the guard gives chase. Then swap roles.',
    ],
    [
      'spike-attacks',
      'Spike Attacks',
      '🦔',
      'Dodge the spikes bursting from the floor. Last one standing.',
    ],
    [
      'fatal-knights',
      'Fatal Knights',
      '🗡️',
      "Joust! Strike your rival's back, never their shield.",
    ],
    [
      'frozen-penguins',
      'Frozen Penguins',
      '🐧',
      'Slide on the ice and bump your rival into the sea.',
    ],
    [
      'broken-tiles',
      'Broken Tiles',
      '🧊',
      "Every tile cracks behind you. Don't be the first to fall.",
    ],
    ['snakes', 'Snakes', '💫', 'Your trail is a wall. Make your rival crash into it.', 't'],
    [
      'neon-snake',
      'Neon Snake',
      '🐍',
      "Eat to grow, cut your rival off. Hit a body and you're out.",
    ],
    ['racing-cars', 'Racing Cars', '🏎️', 'Three laps. Steer, drift, win.'],
    ['slot-cars', 'Slot Cars', '🚗', 'Hold to speed up; ease off in the corners or you fly off.'],
    [
      'traffic-jam',
      'Traffic Jam',
      '🚦',
      'Send your cars across the crossing without crashing. Most cars through wins.',
    ],
    ['road-dodge', 'Road Dodge', '🚙', 'Swerve through oncoming traffic. Last one driving wins.'],
    ['taxi-race', 'Taxi Race', '🚕', 'Pick up passengers and drop them off before your rival.'],
    [
      'piranha-rush',
      'Piranha Rush',
      '🐟',
      'Swim bank to bank and dodge the piranhas. Most crossings wins.',
    ],
    ['stampede', 'Stampede', '🦬', 'Dodge the herd longer than your rival.'],
  ],
  runner: [
    [
      'gravity-run',
      'Gravity Run',
      '🧲',
      "Tap to flip gravity. Fall behind the screen and you're out.",
    ],
    [
      'chicken-jump',
      'Chicken Jump',
      '🐔',
      'Tap to hop over everything. Last chicken running wins.',
    ],
    ['happy-birds', 'Happy Birds', '🐦', 'Tap to flap through the gaps. Last bird flying wins.'],
    [
      'flappy-jump',
      'Flappy Jump',
      '🦘',
      'Bounce from platform to platform. Climb higher than your rival.',
    ],
    [
      'wheelie',
      'Wheelie',
      '🏍️',
      'Hold to throttle. Ride the wheelie furthest without flipping over.',
    ],
    ['crash-it', 'Crash It', '🚧', 'Jump the gaps, smash the walls. First to the finish.'],
    [
      'ball-run',
      'Ball Run',
      '🔮',
      'Steer through the neon tunnel and avoid the holes. Roll further than your rival.',
    ],
  ],
  ragdoll: [
    [
      'ballgames-physics',
      'Ballgames Physics',
      '🤸',
      "Floppy players, one ball. Tap to jump and kick it into your rival's goal.",
    ],
    ['wrestle', 'Wrestle', '🤼', "Tap to jump and grab. Pin your rival's head to the mat."],
    [
      'animal-stack',
      'Animal Stack',
      '🦒',
      'Drop animals on the tower in turns. Whoever topples it loses.',
    ],
    [
      'brainrot-stack',
      'Brainrot Stack',
      '🗿',
      'Stack the strangest cast ever. Whoever topples it loses.',
    ],
    [
      'water-game',
      'Water Game',
      '💧',
      'Press to blast water and float the rings onto the pegs. First to land them all.',
    ],
  ],
  puzzle: [
    [
      'sudoku',
      'Sudoku',
      '🔢',
      'Same puzzle for both. Fill every row, column and box with 1 to 9. Fastest wins.',
      'ox',
    ],
    [
      'sliding-puzzle',
      'Sliding Puzzle',
      '🧩',
      'Slide the tiles back into order. Fastest wins.',
      'ox',
    ],
    [
      'blocks',
      'Blocks',
      '🟦',
      'Fit pieces on the grid and clear full lines. Best score before the clock runs out.',
      'ox',
    ],
    [
      'solitaire',
      'Solitaire',
      '♠️',
      'Same deal for both. Build every suit from ace to king. Most cards home wins.',
      'ox',
    ],
    [
      'tap-match',
      'Tap Match',
      '🀄',
      'Tap tiles into the tray; three alike vanish. Clear the stack first.',
      'ox',
    ],
    [
      'number-match',
      'Number Match',
      '🔟',
      'Match equal numbers or pairs that make ten. Clear the board first.',
      'ox',
    ],
    [
      'nuts-and-bolts',
      'Nuts and Bolts',
      '🔩',
      'Move nuts until every bolt holds one colour. Fastest wins.',
      'ox',
    ],
    [
      'maze-paint',
      'Maze Paint',
      '🖍️',
      'Swipe to roll and paint every tile of the maze. Fastest wins.',
      'ox',
    ],
    [
      'fruit-merge',
      'Fruit Merge',
      '🍒',
      'Drop fruit; two alike merge into a bigger one. Best score before your jar overflows.',
      'ox',
    ],
  ],
}

export const GAMES: GameMeta[] = (Object.keys(TABLE) as Family[]).flatMap((family) =>
  TABLE[family].map(([id, name, glyph, rules, flags = '']) => ({
    id,
    name,
    family,
    glyph,
    rules,
    online: flags.includes('o') || ['board', 'dice', 'cards', 'puzzle'].includes(family),
    teams: flags.includes('t'),
    ai: !flags.includes('x'),
    isNew: flags.includes('n'),
  })),
)

const loaders = import.meta.glob<GameModule>('./games/*/index.ts')

const loaderFor = (id: string) => loaders[`./games/${id}/index.ts`]

/** Only games whose module exists are shown; the rest of the table is the roadmap. */
export const isBuilt = (id: string): boolean => loaderFor(id) !== undefined

export const builtGames = (): GameMeta[] => GAMES.filter((g) => isBuilt(g.id))

export const findGame = (id: string): GameMeta | undefined => GAMES.find((g) => g.id === id)

export async function loadGame(id: string): Promise<GameModule> {
  const l = loaderFor(id)
  if (!l) throw new Error(`Unknown game ${id}`)
  return l()
}
