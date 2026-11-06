/** The six jobs of the backroom team. Every role feeds one existing multiplier of the career. */
export type StaffRole = 'assistant' | 'goalkeeping' | 'fitness' | 'scout' | 'physio' | 'youth';

export const STAFF_ROLES: StaffRole[] = ['assistant', 'goalkeeping', 'fitness', 'scout', 'physio', 'youth'];

/** What a person of the staff is particularly good at: it tilts the role's effect a little. */
export type StaffSpecialty = 'technical' | 'physical' | 'tactical' | 'mental';

export interface StaffMember {
  id: string;
  role: StaffRole;
  firstName: string;
  lastName: string;
  age: number;
  nationality: string;
  /** 40-95; it decides effect and salary. */
  rating: number;
  specialty: StaffSpecialty;
  /** Weekly salary, paid as upkeep. */
  salary: number;
}

export interface StaffState {
  /** One person per role. */
  members: Partial<Record<StaffRole, StaffMember>>;
}

export function emptyStaffState(): StaffState {
  return { members: {} };
}
