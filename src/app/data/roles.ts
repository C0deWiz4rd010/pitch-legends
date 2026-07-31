import { Role } from '../models/tactics.model';

/**
 * Catalog of tactical roles. Each role reweights a player's attributes for
 * role-fit scoring and signals intent to the match engine.
 */
export const ROLES: Role[] = [
  // ── Goalkeepers ───────────────────────────────────────────────────────────
  {
    id: 'gk',
    name: 'Goalkeeper',
    shortName: 'GK',
    positions: ['GK'],
    attributeWeights: { goalkeeping: 0.7, physical: 0.15, passing: 0.15 },
    defaultDuty: 'defend',
    description: 'Classic shot-stopper who holds the line.',
  },
  {
    id: 'sk',
    name: 'Sweeper Keeper',
    shortName: 'SK',
    positions: ['GK'],
    attributeWeights: { goalkeeping: 0.55, passing: 0.25, pace: 0.1, physical: 0.1 },
    defaultDuty: 'support',
    description: 'Sweeps behind a high line and starts attacks with the ball.',
  },

  // ── Full-backs / wing-backs ───────────────────────────────────────────────
  {
    id: 'fb',
    name: 'Full-Back',
    shortName: 'FB',
    positions: ['RB', 'LB'],
    attributeWeights: { defending: 0.4, pace: 0.2, physical: 0.15, passing: 0.15, stamina: 0.1 },
    defaultDuty: 'support',
    description: 'Balanced defender who supports the wide midfield.',
  },
  {
    id: 'wb',
    name: 'Wing-Back',
    shortName: 'WB',
    positions: ['RB', 'LB', 'RWB', 'LWB'],
    attributeWeights: { pace: 0.25, stamina: 0.2, defending: 0.2, passing: 0.2, dribbling: 0.15 },
    defaultDuty: 'attack',
    description: 'Bombs forward relentlessly to overload the flanks.',
  },
  {
    id: 'ifb',
    name: 'Inverted Full-Back',
    shortName: 'IFB',
    positions: ['RB', 'LB'],
    attributeWeights: { defending: 0.35, passing: 0.3, physical: 0.15, dribbling: 0.2 },
    defaultDuty: 'defend',
    description: 'Tucks into midfield in possession to build overloads.',
  },

  // ── Centre-backs ──────────────────────────────────────────────────────────
  {
    id: 'cd',
    name: 'Central Defender',
    shortName: 'CD',
    positions: ['CB', 'RCB', 'LCB'],
    attributeWeights: { defending: 0.5, physical: 0.3, pace: 0.1, passing: 0.1 },
    defaultDuty: 'defend',
    description: 'No-nonsense defender who protects the box.',
  },
  {
    id: 'bpd',
    name: 'Ball-Playing Defender',
    shortName: 'BPD',
    positions: ['CB', 'RCB', 'LCB'],
    attributeWeights: { defending: 0.4, passing: 0.3, physical: 0.2, dribbling: 0.1 },
    defaultDuty: 'defend',
    description: 'Defends first but launches attacks with incisive passing.',
  },
  {
    id: 'stopper',
    name: 'Stopper',
    shortName: 'STP',
    positions: ['CB', 'RCB', 'LCB'],
    attributeWeights: { defending: 0.45, physical: 0.35, pace: 0.2 },
    defaultDuty: 'defend',
    description: 'Steps out aggressively to win the ball high up.',
  },

  // ── Defensive midfield ────────────────────────────────────────────────────
  {
    id: 'anchor',
    name: 'Anchor',
    shortName: 'ANC',
    positions: ['CDM'],
    attributeWeights: { defending: 0.45, physical: 0.25, passing: 0.2, stamina: 0.1 },
    defaultDuty: 'defend',
    description: 'Shields the back line and rarely ventures forward.',
  },
  {
    id: 'dlp',
    name: 'Deep-Lying Playmaker',
    shortName: 'DLP',
    positions: ['CDM', 'CM'],
    attributeWeights: { passing: 0.45, dribbling: 0.2, defending: 0.15, physical: 0.2 },
    defaultDuty: 'support',
    description: 'Dictates tempo from deep with range of passing.',
  },
  {
    id: 'bwm',
    name: 'Ball-Winning Midfielder',
    shortName: 'BWM',
    positions: ['CDM', 'CM'],
    attributeWeights: { defending: 0.4, physical: 0.25, stamina: 0.2, pace: 0.15 },
    defaultDuty: 'support',
    description: 'Hunts the ball and breaks up opposition play.',
  },

  // ── Central midfield ──────────────────────────────────────────────────────
  {
    id: 'cm',
    name: 'Central Midfielder',
    shortName: 'CM',
    positions: ['CM', 'CDM'],
    attributeWeights: { passing: 0.3, defending: 0.2, stamina: 0.2, dribbling: 0.15, physical: 0.15 },
    defaultDuty: 'support',
    description: 'Reliable two-way presence in the engine room.',
  },
  {
    id: 'b2b',
    name: 'Box-to-Box',
    shortName: 'B2B',
    positions: ['CM'],
    attributeWeights: { stamina: 0.25, physical: 0.2, passing: 0.2, shooting: 0.15, defending: 0.2 },
    defaultDuty: 'support',
    description: 'Covers every blade of grass, contributing at both ends.',
  },
  {
    id: 'mezzala',
    name: 'Mezzala',
    shortName: 'MEZ',
    positions: ['CM'],
    attributeWeights: { dribbling: 0.25, passing: 0.25, shooting: 0.2, pace: 0.15, stamina: 0.15 },
    defaultDuty: 'attack',
    description: 'Drifts into the half-space to create and score.',
  },

  // ── Attacking midfield ────────────────────────────────────────────────────
  {
    id: 'ap',
    name: 'Advanced Playmaker',
    shortName: 'AP',
    positions: ['CAM', 'CM'],
    attributeWeights: { passing: 0.4, dribbling: 0.25, shooting: 0.15, pace: 0.2 },
    defaultDuty: 'support',
    description: 'The creative fulcrum linking midfield and attack.',
  },
  {
    id: 'ss',
    name: 'Shadow Striker',
    shortName: 'SS',
    positions: ['CAM'],
    attributeWeights: { shooting: 0.35, pace: 0.25, dribbling: 0.2, passing: 0.2 },
    defaultDuty: 'attack',
    description: 'Bursts beyond the striker to finish chances.',
  },

  // ── Wide forwards ─────────────────────────────────────────────────────────
  {
    id: 'w',
    name: 'Winger',
    shortName: 'W',
    positions: ['RM', 'LM', 'RW', 'LW'],
    attributeWeights: { pace: 0.3, dribbling: 0.3, passing: 0.2, shooting: 0.2 },
    defaultDuty: 'attack',
    description: 'Hugs the touchline to beat his man and cross.',
  },
  {
    id: 'iw',
    name: 'Inverted Winger',
    shortName: 'IW',
    positions: ['RM', 'LM', 'RW', 'LW'],
    attributeWeights: { dribbling: 0.3, passing: 0.25, pace: 0.2, shooting: 0.25 },
    defaultDuty: 'attack',
    description: 'Cuts inside onto his stronger foot to shoot or thread passes.',
  },
  {
    id: 'if',
    name: 'Inside Forward',
    shortName: 'IF',
    positions: ['RW', 'LW'],
    attributeWeights: { shooting: 0.3, pace: 0.28, dribbling: 0.27, passing: 0.15 },
    defaultDuty: 'attack',
    description: 'A wide goal threat who attacks the box relentlessly.',
  },

  // ── Strikers ──────────────────────────────────────────────────────────────
  {
    id: 'poacher',
    name: 'Poacher',
    shortName: 'PO',
    positions: ['ST', 'CF'],
    attributeWeights: { shooting: 0.45, pace: 0.3, dribbling: 0.15, physical: 0.1 },
    defaultDuty: 'attack',
    description: 'Lives on the shoulder of the last defender for goals.',
  },
  {
    id: 'tm',
    name: 'Target Man',
    shortName: 'TM',
    positions: ['ST', 'CF'],
    attributeWeights: { physical: 0.35, shooting: 0.3, passing: 0.2, pace: 0.15 },
    defaultDuty: 'attack',
    description: 'A physical focal point who holds up play and finishes.',
  },
  {
    id: 'cf',
    name: 'Complete Forward',
    shortName: 'CF',
    positions: ['ST', 'CF'],
    attributeWeights: { shooting: 0.3, dribbling: 0.2, passing: 0.2, pace: 0.15, physical: 0.15 },
    defaultDuty: 'attack',
    description: 'Does everything: scores, creates, links and presses.',
  },
  {
    id: 'f9',
    name: 'False Nine',
    shortName: 'F9',
    positions: ['ST', 'CF'],
    attributeWeights: { passing: 0.35, dribbling: 0.3, shooting: 0.2, pace: 0.15 },
    defaultDuty: 'support',
    description: 'Drops deep to overload midfield and open space.',
  },
];

const ROLE_MAP = new Map(ROLES.map((r) => [r.id, r]));

export function getRole(id: string): Role {
  const role = ROLE_MAP.get(id);
  if (!role) {
    throw new Error(`Unknown role id: ${id}`);
  }
  return role;
}

/** Roles that can be used at a given position. */
export function rolesForPosition(position: string): Role[] {
  return ROLES.filter((r) => r.positions.includes(position as never));
}
