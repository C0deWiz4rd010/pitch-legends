import { AssistPreset } from '../../models/match.model';

export { BALL_PHYSICS } from './ball-physics';
export { ACTION_CONTACT_TICKS, ACTION_DURATION_TICKS } from './action-timing';

/** Movement and loop constants of the arcade match. */
export const ARCADE_MATCH_TUNING = {
  sprintMin: 6,
  sprintMax: 9.4,
  jogRatio: 0.68,
  ballJogRatio: 0.95,
  ballSprintRatio: 0.91,
  acceleration: 18,
  braking: 30,
  maxCatchUpSteps: 8,
  aiFirstTouchAssist: 10,
  aiIntendedReceiverBonus: 8,
  /** Crowd-backed composure: slightly tighter passing/finishing, cleaner touches and tackles at home. */
  homeComposure: 0.15,
  intendedReceiverControlBias: 0.12,
} as const;

/**
 * Every balance value of the match engine that is not a formula. The engine reads these on use, so the
 * debug panel can change them live; a headless run never writes them.
 */
export const MATCH_TUNING = {
  ai: {
    /** What an AI passer adds to the score of a target he thinks may be offside: attackers are sometimes found anyway. */
    offsideRiskPenalty: 0.2,
    /** How strongly AI passers avoid crowded passing lanes; higher means safer, shorter passing. */
    laneCaution: 1.8,
    /** Scales the execution error of AI passes (below 1 means cleaner passing); human passes keep their full error. */
    passSkill: 0.92,
    /** Value an AI passer subtracts from a team-mate who may be offside. */
    offsidePassCost: 0.006,
    /** Share of AI aerial chances (volley, diving header, scissor kick) that are taken instead of controlling the ball. */
    volleyShare: 34,
    flyingHeaderShare: 18,
    bicycleShare: 6,
  },
  reception: {
    /** Interception attempts on a pass in flight happen every this many ticks per defender. */
    interceptShare: 72,
  },
  restart: {
    /** A human-controlled restart is taken for the player after this many seconds. */
    autoSeconds: 8,
  },
  recovery: {
    /** Share of the normal speed while a kick or tackle is still being recovered from. */
    speed: 0.55,
    /** How long a missed slide (or a missed standing tackle) keeps the player slow. */
    slideMissTicks: 48,
    tackleMissTicks: 24,
  },
  keeper: {
    /** Share of a keeper's reach he covers with a poor read; reaction and the shot's roll add the rest. */
    reachBase: 0.45,
    /** Dives: how early a shot is read (seconds of flight), the reaction time and what the body covers without a push. */
    diveHorizon: 0.55,
    reactionBase: 0.3,
    reactionPerSkill: 0.0018,
    diveBodyReach: 1.1,
    /** Share of the ball's distance from goal the keeper comes out when he is alone against the carrier. */
    oneOnOneDepth: 0.42,
    /** Highest ball he takes with his hands standing, and when he comes for a cross. */
    /** How far from the body a ball can still be held, and what holding it at a stretch costs in catch chance. */
    catchReach: 2.1,
    stretchCatchCost: 0.3,
    handHeight: 2.45,
    claimHeight: 2.8,
    /** Seconds he keeps the ball in his hands at least, and at most, before it is released. */
    holdMin: 0.9,
    holdMax: 6,
    /** Up to this distance the ball is thrown, beyond it kicked. */
    throwRange: 30,
  },
  tackle: {
    /** How far away a slide may start. */
    slideLungeReach: 3.2,
  },
  shot: {
    /** Assist levels with a timing finish: a second shoot press inside the wind-up cleans up the strike (off for the strongest assist). */
    timedFinish: { assisted: false, balanced: true, manual: true } as Record<AssistPreset, boolean>,
    /** Standard deviations of shot dispersion per unit of error (about 55 % on target). */
    dispersion: 2.3,
    /** Error multiplier per assist level. */
    assistError: { assisted: 0.72, balanced: 0.92, manual: 1.18 } as Record<AssistPreset, number>,
  },
  pass: {
    /** Side spin a full curl input puts on a lofted and on a flat ball. */
    curlLob: 3.5,
    curlFlat: 2.2,
  },
  run: {
    /** How long a requested run in behind lasts. */
    requestTicks: 120,
  },
  feint: {
    /** How long a feint freezes a defender who bit. */
    freezeTicks: 18,
  },
};
