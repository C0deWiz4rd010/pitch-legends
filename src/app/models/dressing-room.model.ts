/** How a player sees his place in the squad; it sets how many matches he expects to play. */
export type RoomRole = 'star' | 'starter' | 'rotation' | 'prospect' | 'fringe';

export const ROOM_ROLES: RoomRole[] = ['star', 'starter', 'rotation', 'prospect', 'fringe'];

/** A dressing-room event the manager has to answer. It is chosen from the club's seed, like the camp events. */
export interface RoomEventState {
  eventId: string;
  season: number;
  week: number;
  /** null while open. */
  choice: 0 | 1 | null;
}

export interface DressingRoomState {
  /** Team spirit, 0 (a bunch of individuals) to 100 (one unit). */
  spirit: number;
  /** Weeks a player has been unhappy about his playing time, by player id. Absent means content. */
  unhappyWeeks: Record<string, number>;
  /** Players who asked to leave. They stay unhappy until the manager talks to them or plays them. */
  requests: string[];
  /** Season of the last conversation, by player id: one talk per player and season. */
  talked: Record<string, number>;
  /** Week of the last new request, so they never come in clusters. */
  lastRequestWeek: number;
  lastRequestSeason: number;
  event: RoomEventState | null;
  /** Events answered, most recent first, kept to tell the story (ids). */
  history: string[];
}

export function emptyDressingRoom(): DressingRoomState {
  return {
    spirit: 60,
    unhappyWeeks: {},
    requests: [],
    talked: {},
    lastRequestWeek: -99,
    lastRequestSeason: 0,
    event: null,
    history: [],
  };
}
