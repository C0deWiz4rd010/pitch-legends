import { Cond } from '../core/rpg/conditions';
import { EffectSpec } from '../core/rpg/effects';
import { PlayerArchetype } from '../models/player.model';
import { Rarity } from './rarity';

/** Moments of the match a signature can wake up on. */
export type SigEvent =
  /** The player's side wins the ball; the new carrier is the one who triggers. */
  | 'ballWon'
  /** The player's side loses the ball; every player of that side with this trigger wakes up. */
  | 'ballLost'
  /** A team-mate receives the ball from a pass. */
  | 'passReceived'
  /** A skill move beats an opponent. */
  | 'skillWon'
  /** The opposing side shoots; every defender of the shot-at side wakes up. */
  | 'shotAgainst'
  /** An opposing shot with an xG above 0.3 is on its way; the keeper wakes up. */
  | 'bigChanceAgainst';

export type SigTrigger =
  /** Active for as long as any of the masks matches the situation. */
  | { kind: 'condition'; any: number[] }
  /** Active for `seconds` after the event, then cooling down. */
  | { kind: 'event'; event: SigEvent; seconds: number; cooldown: number; requires?: number };

export interface SignatureDef {
  id: string;
  archetypes: PlayerArchetype[];
  /** The lowest tier that can roll this signature. */
  minRarity: Rarity;
  /** German and English names; each player gets one variant so signatures are not clones. */
  variants: [string, string][];
  /** One sentence for the sheet and the match report. */
  text: [string, string];
  trigger: SigTrigger;
  /** Effects while active; each must carry `Cond.signature` in `when` (the pipeline maps it to the slot). */
  effects: EffectSpec[];
  /** Refills stamina once per match when it wakes up. */
  restoresStamina?: number;
  /** Share of the rarity budget the signature costs: higher means a stronger or longer effect. */
  cost: number;
}

const S = Cond.signature;

export const SIGNATURES: SignatureDef[] = [
  // — speedster
  { id: 'burst-lane', archetypes: ['speedster'], minRarity: 'common', cost: 1,
    variants: [['Antritt', 'First Step'], ['Lauerstellung', 'Lurker'], ['Konterlust', 'Counter Hunger']],
    text: ['Im Konter schaltet er einen Gang höher.', 'Shifts up a gear on the counter.'],
    trigger: { kind: 'condition', any: [Cond.counter] },
    effects: [{ hook: 'acceleration', op: 'mul', value: 1.12, when: S }, { hook: 'pace', op: 'add', value: 4, when: S }] },
  { id: 'comet', archetypes: ['speedster'], minRarity: 'rare', cost: 2,
    variants: [['Komet', 'Comet'], ['Sternschnuppe', 'Shooting Star'], ['Düsenblitz', 'Jet Flash']],
    text: ['Nach einem Ballgewinn: 3 Sekunden Turbo.', 'After winning the ball: 3 seconds of afterburner.'],
    trigger: { kind: 'event', event: 'ballWon', seconds: 3, cooldown: 12 },
    effects: [{ hook: 'sprintBurst', op: 'mul', value: 1.12, when: S }, { hook: 'acceleration', op: 'mul', value: 1.15, when: S }] },
  // — finisher
  { id: 'cold-blood', archetypes: ['finisher'], minRarity: 'common', cost: 1,
    variants: [['Kaltblut', 'Cold Blood'], ['Nerven aus Stahl', 'Nerves of Steel'], ['Eisauge', 'Ice Eye']],
    text: ['Im Strafraum in der Schlussphase kaum zu stoppen.', 'Hard to stop in the box late in the game.'],
    trigger: { kind: 'condition', any: [Cond.inOppBox | Cond.late, Cond.inOppBox | Cond.losing] },
    effects: [{ hook: 'shotError', op: 'mul', value: 0.75, when: S }, { hook: 'shooting', op: 'add', value: 4, when: S }] },
  { id: 'poacher', archetypes: ['finisher'], minRarity: 'rare', cost: 2,
    variants: [['Abstauber', 'Poacher'], ['Fuchs im Strafraum', 'Fox in the Box'], ['Nachschuss', 'Second Strike']],
    text: ['Kommt der Ball im Strafraum an, ist der Schuss präziser.', 'Receives the ball in the box and shoots more accurately.'],
    trigger: { kind: 'event', event: 'passReceived', seconds: 2.5, cooldown: 8, requires: Cond.inOppBox },
    effects: [{ hook: 'shotError', op: 'mul', value: 0.85, when: S }, { hook: 'shooting', op: 'add', value: 6, when: S }] },
  // — playmaker
  { id: 'calm-carrier', archetypes: ['playmaker'], minRarity: 'common', cost: 1,
    variants: [['Ruhe am Ball', 'Calm on the Ball'], ['Der Ruhepol', 'The Still Point'], ['Übersicht', 'Overview']],
    text: ['Unter Druck wird er nicht hektisch.', 'Does not panic under pressure.'],
    trigger: { kind: 'condition', any: [Cond.underPressure] },
    effects: [{ hook: 'passError', op: 'mul', value: 0.85, when: S }, { hook: 'dribbling', op: 'add', value: 4, when: S }] },
  { id: 'thread-pass', archetypes: ['playmaker'], minRarity: 'rare', cost: 2,
    variants: [['Fadenpass', 'Threaded Pass'], ['Nadelöhr', 'Needle Eye'], ['Pass durch die Mitte', 'Pass Through the Middle']],
    text: ['Nach einem gewonnenen Dribbling sitzt der nächste Pass.', 'After a won dribble the next pass finds its target.'],
    trigger: { kind: 'event', event: 'skillWon', seconds: 4, cooldown: 10 },
    effects: [{ hook: 'passError', op: 'mul', value: 0.6, when: S }, { hook: 'passing', op: 'add', value: 8, when: S }] },
  // — creator
  { id: 'magic-foot', archetypes: ['creator'], minRarity: 'common', cost: 1,
    variants: [['Zauberfuß', 'Magic Foot'], ['Gummiball', 'Rubber Ball'], ['Tänzer', 'Dancer']],
    text: ['Eng gedeckt wird er erst richtig gefährlich.', 'Gets most dangerous when marked tightly.'],
    trigger: { kind: 'condition', any: [Cond.underPressure] },
    effects: [{ hook: 'dribbling', op: 'add', value: 8, when: S }, { hook: 'passError', op: 'mul', value: 0.92, when: S }] },
  { id: 'final-ball', archetypes: ['creator'], minRarity: 'rare', cost: 2,
    variants: [['Der letzte Ball', 'The Final Ball'], ['Vorlagenkönig', 'Assist King'], ['Der Schlüssel', 'The Key']],
    text: ['In der gegnerischen Hälfte kommt jeder Pass an.', 'In the opposing half every pass arrives.'],
    trigger: { kind: 'event', event: 'passReceived', seconds: 3, cooldown: 9, requires: Cond.inOppHalf },
    effects: [{ hook: 'passError', op: 'mul', value: 0.7, when: S }, { hook: 'passing', op: 'add', value: 7, when: S }] },
  // — stopper
  { id: 'rock-in-surf', archetypes: ['stopper'], minRarity: 'common', cost: 1,
    variants: [['Fels in der Brandung', 'Rock in the Surf'], ['Mauer', 'Bulwark'], ['Der Verwalter', 'The Custodian']],
    text: ['Führt seine Mannschaft, wird die Schlussphase zur Festung.', 'With the lead late on, he turns the defence into a fortress.'],
    trigger: { kind: 'condition', any: [Cond.late | Cond.winning] },
    effects: [{ hook: 'physical', op: 'add', value: 6, when: S }, { hook: 'defending', op: 'add', value: 4, when: S }] },
  { id: 'iron-curtain', archetypes: ['stopper'], minRarity: 'rare', cost: 2,
    variants: [['Eiserner Vorhang', 'Iron Curtain'], ['Schutzschild', 'Shield Wall'], ['Letzte Linie', 'Last Line']],
    text: ['Sobald auf sein Tor geschossen wird, rückt die Abwehr zusammen.', 'When his goal is shot at, the defence closes ranks.'],
    trigger: { kind: 'event', event: 'shotAgainst', seconds: 4, cooldown: 10 },
    effects: [{ hook: 'tackleWin', op: 'add', value: 0.1, when: S }, { hook: 'defending', op: 'add', value: 6, when: S }] },
  // — ball-player
  { id: 'tempo-setter', archetypes: ['ball-player'], minRarity: 'common', cost: 1,
    variants: [['Taktgeber', 'Tempo Setter'], ['Metronom', 'Metronome'], ['Der Dirigent', 'The Conductor']],
    text: ['Im Konter spielt er den Ball genauer.', 'Plays more accurately on the counter.'],
    trigger: { kind: 'condition', any: [Cond.counter] },
    effects: [{ hook: 'passError', op: 'mul', value: 0.85, when: S }, { hook: 'passing', op: 'add', value: 5, when: S }] },
  { id: 'build-up', archetypes: ['ball-player'], minRarity: 'rare', cost: 2,
    variants: [['Spielauslösung', 'Build-Up'], ['Erste Welle', 'First Wave'], ['Der Anspielpunkt', 'The Outlet']],
    text: ['Nach dem Ballgewinn startet er den Angriff mit einem sauberen Pass.', 'After winning the ball he starts the attack with a clean pass.'],
    trigger: { kind: 'event', event: 'ballWon', seconds: 4, cooldown: 10 },
    effects: [{ hook: 'passError', op: 'mul', value: 0.7, when: S }, { hook: 'passing', op: 'add', value: 6, when: S }] },
  // — runner
  { id: 'endless-runner', archetypes: ['runner'], minRarity: 'common', cost: 1,
    variants: [['Dauerläufer', 'Endless Runner'], ['Der Pendler', 'The Commuter'], ['Lungenflügel', 'Lungs']],
    text: ['Vorne kostet ihn das Laufen weniger Kraft.', 'Running up front costs him less energy.'],
    trigger: { kind: 'condition', any: [Cond.inOppHalf] },
    effects: [{ hook: 'staminaDrain', op: 'mul', value: 0.65, when: S }] },
  { id: 'second-wind', archetypes: ['runner', 'box-to-box'], minRarity: 'rare', cost: 2, restoresStamina: 25,
    variants: [['Zweite Luft', 'Second Wind'], ['Reserve im Tank', 'Reserve Tank'], ['Letzter Schub', 'Final Push']],
    text: ['Einmal pro Spiel gibt es in der Schlussphase 25 Ausdauer zurück.', 'Once per match he gets 25 stamina back in the closing stages.'],
    trigger: { kind: 'condition', any: [Cond.lowStamina | Cond.late] },
    effects: [{ hook: 'staminaDrain', op: 'mul', value: 0.8, when: S }, { hook: 'pace', op: 'add', value: 3, when: S }] },
  // — ball-winner
  { id: 'hoover', archetypes: ['ball-winner'], minRarity: 'common', cost: 1,
    variants: [['Staubsauger', 'Hoover'], ['Der Schatten', 'The Shadow'], ['Zeckenbiss', 'Tick Bite']],
    text: ['Ohne Ball ist er überall und gewinnt mehr Zweikämpfe.', 'Without the ball he is everywhere and wins more duels.'],
    trigger: { kind: 'condition', any: [Cond.outOfPossession] },
    effects: [{ hook: 'defending', op: 'add', value: 5, when: S }, { hook: 'tackleWin', op: 'add', value: 0.04, when: S }] },
  { id: 'hound', archetypes: ['ball-winner'], minRarity: 'rare', cost: 2,
    variants: [['Jagdhund', 'Hound'], ['Gegenpress-Instinkt', 'Counter-Press Instinct'], ['Sofortzugriff', 'Instant Grab']],
    text: ['Nach einem Ballverlust jagt das Team 5 Sekunden lang den Ball.', 'After losing the ball the team hunts it for 5 seconds.'],
    trigger: { kind: 'event', event: 'ballLost', seconds: 5, cooldown: 10 },
    effects: [{ hook: 'pressTackle', op: 'mul', value: 1.25, when: S }, { hook: 'staminaDrain', op: 'mul', value: 0.8, when: S }] },
  // — box-to-box
  { id: 'total-mid', archetypes: ['box-to-box'], minRarity: 'common', cost: 1,
    variants: [['Total Midfielder', 'Total Midfielder'], ['Überall', 'Everywhere'], ['Der Alleskönner', 'All-Rounder']],
    text: ['In beiden Strafräumen gefährlich: vorn Abschluss, hinten Zweikampf.', 'Dangerous in both boxes: finishing up front, duels at the back.'],
    trigger: { kind: 'condition', any: [Cond.inOppBox, Cond.inOwnBox] },
    effects: [{ hook: 'shooting', op: 'add', value: 5, when: S | Cond.inOppBox }, { hook: 'defending', op: 'add', value: 5, when: S | Cond.inOwnBox }] },
  // — shot-stopper
  { id: 'reflexes', archetypes: ['shot-stopper'], minRarity: 'common', cost: 1,
    variants: [['Reflexe', 'Reflexes'], ['Katzenpfoten', 'Cat Paws'], ['Wachsamkeit', 'Alertness']],
    text: ['Bei Schüssen auf sein Tor ist er hellwach.', 'Wide awake when his goal is shot at.'],
    trigger: { kind: 'condition', any: [Cond.facingShot] },
    effects: [{ hook: 'goalkeeping', op: 'add', value: 5, when: S }] },
  { id: 'cat-reflex', archetypes: ['shot-stopper'], minRarity: 'rare', cost: 2,
    variants: [['Katzenreflex', 'Cat Reflex'], ['Plötzliche Hand', 'Sudden Hand'], ['Der Magnet', 'The Magnet']],
    text: ['Bei einer Großchance reagiert er 40 % schneller.', 'Reacts 40 % faster against a big chance.'],
    trigger: { kind: 'event', event: 'bigChanceAgainst', seconds: 2, cooldown: 25 },
    effects: [{ hook: 'keeperReaction', op: 'mul', value: 1.4, when: S }] },
  // — sweeper
  { id: 'clearance-king', archetypes: ['sweeper'], minRarity: 'common', cost: 1,
    variants: [['Ausputzer', 'Clearer'], ['Letzter Mann', 'Last Man'], ['Strafraumkönig', 'Box King']],
    text: ['Im eigenen Strafraum räumt er alles ab.', 'Clears everything in his own box.'],
    trigger: { kind: 'condition', any: [Cond.inOwnBox | Cond.outOfPossession] },
    effects: [{ hook: 'goalkeeping', op: 'add', value: 4, when: S }, { hook: 'physical', op: 'add', value: 4, when: S }] },
  { id: 'libero', archetypes: ['sweeper'], minRarity: 'rare', cost: 2,
    variants: [['Libero', 'Libero'], ['Der Mitspieler', 'The Outfielder'], ['Vorgeschobener Keeper', 'Advanced Keeper']],
    text: ['Nach einem Ballverlust sprintet er dem Steilpass entgegen.', 'After a lost ball he sprints out to meet the through ball.'],
    trigger: { kind: 'event', event: 'ballLost', seconds: 3, cooldown: 12 },
    effects: [{ hook: 'pace', op: 'add', value: 6, when: S }, { hook: 'acceleration', op: 'mul', value: 1.1, when: S }] },
  // — distributor
  { id: 'steady-hands', archetypes: ['distributor'], minRarity: 'common', cost: 1,
    variants: [['Ballsicher', 'Ball Secure'], ['Ruhige Hände', 'Calm Hands'], ['Sicherer Anwurf', 'Safe Throw']],
    text: ['Unter Druck bleibt der Abwurf präzise.', 'Stays precise under pressure.'],
    trigger: { kind: 'condition', any: [Cond.underPressure] },
    effects: [{ hook: 'passError', op: 'mul', value: 0.85, when: S }, { hook: 'passing', op: 'add', value: 5, when: S }] },
  { id: 'catapult', archetypes: ['distributor'], minRarity: 'rare', cost: 2,
    variants: [['Katapult', 'Catapult'], ['Der lange Arm', 'The Long Arm'], ['Blitzstart', 'Flash Start']],
    text: ['Nach einer Parade startet er sofort den Konter.', 'After a save he starts the counter at once.'],
    trigger: { kind: 'event', event: 'ballWon', seconds: 4, cooldown: 10 },
    effects: [{ hook: 'passing', op: 'add', value: 8, when: S }, { hook: 'passError', op: 'mul', value: 0.8, when: S }] },
];

const BY_ID = new Map(SIGNATURES.map((definition) => [definition.id, definition]));

export function getSignature(id: string): SignatureDef | undefined {
  return BY_ID.get(id);
}

export function signaturesFor(archetype: PlayerArchetype): SignatureDef[] {
  return SIGNATURES.filter((definition) => definition.archetypes.includes(archetype));
}
