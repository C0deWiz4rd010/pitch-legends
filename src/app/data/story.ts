import { ChronicleKind } from '../models/player.model';

/** Chronicle line templates; `{name}` placeholders are filled from the entry's params. */
export const CHRONICLE_TEXT: Record<ChronicleKind, [string, string]> = {
  debut: ['Debüt für {club}.', 'Debut for {club}.'],
  firstGoal: ['Erstes Tor im Profifußball, gegen {opponent}.', 'First professional goal, against {opponent}.'],
  hattrick: ['Hattrick gegen {opponent}!', 'Hat-trick against {opponent}!'],
  motm: ['Spieler des Spiels gegen {opponent}.', 'Man of the match against {opponent}.'],
  injury: ['Verletzt: {weeks} Wochen Pause.', 'Injured: out for {weeks} weeks.'],
  comeback: ['Comeback nach der Verletzung.', 'Back after injury.'],
  level: ['Erreicht Level {level}.', 'Reaches level {level}.'],
  quirk: ['Eigenheit entdeckt: {quirk}.', 'Quirk discovered: {quirk}.'],
  evolution: ['Aus „{from}“ wird „{to}“.', '“{from}” becomes “{to}”.'],
  mastery: ['Meisterschaft {attribute} vollendet: {trait} freigeschaltet.', 'Mastered {attribute}: unlocked {trait}.'],
  transfer: ['Wechselt zu {club}.', 'Moves to {club}.'],
};

/** Bio building blocks; the bio picks one line of each group deterministically from the player id. */
export const BIO_ORIGIN: [string, string][] = [
  ['Wuchs in {city} auf und spielte dort schon als Kind auf der Straße.', 'Grew up in {city}, playing in the streets from an early age.'],
  ['Kommt aus {city}, wo er in der Jugend von {youth} entdeckt wurde.', 'Comes from {city}, where {youth} spotted him as a youth player.'],
  ['Stammt aus {city} und durchlief die Nachwuchsabteilung von {youth}.', 'Hails from {city} and came through the youth ranks of {youth}.'],
];

export const BIO_PERSONALITY: Record<string, [string, string]> = {
  professional: ['Gilt als Musterprofi: pünktlich, fokussiert, nie ein Ausrutscher.', 'A model professional: punctual, focused, never a slip.'],
  driven: ['Ein Getriebener, der nach jedem Spiel sofort das nächste Ziel formuliert.', 'Driven to the core, naming the next goal after every match.'],
  flair: ['Spielt mit Flair und Mut, auch wenn es manchmal schiefgeht.', 'Plays with flair and nerve, even when it sometimes goes wrong.'],
  'team-player': ['Stellt sich stets in den Dienst der Mannschaft.', 'Always puts the team first.'],
  volatile: ['Launisch: an guten Tagen unaufhaltsam, an schlechten kaum zu sehen.', 'Moody: unstoppable on good days, invisible on bad ones.'],
};

export const BIO_RARITY: Record<string, [string, string]> = {
  rare: ['Für Kenner ein Geheimtipp.', 'An insider tip for those who know.'],
  epic: ['Im Umfeld kennt man ihn unter dem Spitznamen „{nickname}“.', 'Around the club he goes by the nickname “{nickname}”.'],
  legendary: ['Ein Name, den man sich in der Liga merkt: „{nickname}“.', 'A name the league remembers: “{nickname}”.'],
  mythic: ['Einer, von dem man noch in Jahren erzählen wird: „{nickname}“.', 'One they will still talk about in years: “{nickname}”.'],
};
