/**
 * Match actions a talent can unlock. The ids are the contract with the match engine: the engine may ask
 * `canUse(statBlock, id)` (core/rpg/stat-block.ts) before it offers or performs the action. Until it does, the
 * unlock is shown in the player sheet and stored in the stat block, but nothing on the pitch changes.
 */
export const ACTION_IDS = [
  'trivela-pass',
  'trivela-shot',
  'rabona',
  'power-header',
  'kaiser-slide',
  'spin-throw',
  'keeper-sweep',
  'punch-clear',
  'launch-kick',
  'heel-flick',
  'knuckle-shot',
  'step-over',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface ActionInfo {
  id: ActionId;
  name: [string, string];
  /** What the player can do on the pitch once the action is unlocked. */
  text: [string, string];
}

export const ACTIONS: ActionInfo[] = [
  {
    id: 'trivela-pass',
    name: ['Trivela-Pass', 'Trivela pass'],
    text: [
      'Pass mit dem Außenrist: Der Ball dreht sich um den Gegner herum.',
      'A pass with the outside of the boot: the ball bends around the defender.',
    ],
  },
  {
    id: 'trivela-shot',
    name: ['Trivela-Schuss', 'Trivela shot'],
    text: [
      'Schuss mit dem Außenrist: Der Ball kippt spät ins lange Eck.',
      'A shot with the outside of the boot: the ball dips late into the far corner.',
    ],
  },
  {
    id: 'rabona',
    name: ['Rabona', 'Rabona'],
    text: [
      'Pass oder Flanke mit dem Standbein hinter dem Schussbein, auch mit dem schwachen Fuß.',
      'A pass or cross with the kicking leg wrapped behind the standing leg, even with the weaker foot.',
    ],
  },
  {
    id: 'power-header',
    name: ['Wuchtkopfball', 'Power header'],
    text: [
      'Kopfball mit vollem Körpereinsatz: härter aufs Tor, schwerer zu verteidigen.',
      'A header with the whole body behind it: harder on goal, harder to defend.',
    ],
  },
  {
    id: 'kaiser-slide',
    name: ['Kaiser-Grätsche', 'Kaiser slide'],
    text: [
      'Sauber getimmte Grätsche mit dem Ball im Visier, selten ein Foul.',
      'A clean, well-timed slide for the ball, rarely a foul.',
    ],
  },
  {
    id: 'spin-throw',
    name: ['Effet-Abwurf', 'Spin throw'],
    text: [
      'Abwurf mit Drall: Der Ball springt dem Mitspieler vor die Füße.',
      'A throw with spin: the ball skips up at the team-mate’s feet.',
    ],
  },
  {
    id: 'keeper-sweep',
    name: ['Libero-Einsatz', 'Sweeper rush'],
    text: [
      'Der Torwart läuft aus dem Strafraum und klärt vor dem Stürmer.',
      'The keeper rushes out of the box and clears before the striker.',
    ],
  },
  {
    id: 'punch-clear',
    name: ['Fausten', 'Punch clear'],
    text: [
      'Flanken werden weit aus der Gefahrenzone geboxt.',
      'Crosses are punched far out of the danger zone.',
    ],
  },
  {
    id: 'launch-kick',
    name: ['Weiter Abschlag', 'Launch kick'],
    text: [
      'Abschlag über das halbe Feld zum Stürmer.',
      'A goal kick over half the pitch, straight to the striker.',
    ],
  },
  {
    id: 'heel-flick',
    name: ['Hackentrick', 'Heel flick'],
    text: [
      'Weiterleitung mit der Hacke: Der Gegner rechnet nicht damit.',
      'A back-heel flick: the opponent does not see it coming.',
    ],
  },
  {
    id: 'knuckle-shot',
    name: ['Flatterschuss', 'Knuckleball'],
    text: [
      'Schuss ohne Drall, der in der Luft flattert, und dessen Weg der Torwart nicht lesen kann.',
      'A spinless shot that wobbles in the air, a path the keeper cannot read.',
    ],
  },
  {
    id: 'step-over',
    name: ['Übersteiger', 'Step-over'],
    text: [
      'Doppelter Übersteiger vor dem Antritt: Der Verteidiger kommt aus dem Tritt.',
      'A double step-over before the burst: the defender is thrown off his stride.',
    ],
  },
];

const BY_ID = new Map(ACTIONS.map((action) => [action.id as string, action]));

export function actionInfo(id: string): ActionInfo | undefined {
  return BY_ID.get(id);
}
