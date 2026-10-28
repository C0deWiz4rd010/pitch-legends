import { Cond } from '../core/rpg/conditions';
import { EffectSpec } from '../core/rpg/effects';
import { Rarity } from './rarity';

export type QuirkCategory = 'environment' | 'stage' | 'mind' | 'body' | 'social' | 'odd';

export type QuirkStat = 'goals' | 'assists' | 'appearances' | 'cleanSheets' | 'motm';

export interface QuirkDef {
  id: string;
  category: QuirkCategory;
  name: [string, string];
  plus: [string, string];
  minus: [string, string];
  /** Advantage and drawback as modifiers; both work from the first match, revealed or not. */
  effects: EffectSpec[];
  /** The lowest tier that can roll it; evolution results are never rolled. */
  minRarity?: Rarity;
  rollable?: boolean;
  /** Turns into another quirk once a career total is reached (the quirk must be revealed). */
  evolve?: { to: string; stat: QuirkStat; target: number };
  /** A senior in a unit session can pass it on to a junior. */
  inheritable?: boolean;
}

const add = (hook: EffectSpec['hook'], value: number, when?: number, unless?: number): EffectSpec => ({ hook, op: 'add', value, when, unless });
const mul = (hook: EffectSpec['hook'], value: number, when?: number, unless?: number): EffectSpec => ({ hook, op: 'mul', value, when, unless });

export const QUIRKS: QuirkDef[] = [
  // — environment
  { id: 'rain-man', category: 'environment', name: ['Regenspieler', 'Rain Man'], inheritable: true,
    plus: ['Bei Regen: +4 Dribbling, +3 Passen', 'In rain: +4 dribbling, +3 passing'], minus: ['Bei klarem Wetter: −2 Tempo', 'In clear weather: −2 pace'],
    effects: [add('dribbling', 4, Cond.rain), add('passing', 3, Cond.rain), add('pace', -2, Cond.clear)] },
  { id: 'storm-chaser', category: 'environment', name: ['Sturmgeprüft', 'Storm Chaser'],
    plus: ['Im Sturm: +5 Physis, +3 Verteidigen', 'In storms: +5 physical, +3 defending'], minus: ['Bei klarem Wetter: −2 Schuss', 'In clear weather: −2 shooting'],
    effects: [add('physical', 5, Cond.storm), add('defending', 3, Cond.storm), add('shooting', -2, Cond.clear)] },
  { id: 'sun-lover', category: 'environment', name: ['Sonnenanbeter', 'Sun Lover'],
    plus: ['Bei klarem Wetter: +3 Tempo, +3 Dribbling', 'In clear weather: +3 pace, +3 dribbling'], minus: ['Bei Regen: −3 Passen', 'In rain: −3 passing'],
    effects: [add('pace', 3, Cond.clear), add('dribbling', 3, Cond.clear), add('passing', -3, Cond.rain)] },
  { id: 'floodlight-fan', category: 'environment', name: ['Flutlicht-Fan', 'Floodlight Fan'],
    plus: ['Abendspiele: +3 Schuss, +3 Passen, +2 Dribbling', 'Night games: +3 shooting, +3 passing, +2 dribbling'], minus: ['Tagsüber: −1 Ausdauer', 'By day: −1 stamina'],
    effects: [add('shooting', 3, Cond.night), add('passing', 3, Cond.night), add('dribbling', 2, Cond.night), add('stamina', -1, undefined, Cond.night)] },
  // — stage
  { id: 'derby-hero', category: 'stage', name: ['Derby-Held', 'Derby Hero'], inheritable: true,
    plus: ['Im Derby: +5 Schuss, +4 Passen, +3 Verteidigen', 'In derbies: +5 shooting, +4 passing, +3 defending'], minus: ['Sonst: −1 Tempo', 'Otherwise: −1 pace'],
    effects: [add('shooting', 5, Cond.derby), add('passing', 4, Cond.derby), add('defending', 3, Cond.derby), add('pace', -1, undefined, Cond.derby)] },
  { id: 'big-game-player', category: 'stage', name: ['Spieler für große Spiele', 'Big-Game Player'], inheritable: true,
    plus: ['In Pokal- und Topspielen: +4 Schuss, +4 Passen, +3 Dribbling', 'In cup and top games: +4 shooting, +4 passing, +3 dribbling'], minus: ['Sonst: −2 Schuss', 'Otherwise: −2 shooting'],
    effects: [add('shooting', 4, Cond.bigMatch), add('passing', 4, Cond.bigMatch), add('dribbling', 3, Cond.bigMatch), add('shooting', -2, undefined, Cond.bigMatch)] },
  { id: 'cup-fighter', category: 'stage', name: ['Pokalkämpfer', 'Cup Fighter'],
    plus: ['In der Schlussphase und Verlängerung: +5 Physis, Ausdauerverbrauch −20 %', 'Late and in extra time: +5 physical, stamina drain −20 %'], minus: ['Sonst: −1 Tempo', 'Otherwise: −1 pace'],
    effects: [add('physical', 5, Cond.late), mul('staminaDrain', 0.8, Cond.late), add('pace', -1, undefined, Cond.late)] },
  { id: 'home-kid', category: 'stage', name: ['Heimkind', 'Home Kid'],
    plus: ['Zuhause: +3 Schuss, +3 Passen, +3 Dribbling', 'At home: +3 shooting, +3 passing, +3 dribbling'], minus: ['Auswärts: −3 Schuss, −3 Passen', 'Away: −3 shooting, −3 passing'],
    effects: [add('shooting', 3, Cond.home), add('passing', 3, Cond.home), add('dribbling', 3, Cond.home), add('shooting', -3, Cond.away), add('passing', -3, Cond.away)] },
  { id: 'road-warrior', category: 'stage', name: ['Auswärtsfahrer', 'Road Warrior'],
    plus: ['Auswärts: +4 Physis, +3 Verteidigen', 'Away: +4 physical, +3 defending'], minus: ['Zuhause: −2 Passen', 'At home: −2 passing'],
    effects: [add('physical', 4, Cond.away), add('defending', 3, Cond.away), add('passing', -2, Cond.home)] },
  // — mind
  { id: 'nervous', category: 'mind', name: ['Nervenbündel', 'Bundle of Nerves'],
    plus: ['Wächst an sich: nach 5 Spieler-des-Spiels-Auszeichnungen wird er zum Eisherz', 'Grows into it: after 5 man-of-the-match awards he becomes Ice Heart'],
    minus: ['Elfmeter: −8 Schuss; in Topspielen −4 Schuss', 'Penalties: −8 shooting; in top games −4 shooting'],
    effects: [add('shooting', -8, Cond.penalty), add('shooting', -4, Cond.bigMatch), add('passing', 1)],
    evolve: { to: 'ice-heart', stat: 'motm', target: 5 } },
  { id: 'ice-heart', category: 'mind', name: ['Eisherz', 'Ice Heart'], rollable: false, minRarity: 'epic',
    plus: ['Elfmeter: +8 Schuss; in Topspielen Schussfehler −10 %', 'Penalties: +8 shooting; in top games shot error −10 %'], minus: ['Zuhause etwas satt: −1 Dribbling', 'A little complacent at home: −1 dribbling'],
    effects: [add('shooting', 8, Cond.penalty), mul('shotError', 0.9, Cond.bigMatch), add('dribbling', -1, Cond.home)] },
  { id: 'comeback-kid', category: 'mind', name: ['Comeback-Typ', 'Comeback Kid'], inheritable: true,
    plus: ['Bei Rückstand: +4 Schuss, +4 Passen, +4 Dribbling', 'When behind: +4 shooting, +4 passing, +4 dribbling'], minus: ['Bei Führung: −2 Passen', 'When ahead: −2 passing'],
    effects: [add('shooting', 4, Cond.losing), add('passing', 4, Cond.losing), add('dribbling', 4, Cond.losing), add('passing', -2, Cond.winning)] },
  { id: 'hothead', category: 'mind', name: ['Hitzkopf', 'Hothead'],
    plus: ['Ohne Ball: +4 Verteidigen, Tackle-Chance +5 %', 'Out of possession: +4 defending, tackle chance +5 %'], minus: ['Sonst: Passfehler +8 %', 'Otherwise: pass error +8 %'],
    effects: [add('defending', 4, Cond.outOfPossession), add('tackleWin', 0.05, Cond.outOfPossession), mul('passError', 1.08, undefined, Cond.outOfPossession)] },
  { id: 'late-bloomer', category: 'mind', name: ['Spätzünder', 'Late Bloomer'],
    plus: ['Ab Minute 75: +4 Tempo, +4 Ausdauer; wird mit 40 Einsätzen zum Routinier', 'From minute 75: +4 pace, +4 stamina; becomes a Veteran after 40 appearances'],
    minus: ['Davor: −2 Passen', 'Before that: −2 passing'],
    effects: [add('pace', 4, Cond.late), add('stamina', 4, Cond.late), add('passing', -2, undefined, Cond.late)],
    evolve: { to: 'veteran-calm', stat: 'appearances', target: 40 } },
  { id: 'veteran-calm', category: 'mind', name: ['Routinier', 'Veteran'], rollable: false, minRarity: 'rare',
    plus: ['Immer ruhig: Passfehler −8 %, +2 Passen', 'Always calm: pass error −8 %, +2 passing'], minus: ['Etwas langsamer: −1 Tempo', 'A touch slower: −1 pace'],
    effects: [mul('passError', 0.92), add('passing', 2), add('pace', -1)] },
  { id: 'clutch', category: 'mind', name: ['Kaltschnäuzig', 'Clutch'],
    plus: ['Spät und im Rückstand: Schussfehler −15 %', 'Late and behind: shot error −15 %'], minus: ['Bei Führung: −2 Schuss', 'When ahead: −2 shooting'],
    effects: [mul('shotError', 0.85, Cond.late | Cond.losing), add('shooting', -2, Cond.winning)] },
  { id: 'perfectionist', category: 'mind', name: ['Perfektionist', 'Perfectionist'],
    plus: ['Unter Druck: Passfehler −10 %', 'Under pressure: pass error −10 %'], minus: ['Bei Rückstand: −3 Dribbling', 'When behind: −3 dribbling'],
    effects: [mul('passError', 0.9, Cond.underPressure), add('dribbling', -3, Cond.losing)] },
  { id: 'showboat', category: 'mind', name: ['Showman', 'Showboat'],
    plus: ['Unter Druck: +5 Dribbling', 'Under pressure: +5 dribbling'], minus: ['Unter Druck: Passfehler +10 %', 'Under pressure: pass error +10 %'],
    effects: [add('dribbling', 5, Cond.underPressure), mul('passError', 1.1, Cond.underPressure)] },
  // — body
  { id: 'rubber-band', category: 'body', name: ['Gummiband', 'Rubber Band'],
    plus: ['Verletzungsrisiko −30 %', 'Injury risk −30 %'], minus: ['−1 Physis', '−1 physical'],
    effects: [mul('injuryRisk', 0.7), add('physical', -1)] },
  { id: 'glass-bones', category: 'body', name: ['Glasknochen', 'Glass Bones'],
    plus: ['Wendig: +3 Dribbling', 'Nimble: +3 dribbling'], minus: ['Verletzungsrisiko +50 %', 'Injury risk +50 %'],
    effects: [add('dribbling', 3), mul('injuryRisk', 1.5)] },
  { id: 'quick-recovery', category: 'body', name: ['Schnellregenerierer', 'Quick Recoverer'],
    plus: ['Ausdauerverbrauch −10 %', 'Stamina drain −10 %'], minus: ['−2 Physis', '−2 physical'],
    effects: [mul('staminaDrain', 0.9), add('physical', -2)] },
  { id: 'iron-lungs', category: 'body', name: ['Eiserne Lunge', 'Iron Lungs'], inheritable: true,
    plus: ['Ausdauerverbrauch −15 %', 'Stamina drain −15 %'], minus: ['−2 Tempo', '−2 pace'],
    effects: [mul('staminaDrain', 0.85), add('pace', -2)] },
  { id: 'sprinter', category: 'body', name: ['Sprinter', 'Sprinter'],
    plus: ['Im Konter: +5 Tempo', 'On the counter: +5 pace'], minus: ['Bei leerem Tank: −3 Tempo', 'On an empty tank: −3 pace'],
    effects: [add('pace', 5, Cond.counter), add('pace', -3, Cond.lowStamina)] },
  { id: 'second-half-engine', category: 'body', name: ['Zweite-Halbzeit-Motor', 'Second-Half Engine'],
    plus: ['Ab Minute 75 ohne Ball: Ausdauerverbrauch −25 %', 'From minute 75 out of possession: stamina drain −25 %'], minus: ['Davor: Ausdauerverbrauch +5 %', 'Before that: stamina drain +5 %'],
    effects: [mul('staminaDrain', 0.75, Cond.late | Cond.outOfPossession), mul('staminaDrain', 1.05, undefined, Cond.late)] },
  // — social
  { id: 'mentor', category: 'social', name: ['Mentor', 'Mentor'], inheritable: true,
    plus: ['+2 Passen; gibt Eigenheiten an junge Spieler weiter', '+2 passing; passes quirks on to young players'], minus: ['−1 Dribbling', '−1 dribbling'],
    effects: [add('passing', 2), add('dribbling', -1)] },
  { id: 'loner', category: 'social', name: ['Einzelgänger', 'Loner'],
    plus: ['Unter Druck: +4 Dribbling', 'Under pressure: +4 dribbling'], minus: ['Im gegnerischen Strafraum: −3 Passen', 'In the opposing box: −3 passing'],
    effects: [add('dribbling', 4, Cond.underPressure), add('passing', -3, Cond.inOppBox)] },
  { id: 'team-player', category: 'social', name: ['Mannschaftsdienlich', 'Team Player'],
    plus: ['In der gegnerischen Hälfte: +3 Passen', 'In the opposing half: +3 passing'], minus: ['Im gegnerischen Strafraum: −2 Schuss', 'In the opposing box: −2 shooting'],
    effects: [add('passing', 3, Cond.inOppHalf), add('shooting', -2, Cond.inOppBox)] },
  { id: 'greedy', category: 'social', name: ['Egoist', 'Greedy'],
    plus: ['Im gegnerischen Strafraum: +3 Schuss', 'In the opposing box: +3 shooting'], minus: ['Im gegnerischen Strafraum: −3 Passen', 'In the opposing box: −3 passing'],
    effects: [add('shooting', 3, Cond.inOppBox), add('passing', -3, Cond.inOppBox)] },
  // — odd
  { id: 'set-piece-nerd', category: 'odd', name: ['Standard-Tüftler', 'Set-Piece Nerd'], inheritable: true,
    plus: ['Standards: +4 Schuss, +4 Passen', 'Set pieces: +4 shooting, +4 passing'], minus: ['Im Konter: −2 Tempo', 'On the counter: −2 pace'],
    effects: [add('shooting', 4, Cond.setPiece), add('passing', 4, Cond.setPiece), add('pace', -2, Cond.counter)] },
  { id: 'target-man', category: 'odd', name: ['Brecher', 'Target Man'],
    plus: ['Im gegnerischen Strafraum: +4 Physis, +3 Schuss', 'In the opposing box: +4 physical, +3 shooting'], minus: ['Außerhalb: −2 Tempo', 'Outside it: −2 pace'],
    effects: [add('physical', 4, Cond.inOppBox), add('shooting', 3, Cond.inOppBox), add('pace', -2, undefined, Cond.inOppBox)] },
  { id: 'box-guardian', category: 'odd', name: ['Strafraumwächter', 'Box Guardian'],
    plus: ['Im eigenen Strafraum: +4 Verteidigen', 'In the own box: +4 defending'], minus: ['In der gegnerischen Hälfte: −2 Verteidigen', 'In the opposing half: −2 defending'],
    effects: [add('defending', 4, Cond.inOwnBox), add('defending', -2, Cond.inOppHalf)] },
  { id: 'pressing-machine', category: 'odd', name: ['Pressingmaschine', 'Pressing Machine'],
    plus: ['Ohne Ball: Pressing-Tackles +10 %', 'Out of possession: pressing tackles +10 %'], minus: ['Ohne Ball: Ausdauerverbrauch +10 %', 'Out of possession: stamina drain +10 %'],
    effects: [mul('pressTackle', 1.1, Cond.outOfPossession), mul('staminaDrain', 1.1, Cond.outOfPossession)] },
  { id: 'penalty-saver', category: 'odd', name: ['Elfmetertöter', 'Penalty Killer'],
    plus: ['Bei Schüssen auf sein Tor: +3 Torwart', 'Facing shots: +3 goalkeeping'], minus: ['Sonst: −1 Passen', 'Otherwise: −1 passing'],
    effects: [add('goalkeeping', 3, Cond.facingShot), add('passing', -1, undefined, Cond.facingShot)] },
  { id: 'counter-puncher', category: 'odd', name: ['Kontermeister', 'Counter Puncher'],
    plus: ['Im Konter: Passfehler −10 %, +3 Passen', 'On the counter: pass error −10 %, +3 passing'], minus: ['Bei eigenem Ballbesitz im Aufbau: −2 Dribbling', 'In build-up play: −2 dribbling'],
    effects: [mul('passError', 0.9, Cond.counter), add('passing', 3, Cond.counter), add('dribbling', -2, undefined, Cond.counter)] },
  { id: 'night-owl', category: 'environment', name: ['Nachteule', 'Night Owl'],
    plus: ['Abends in der Schlussphase: +4 Tempo', 'In the late evening: +4 pace'], minus: ['Tagsüber: −1 Passen', 'By day: −1 passing'],
    effects: [add('pace', 4, Cond.night | Cond.late), add('passing', -1, undefined, Cond.night)] },
  { id: 'wet-grip', category: 'environment', name: ['Rutschfest', 'Sure-Footed'],
    plus: ['Bei Regen oder Sturm: Beschleunigung +8 %', 'In rain or storm: acceleration +8 %'], minus: ['Bei klarem Wetter: Beschleunigung −3 %', 'In clear weather: acceleration −3 %'],
    effects: [mul('acceleration', 1.08, Cond.rain), mul('acceleration', 0.97, Cond.clear)] },
];

const BY_ID = new Map(QUIRKS.map((quirk) => [quirk.id, quirk]));

export function getQuirk(id: string): QuirkDef | undefined {
  return BY_ID.get(id);
}

export function rollableQuirks(rarity: Rarity, order: readonly Rarity[]): QuirkDef[] {
  return QUIRKS.filter((quirk) => quirk.rollable !== false && order.indexOf(quirk.minRarity ?? 'common') <= order.indexOf(rarity));
}
