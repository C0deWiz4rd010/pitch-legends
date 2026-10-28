/** What a camp event option does to the whole squad (and the club's coins). */
export interface CampEffect {
  /** Morale change for every player. */
  morale?: number;
  /** Fitness change for every player. */
  fitness?: number;
  /** XP for every player. */
  xp?: number;
  /** Mastery points in every player's core attribute. */
  mastery?: number;
  /** Coins; the option is unavailable when the club cannot pay. */
  coins?: number;
}

export interface CampOption {
  label: [string, string];
  effect: CampEffect;
}

export interface CampEvent {
  id: string;
  title: [string, string];
  /** `{city}` is replaced by the home city of the club. */
  body: [string, string];
  options: [CampOption, CampOption];
}

export const CAMP_EVENTS: CampEvent[] = [
  {
    id: 'guest-coach',
    title: ['Gasttrainer zu Besuch', 'Guest coach visits'],
    body: ['Ein Trainer aus {city} bietet an, eine Einheit zu leiten.', 'A coach from {city} offers to run a session.'],
    options: [
      { label: ['Annehmen (−5.000)', 'Accept (−5,000)'], effect: { mastery: 6, xp: 20, coins: -5000 } },
      { label: ['Höflich ablehnen', 'Politely decline'], effect: { morale: 1 } },
    ],
  },
  {
    id: 'rondo-dispute',
    title: ['Streit beim Rondo', 'Row during the rondo'],
    body: ['Zwei Spieler geraten aneinander. Wie reagierst du?', 'Two players clash. How do you react?'],
    options: [
      { label: ['Durchgreifen', 'Crack down'], effect: { morale: -3, mastery: 3 } },
      { label: ['Laufen lassen', 'Let it go'], effect: { morale: 2 } },
    ],
  },
  {
    id: 'open-session',
    title: ['Offenes Training', 'Open training session'],
    body: ['Fans aus {city} möchten zuschauen.', 'Fans from {city} want to watch.'],
    options: [
      { label: ['Zulassen', 'Allow it'], effect: { morale: 4, fitness: -3 } },
      { label: ['Hinter verschlossenen Toren', 'Behind closed doors'], effect: { mastery: 3 } },
    ],
  },
  {
    id: 'rain-day',
    title: ['Dauerregen', 'Pouring rain'],
    body: ['Der Platz ist aufgeweicht.', 'The pitch is waterlogged.'],
    options: [
      { label: ['Trotzdem trainieren', 'Train anyway'], effect: { mastery: 5, fitness: -6 } },
      { label: ['Videoanalyse im Trockenen', 'Video analysis indoors'], effect: { xp: 25 } },
    ],
  },
  {
    id: 'team-dinner',
    title: ['Mannschaftsabend', 'Team dinner'],
    body: ['Der Kapitän schlägt einen gemeinsamen Abend vor.', 'The captain proposes an evening together.'],
    options: [
      { label: ['Organisieren (−3.000)', 'Organise it (−3,000)'], effect: { morale: 5, fitness: 4, coins: -3000 } },
      { label: ['Früh schlafen gehen', 'Early night'], effect: { fitness: 6 } },
    ],
  },
  {
    id: 'sports-science',
    title: ['Sportwissenschaftler', 'Sports scientist'],
    body: ['Ein Labor bietet Belastungsmessungen an.', 'A lab offers load measurements.'],
    options: [
      { label: ['Buchen (−8.000)', 'Book it (−8,000)'], effect: { mastery: 4, fitness: 5, coins: -8000 } },
      { label: ['Auf Erfahrung vertrauen', 'Trust experience'], effect: { xp: 10 } },
    ],
  },
  {
    id: 'youth-visit',
    title: ['Besuch der Jugend', 'Youth team visit'],
    body: ['Die U19 trainiert eine Woche mit.', 'The U19s join training for a week.'],
    options: [
      { label: ['Mitmachen lassen', 'Let them join'], effect: { xp: 30, fitness: -4 } },
      { label: ['Getrennt trainieren', 'Train separately'], effect: { mastery: 2 } },
    ],
  },
  {
    id: 'heatwave',
    title: ['Hitzewelle', 'Heat wave'],
    body: ['Über 30 Grad auf dem Trainingsplatz.', 'Over 30 degrees on the training pitch.'],
    options: [
      { label: ['Einheit verkürzen', 'Shorten the session'], effect: { fitness: 4, mastery: 1 } },
      { label: ['Durchziehen', 'Push through'], effect: { mastery: 6, fitness: -8, morale: -2 } },
    ],
  },
];

export function campEventById(id: string): CampEvent | undefined {
  return CAMP_EVENTS.find((event) => event.id === id);
}
