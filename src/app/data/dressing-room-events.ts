/** What an answer does to the dressing room. Option 1 is always the bold one. */
export interface RoomEffect {
  /** Change of the team spirit. */
  spirit?: number;
  /** Morale change for every player. */
  morale?: number;
  /** Eases every open grievance by three weeks. */
  calm?: boolean;
  /** Coins; the option is unavailable when the club cannot pay. */
  coins?: number;
  /** Experience of the manager. */
  xp?: number;
}

export interface RoomOption {
  label: [string, string];
  effect: RoomEffect;
}

export interface RoomEventDef {
  id: string;
  /** Needs a certain mood to appear. */
  needs?: 'unhappy' | 'lowSpirit' | 'highSpirit';
  title: [string, string];
  body: [string, string];
  options: [RoomOption, RoomOption];
}

export const ROOM_EVENTS: RoomEventDef[] = [
  {
    id: 'bonus-demand',
    title: ['Prämienforderung', 'Bonus demand'],
    body: ['Die Mannschaft verlangt eine Siegprämie für die nächsten Spiele.', 'The squad wants a win bonus for the next matches.'],
    options: [
      { label: ['Zahlen (−12.000)', 'Pay (−12,000)'], effect: { spirit: 5, morale: 4, coins: -12000 } },
      { label: ['Ablehnen', 'Refuse'], effect: { spirit: -4, morale: -3, xp: 30 } },
    ],
  },
  {
    id: 'late-night',
    title: ['Spät zurück', 'Back late'],
    body: ['Zwei Spieler wurden nachts noch in der Stadt gesehen.', 'Two players were seen out in town late at night.'],
    options: [
      { label: ['Unter vier Augen klären', 'Settle it in private'], effect: { spirit: 1, morale: -1 } },
      { label: ['Strafe vor der Mannschaft', 'Fine them in front of the squad'], effect: { spirit: -2, morale: -2, coins: 4000 } },
    ],
  },
  {
    id: 'young-vs-old',
    title: ['Alt gegen Jung', 'Old against young'],
    body: ['Die Routiniers und die jungen Wilden sind sich nicht mehr grün.', 'The veterans and the young ones have fallen out.'],
    options: [
      { label: ['Mentoren-Programm', 'Mentoring programme'], effect: { spirit: 4, xp: 30 } },
      { label: ['Laufen lassen', 'Let it run'], effect: { spirit: -3 } },
    ],
  },
  {
    id: 'captain-speech',
    needs: 'highSpirit',
    title: ['Ansprache des Kapitäns', "Captain's speech"],
    body: ['Der Kapitän will vor dem Spiel vor allen sprechen.', 'The captain wants to address everyone before the match.'],
    options: [
      { label: ['Kapitän reden lassen', 'Let the captain speak'], effect: { spirit: 3, morale: 1 } },
      { label: ['Selbst die Rede halten', 'Give the speech yourself'], effect: { spirit: 1, xp: 40 } },
    ],
  },
  {
    id: 'bench-grumble',
    needs: 'unhappy',
    title: ['Murren auf der Bank', 'Grumbling on the bench'],
    body: ['Spieler ohne Einsatzzeit sprechen offen über ihren Frust.', 'Players with no minutes speak openly about their frustration.'],
    options: [
      { label: ['Gespräch mit allen suchen', 'Talk to all of them'], effect: { spirit: 2, calm: true } },
      { label: ['Leistung entscheidet', 'Performance decides'], effect: { spirit: -2, morale: 1, xp: 25 } },
    ],
  },
  {
    id: 'transfer-rumour',
    title: ['Gerüchte um den Star', 'Rumours about the star'],
    body: ['Ein großer Klub soll an deinem besten Spieler interessiert sein.', 'A big club is said to be interested in your best player.'],
    options: [
      { label: ['Ruhe bewahren', 'Stay calm'], effect: { morale: 1 } },
      { label: ['Verkaufsverbot erklären', 'Declare him not for sale'], effect: { spirit: 3, morale: -1 } },
    ],
  },
  {
    id: 'team-trip',
    needs: 'highSpirit',
    title: ['Mannschaftsausflug', 'Team trip'],
    body: ['Die Kabine plant einen gemeinsamen Ausflug.', 'The dressing room plans a trip together.'],
    options: [
      { label: ['Mitfahren (−6.000)', 'Join in (−6,000)'], effect: { spirit: 6, morale: 4, coins: -6000 } },
      { label: ['Absagen', 'Decline'], effect: { spirit: -1 } },
    ],
  },
  {
    id: 'losing-meeting',
    needs: 'lowSpirit',
    title: ['Krisensitzung', 'Crisis meeting'],
    body: ['Die Stimmung ist schlecht. Die Spieler erwarten ein Wort von dir.', 'The mood is poor. The players expect a word from you.'],
    options: [
      { label: ['Offene Aussprache', 'Open discussion'], effect: { spirit: 6, morale: 3 } },
      { label: ['Harte Ansage', 'Hard words'], effect: { spirit: -3, xp: 40 } },
    ],
  },
  {
    id: 'press-leak',
    title: ['Interna in der Zeitung', 'Insider news in the paper'],
    body: ['Aus der Kabine ist etwas an die Presse gelangt.', 'Something from the dressing room reached the press.'],
    options: [
      { label: ['Intern klären', 'Settle it internally'], effect: { spirit: 3, morale: -1 } },
      { label: ['Öffentlich dementieren', 'Deny it publicly'], effect: { spirit: -1, morale: 1 } },
    ],
  },
];

export function roomEventById(id: string): RoomEventDef | undefined {
  return ROOM_EVENTS.find((event) => event.id === id);
}
