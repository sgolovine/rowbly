/** A column of the animated board. A working column has an agent on each card and a Stage prompt. */
export type BoardColumn = Readonly<{
  label: string;
  /** The Stage prompt. Only the working columns have one. */
  prompt?: string;
}>;

/** A Story card of the animated board. */
export type BoardCard = Readonly<{
  storyKey: string;
  title: string;
  agent: string;
}>;

/** The place of one card on the board. */
export type CardPlace = Readonly<{
  column: number;
  /** The row of the card in its column. 0 is the top row. */
  slot: number;
  /** The number of times that the card went from Done back to Backlog. */
  lap: number;
}>;

export type BoardState = Readonly<{
  /** The number of the next move. The card at index `step % BOARD_CARDS.length` moves next. */
  step: number;
  /** The place of each card, in the order of `BOARD_CARDS`. */
  places: readonly CardPlace[];
  /** The card that went from Done back to Backlog in the last move. It fades out in Done. */
  leaving: Readonly<{ index: number; place: CardPlace }> | null;
}>;

export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { label: "Backlog" },
  { label: "In Refinement", prompt: "Turn this Story into a spec with acceptance criteria." },
  { label: "In Development", prompt: "Build it, open a PR, move it to In Review." },
  { label: "In Review", prompt: "Review the PR." },
  { label: "Done" },
];

export const BOARD_CARDS: readonly BoardCard[] = [
  { storyKey: "TTT-41", title: "Add an undo button for two-player games", agent: "claude-1" },
  { storyKey: "TTT-43", title: "Add sound effects for moves and wins", agent: "claude-3" },
  { storyKey: "TTT-50", title: "Create and join game rooms by code", agent: "claude-10" },
  { storyKey: "TTT-53", title: "Add turn timers for online games", agent: "codex-13" },
  { storyKey: "TTT-59", title: "Design the ranked matchmaking flow", agent: "claude-19" },
  { storyKey: "TTT-62", title: "Scope the daily puzzle mode", agent: "gemini-23" },
];

/** The largest number of cards in one column at any step of the loop. The board height uses it. */
export const BOARD_SLOTS = 2;

/**
 * The first board: cards in all five columns. The server render, the first client render and the
 * reduced-motion board all use it. The first move is TTT-43, from In Review to Done.
 */
export const INITIAL_BOARD: BoardState = {
  step: 1,
  places: [
    { column: 4, slot: 0, lap: 0 },
    { column: 3, slot: 0, lap: 0 },
    { column: 2, slot: 0, lap: 0 },
    { column: 1, slot: 0, lap: 0 },
    { column: 0, slot: 0, lap: 0 },
    { column: 0, slot: 1, lap: 0 },
  ],
  leaving: null,
};

/** Returns true if the column has a Stage prompt, so that an agent works on its cards. */
export function isWorkingColumn(column: number): boolean {
  return BOARD_COLUMNS[column]?.prompt !== undefined;
}

/**
 * Makes one move. One card goes one column to the right. A card in Done goes back to Backlog.
 * The card goes to the bottom of its new column, and the cards below it in its old column go up.
 */
export function advanceBoard(state: BoardState): BoardState {
  const index = state.step % BOARD_CARDS.length;
  const mover = state.places[index];
  if (mover === undefined) {
    return state;
  }
  const target = (mover.column + 1) % BOARD_COLUMNS.length;
  const wraps = target === 0;
  const targetCount = state.places.filter((place) => place.column === target).length;
  const places = state.places.map((place, placeIndex): CardPlace => {
    if (placeIndex === index) {
      return { column: target, slot: targetCount, lap: wraps ? place.lap + 1 : place.lap };
    }
    if (place.column === mover.column && place.slot > mover.slot) {
      return { ...place, slot: place.slot - 1 };
    }
    return place;
  });
  return { step: state.step + 1, places, leaving: wraps ? { index, place: mover } : null };
}
