/** Name pools and club identity data for procedural generation. */

export interface ClubIdentity {
  name: string;
  short: string;
  primary: string;
  secondary: string;
}

export const CLUB_IDENTITIES: ClubIdentity[] = [
  { name: 'Nova United', short: 'NOV', primary: '#e11d48', secondary: '#0b1020' },
  { name: 'Vanguard FC', short: 'VAN', primary: '#2563eb', secondary: '#f8fafc' },
  { name: 'Ironside Athletic', short: 'IRN', primary: '#f59e0b', secondary: '#111827' },
  { name: 'Solaris City', short: 'SOL', primary: '#22d3ee', secondary: '#082f49' },
  { name: 'Crimson Rovers', short: 'CRM', primary: '#dc2626', secondary: '#fee2e2' },
  { name: 'Emerald Wanderers', short: 'EMR', primary: '#10b981', secondary: '#052e2b' },
  { name: 'Titan Rangers', short: 'TTN', primary: '#7c3aed', secondary: '#faf5ff' },
  { name: 'Aurora SC', short: 'AUR', primary: '#ec4899', secondary: '#1f0a1a' },
  { name: 'Phoenix Albion', short: 'PHX', primary: '#f97316', secondary: '#1c1917' },
  { name: 'Frostgate FC', short: 'FRO', primary: '#38bdf8', secondary: '#0c4a6e' },
  { name: 'Gladiators Town', short: 'GLD', primary: '#eab308', secondary: '#3b1d0e' },
  { name: 'Meridian FC', short: 'MER', primary: '#14b8a6', secondary: '#042f2e' },
  { name: 'Highcliff United', short: 'HGH', primary: '#6366f1', secondary: '#eef2ff' },
  { name: 'Stormont City', short: 'STM', primary: '#0ea5e9', secondary: '#0f172a' },
  { name: 'Redwood FC', short: 'RDW', primary: '#b91c1c', secondary: '#fef2f2' },
  { name: 'Zenith Athletic', short: 'ZEN', primary: '#a855f7', secondary: '#faf5ff' },
];
