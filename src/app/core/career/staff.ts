import { generatePersonName } from '../../data/world-generator';
import { GameState } from '../../models/game.model';
import { STAFF_ROLES, StaffMember, StaffRole, StaffSpecialty, StaffState, emptyStaffState } from '../../models/staff.model';
import { Rng, clamp } from '../util';
import { hash32 } from '../visual-identity';
import { book } from './finance';

export { STAFF_ROLES };

/** Applicants per role and season. */
export const CANDIDATES_PER_ROLE = 3;
/** The signing fee is this many weekly salaries. */
export const SIGNING_WEEKS = 4;

const SPECIALTIES: StaffSpecialty[] = ['technical', 'physical', 'tactical', 'mental'];

/** A person's weekly salary: a decent 60 costs about 1,300, a world-class 90 about 5,900. */
export function staffSalary(rating: number): number {
  const above = Math.max(0, rating - 40);
  return Math.round((400 + above * above * 2.2) / 10) * 10;
}

/**
 * How much a person helps, 0 for a 50 and 1 for a 95: the share of the role's full effect.
 * An average person (below 50) helps nobody, a good one helps a bit and the best help a lot.
 */
export function staffFactor(member: StaffMember | undefined): number {
  if (!member) return 0;
  return clamp((member.rating - 50) / 45, 0, 1);
}

export function staffMember(game: Pick<GameState, 'staff'>, role: StaffRole): StaffMember | undefined {
  return game.staff?.members[role];
}

/** A specialist is better at his own field: 25 % more effect where it fits (mental staff have no field and no tilt). */
export function specialtyTilt(member: StaffMember | undefined, focus: string): number {
  if (!member) return 1;
  const fields: Record<StaffSpecialty, string[]> = { technical: ['shooting', 'passing', 'dribbling'], physical: ['pace', 'physical', 'stamina'], tactical: ['defending'], mental: [] };
  return fields[member.specialty].includes(focus) ? 1.25 : 1;
}

export function staffEffect(game: Pick<GameState, 'staff'>, role: StaffRole): number {
  return staffFactor(staffMember(game, role));
}

/** The weekly bill of the whole backroom team. */
export function staffWeeklyCost(game: Pick<GameState, 'staff'>): number {
  return STAFF_ROLES.reduce((sum, role) => sum + (staffMember(game, role)?.salary ?? 0), 0);
}

export function ensureStaff(game: GameState): StaffState {
  game.staff ??= emptyStaffState();
  return game.staff;
}

function candidateFor(game: Pick<GameState, 'clubId' | 'world' | 'teams'>, role: StaffRole, season: number, index: number): StaffMember {
  const seed = game.world?.seed ?? hash32(game.clubId);
  const rng = new Rng(hash32(`${seed}|${game.clubId}|staff|${role}|${season}|${index}`));
  const name = generatePersonName(seed, `staff-${role}-${season}-${index}`);
  // The pool is wide: some are cheap and mediocre, a few are truly good; the reputation of the club draws better ones.
  const reputation = game.teams.find((team) => team.id === game.clubId)?.reputation ?? 60;
  const rating = clamp(Math.round(rng.gaussian(58 + (reputation - 60) * 0.25, 11)), 40, 95);
  return {
    id: `staff-${hash32(`${seed}|${game.clubId}|${role}|${season}|${index}`).toString(36)}`,
    role,
    firstName: name.firstName,
    lastName: name.lastName,
    age: rng.int(34, 64),
    nationality: name.nationality,
    rating,
    specialty: rng.pick(SPECIALTIES),
    salary: staffSalary(rating),
  };
}

/**
 * This season's applicants for a role. The same club and season always give the same people, so nothing about
 * them needs saving; whoever already holds the job is not offered again.
 */
export function candidatesFor(game: Pick<GameState, 'clubId' | 'league' | 'world' | 'teams' | 'staff'>, role: StaffRole): StaffMember[] {
  const hired = game.staff?.members[role]?.id;
  return Array.from({ length: CANDIDATES_PER_ROLE }, (_, index) => candidateFor(game, role, game.league.season, index)).filter((candidate) => candidate.id !== hired);
}

export type HireFailure = 'club' | 'unknown' | 'budget';

/** Signs an applicant for a role; whoever held it before leaves without a payment. */
export function hireStaff(game: GameState, candidateId: string): { ok: true } | { ok: false; reason: HireFailure } {
  const club = game.teams.find((team) => team.id === game.clubId);
  if (!club) return { ok: false, reason: 'club' };
  const staff = ensureStaff(game);
  let candidate: StaffMember | undefined;
  for (const role of STAFF_ROLES) candidate ??= candidatesFor(game, role).find((entry) => entry.id === candidateId);
  if (!candidate) return { ok: false, reason: 'unknown' };
  const fee = candidate.salary * SIGNING_WEEKS;
  if (club.coins < fee) return { ok: false, reason: 'budget' };
  book(game, club, 'upkeep', fee);
  staff.members[candidate.role] = candidate;
  return { ok: true };
}

export function dismissStaff(game: GameState, role: StaffRole): boolean {
  const staff = ensureStaff(game);
  if (!staff.members[role]) return false;
  delete staff.members[role];
  return true;
}

/** Weekly salaries, booked once a week as upkeep of the managed club. */
export function payStaff(game: GameState): number {
  const club = game.teams.find((team) => team.id === game.clubId);
  const cost = staffWeeklyCost(game);
  if (club && cost) book(game, club, 'upkeep', cost);
  return cost;
}

/** The effect of each role in the numbers the career already reads. All of them are zero without a person. */
export const STAFF_EFFECT_SCALE = {
  /** Training experience of the whole squad. */
  assistantXp: 0.2,
  /** Added to the growth chance of keepers. */
  goalkeepingGrowth: 0.08,
  /** Extra fitness points a squad recovers each week. */
  fitnessRecovery: 6,
  /** Weeks a scout assignment is shorter, at most. */
  scoutWeeks: 2,
  /** Medical levels the physio counts for, so recovery and returns are better. */
  physioLevels: 2,
  /** Overall points of the youth intake, added to the coach's own work. */
  youthIntake: 1,
} as const;
