import { Cond } from '../core/rpg/conditions';

/** Short German/English names of match situations, for "when does this apply" lines on the sheet. */
const LABELS: [number, string, string][] = [
  [Cond.home, 'zuhause', 'at home'],
  [Cond.away, 'auswärts', 'away'],
  [Cond.inOwnBox, 'im eigenen Strafraum', 'in own box'],
  [Cond.inOppBox, 'im gegnerischen Strafraum', 'in opposing box'],
  [Cond.inOppHalf, 'in der gegnerischen Hälfte', 'in opposing half'],
  [Cond.late, 'ab Minute 75', 'from minute 75'],
  [Cond.losing, 'bei Rückstand', 'when behind'],
  [Cond.winning, 'bei Führung', 'when ahead'],
  [Cond.level, 'bei Gleichstand', 'when level'],
  [Cond.counter, 'im Konter', 'on the counter'],
  [Cond.setPiece, 'bei Standards', 'on set pieces'],
  [Cond.penalty, 'bei Elfmetern', 'on penalties'],
  [Cond.lowStamina, 'bei wenig Ausdauer', 'on low stamina'],
  [Cond.extraTime, 'in der Verlängerung', 'in extra time'],
  [Cond.outOfPossession, 'ohne Ball', 'without the ball'],
  [Cond.underPressure, 'unter Druck', 'under pressure'],
  [Cond.facingShot, 'bei Schüssen aufs Tor', 'facing shots'],
  [Cond.rain, 'bei Regen', 'in rain'],
  [Cond.storm, 'im Sturm', 'in storms'],
  [Cond.derby, 'im Derby', 'in derbies'],
  [Cond.bigMatch, 'in großen Spielen', 'in big games'],
  [Cond.signature, 'wenn die Signatur wach ist', 'while the signature is awake'],
  [Cond.signature2, 'wenn die zweite Signatur wach ist', 'while the second signature is awake'],
  [Cond.night, 'bei Flutlicht', 'under floodlights'],
  [Cond.clear, 'bei klarem Wetter', 'in clear weather'],
];

/** "in own box, from minute 75" style text for a `when`/`unless` pair; empty when always active. */
export function conditionText(when: number, unless: number, language: 'de' | 'en'): string {
  const index = language === 'de' ? 1 : 2;
  const on = LABELS.filter(([bit]) => (when & bit) !== 0).map((entry) => entry[index]);
  const off = LABELS.filter(([bit]) => (unless & bit) !== 0).map((entry) => entry[index]);
  const parts = [...on];
  if (off.length) parts.push((language === 'de' ? 'außer ' : 'except ') + off.join(', '));
  return parts.join(', ');
}

/** Where each attribute pays off in a match, for the "what does this do" hints. */
export const ATTRIBUTE_USE: Record<string, [string, string]> = {
  pace: ['Sprintduelle, Konter, Rückwärtslaufen', 'Sprint duels, counters, tracking back'],
  shooting: ['Abschlussqualität, Distanzschüsse, Elfmeter', 'Finishing, long shots, penalties'],
  passing: ['Passgenauigkeit, Steilpässe, Flanken', 'Pass accuracy, through balls, crosses'],
  dribbling: ['Ballkontrolle, Skill-Moves, enge Räume', 'Ball control, skill moves, tight spaces'],
  defending: ['Tacklings, Stellungsspiel, Abfangen', 'Tackles, positioning, interceptions'],
  physical: ['Zweikämpfe, Kopfbälle, Abschirmen', 'Duels, headers, shielding'],
  stamina: ['Sprintdauer und Leistung in der Schlussphase', 'Sprint duration and late-game sharpness'],
  goalkeeping: ['Paraden, Hechtsprünge, Strafraumbeherrschung', 'Saves, dives, command of the box'],
};
