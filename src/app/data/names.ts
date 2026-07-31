/** Name pools and club identity data for procedural generation. */

export const FIRST_NAMES: string[] = [
  'Leo', 'Marco', 'Kai', 'Diego', 'Luka', 'Mateo', 'Noah', 'Elias', 'Finn', 'Jude',
  'Bruno', 'Youssef', 'Andrés', 'Karim', 'Sergio', 'Viktor', 'Nikola', 'Emre', 'Mohamed', 'Rafael',
  'Thiago', 'Pedri', 'Gavi', 'Phil', 'Bukayo', 'Declan', 'Ollie', 'Jamal', 'Florian', 'Joshua',
  'Rúben', 'João', 'Vinícius', 'Rodri', 'Pau', 'Alessandro', 'Federico', 'Nicolò', 'Dusan', 'Wout',
  'Cody', 'Xavi', 'Gabriel', 'Martin', 'Christian', 'Dominik', 'Ilkay', 'Toni', 'Antoine', 'Kylian',
];

export const LAST_NAMES: string[] = [
  'Silva', 'Costa', 'Fernández', 'Rossi', 'Müller', 'Schmidt', 'Kovač', 'Popović', 'Nowak', 'Andersen',
  'Bergström', 'Novák', 'Horváth', 'Yılmaz', 'Hassan', 'Okafor', 'Mensah', 'Diallo', 'Traoré', 'Mbappé',
  'Bellingham', 'Foden', 'Saka', 'Rice', 'Watkins', 'Musiala', 'Kimmich', 'Wirtz', 'Havertz', 'Kroos',
  'Dias', 'Félix', 'Júnior', 'Hernández', 'Torres', 'Pedri', 'Barella', 'Chiesa', 'Vlahović', 'Weghorst',
  'Gakpo', 'Simons', 'Martinelli', 'Ødegaard', 'Pulisic', 'Szoboszlai', 'Gündoğan', 'Griezmann', 'Osimhen', 'Lautaro',
];

export const NATIONALITIES: string[] = [
  'England', 'Spain', 'Germany', 'France', 'Italy', 'Portugal', 'Brazil', 'Argentina',
  'Netherlands', 'Croatia', 'Belgium', 'Serbia', 'Turkey', 'Nigeria', 'Egypt', 'Senegal',
  'Sweden', 'Denmark', 'Poland', 'Norway',
];

/** Club identities used to populate the league (name, short, kit colors). */
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
