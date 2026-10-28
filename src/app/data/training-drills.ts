import { AttributeKey, PositionGroup } from '../models/enums';
import { Cond } from '../core/rpg/conditions';
import { EffectSpec } from '../core/rpg/effects';

export interface DrillBuff {
  /** German and English one-liner shown on the drill card and the player sheet. */
  label: [string, string];
  /** What the next match applies; expires after the week's match. */
  effects: EffectSpec[];
}

export interface TrainingDrill {
  id: string;
  name: string;
  icon: string;
  focus: AttributeKey | 'recovery';
  /** A smaller second effect: mastery and a reduced growth chance. */
  secondary?: AttributeKey;
  description: string;
  group: PositionGroup | 'ALL';
  buff?: DrillBuff;
  /** Multiplies the fitness cost of a session (1 when omitted). */
  fitnessCost?: number;
  /** Multiplies the injury risk of a session (1 when omitted). */
  injuryRisk?: number;
}

export const TRAINING_DRILLS: TrainingDrill[] = [
  { id: 'finishing', name: 'Finishing', icon: 'SH', focus: 'shooting', secondary: 'dribbling', description: 'Sharpen shooting and composure in front of goal.', group: 'ATT',
    buff: { label: ['Schussfehler −8 % im nächsten Spiel', 'Shot error −8 % next match'], effects: [{ hook: 'shotError', op: 'mul', value: 0.92 }] } },
  { id: 'vision', name: 'Vision', icon: 'PS', focus: 'passing', secondary: 'dribbling', description: 'Improve range and weight of passing.', group: 'MID',
    buff: { label: ['Passfehler −8 % im nächsten Spiel', 'Pass error −8 % next match'], effects: [{ hook: 'passError', op: 'mul', value: 0.92 }] } },
  { id: 'control', name: 'Close Control', icon: 'DR', focus: 'dribbling', secondary: 'passing', description: 'Tighten dribbling and ball manipulation.', group: 'ALL',
    buff: { label: ['+3 Dribbling unter Druck', '+3 dribbling under pressure'], effects: [{ hook: 'dribbling', op: 'add', value: 3, when: Cond.underPressure }] } },
  { id: 'tackling', name: 'Tackling', icon: 'DF', focus: 'defending', secondary: 'physical', description: 'Drill positioning, marking and tackling.', group: 'DEF',
    buff: { label: ['Tackle-Chance +6 %', 'Tackle chance +6 %'], effects: [{ hook: 'tackleWin', op: 'mul', value: 1.06 }] } },
  { id: 'sprints', name: 'Sprints', icon: 'PC', focus: 'pace', secondary: 'stamina', description: 'Boost acceleration and top speed.', group: 'ALL',
    buff: { label: ['Antritt +4 %', 'Acceleration +4 %'], effects: [{ hook: 'acceleration', op: 'mul', value: 1.04 }] } },
  { id: 'strength', name: 'Strength', icon: 'PH', focus: 'physical', secondary: 'defending', description: 'Build strength and aerial dominance.', group: 'ALL',
    buff: { label: ['+3 Physis', '+3 physical'], effects: [{ hook: 'physical', op: 'add', value: 3 }] } },
  { id: 'endurance', name: 'Endurance', icon: 'ST', focus: 'stamina', secondary: 'pace', description: 'Raise stamina for a full 90 minutes.', group: 'ALL',
    buff: { label: ['Ausdauerverbrauch −7 %', 'Stamina drain −7 %'], effects: [{ hook: 'staminaDrain', op: 'mul', value: 0.93 }] } },
  { id: 'handling', name: 'Shot Stopping', icon: 'GK', focus: 'goalkeeping', secondary: 'physical', description: 'Goalkeeper reflexes and handling.', group: 'GK',
    buff: { label: ['Torwartreaktion +6 %', 'Keeper reaction +6 %'], effects: [{ hook: 'keeperReaction', op: 'mul', value: 1.06 }] } },
  { id: 'rondo', name: 'Rondo', icon: 'RN', focus: 'passing', secondary: 'stamina', description: 'Quick one-touch passing in tight circles.', group: 'MID',
    buff: { label: ['Passfehler −5 %, +2 Passen in der gegnerischen Hälfte', 'Pass error −5 %, +2 passing in the opposing half'],
      effects: [{ hook: 'passError', op: 'mul', value: 0.95 }, { hook: 'passing', op: 'add', value: 2, when: Cond.inOppHalf }] } },
  { id: 'setpieces', name: 'Set Pieces', icon: 'SP', focus: 'shooting', secondary: 'passing', description: 'Free kicks, corners and penalties on repeat.', group: 'ALL', fitnessCost: 0.7,
    buff: { label: ['+4 Schuss und Passen bei Standards', '+4 shooting and passing on set pieces'],
      effects: [{ hook: 'shooting', op: 'add', value: 4, when: Cond.setPiece }, { hook: 'passing', op: 'add', value: 4, when: Cond.setPiece }] } },
  { id: 'pressing', name: 'Pressing Hunt', icon: 'PR', focus: 'defending', secondary: 'stamina', description: 'Win the ball back within seconds of losing it.', group: 'ALL', fitnessCost: 1.3, injuryRisk: 1.25,
    buff: { label: ['Pressing-Tackles +10 %', 'Pressing tackles +10 %'], effects: [{ hook: 'pressTackle', op: 'mul', value: 1.1 }] } },
  { id: 'headers', name: 'Aerial Duels', icon: 'HD', focus: 'physical', secondary: 'shooting', description: 'Headers from crosses and corners, attack and defence.', group: 'ALL',
    buff: { label: ['+3 Physis in beiden Strafräumen', '+3 physical in both boxes'],
      effects: [{ hook: 'physical', op: 'add', value: 3, when: Cond.inOppBox }, { hook: 'physical', op: 'add', value: 3, when: Cond.inOwnBox }] } },
  { id: 'reflexwall', name: 'Reflex Wall', icon: 'RW', focus: 'goalkeeping', secondary: 'dribbling', description: 'Rapid-fire shots from close range for goalkeepers.', group: 'GK', injuryRisk: 0.8,
    buff: { label: ['Torwartreaktion +8 % bei Schüssen', 'Keeper reaction +8 % on shots'], effects: [{ hook: 'keeperReaction', op: 'mul', value: 1.08, when: Cond.facingShot }] } },
  { id: 'video', name: 'Video Analysis', icon: 'VD', focus: 'passing', secondary: 'defending', description: 'Study opponents and your own mistakes; no physical load.', group: 'ALL', fitnessCost: 0, injuryRisk: 0,
    buff: { label: ['Pass- und Schussfehler −3 %', 'Pass and shot error −3 %'], effects: [{ hook: 'passError', op: 'mul', value: 0.97 }, { hook: 'shotError', op: 'mul', value: 0.97 }] } },
  { id: 'recovery', name: 'Recovery', icon: 'RC', focus: 'recovery', description: 'Rest and regain fitness — no XP gained.', group: 'ALL' },
];

export function getDrill(id: string): TrainingDrill | undefined {
  return TRAINING_DRILLS.find((drill) => drill.id === id);
}
