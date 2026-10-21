/// <reference lib="webworker" />
// Loads a game's ai.ts on demand and answers "what would you play here?".
interface Ai {
  choose(state: unknown, difficulty: string, seed: number): unknown
}

const mods = import.meta.glob<Ai>('../../games/*/ai.ts')

self.onmessage = async (
  e: MessageEvent<{ id: number; game: string; state: unknown; difficulty: string; seed: number }>,
) => {
  const { id, game, state, difficulty, seed } = e.data
  const load = mods[`../../games/${game}/ai.ts`]
  if (!load) {
    postMessage({ id, move: null })
    return
  }
  const ai = await load()
  postMessage({ id, move: ai.choose(state, difficulty, seed) })
}
