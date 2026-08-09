export interface WorldPoint {
  x: number;
  y: number;
}

export interface GeneratedCountry {
  name: string;
  demonym: string;
  leagueName: string;
  flag: { primary: string; secondary: string; accent: string; pattern: 'cross' | 'bands' | 'diagonal' | 'star' };
  outline: WorldPoint[];
}

export interface WorldRegion {
  id: string;
  name: string;
  color: string;
  centre: WorldPoint;
}

export interface WorldCity {
  id: string;
  name: string;
  regionId: string;
  teamId: string;
  position: WorldPoint;
  stadiumName: string;
  landmark: string;
  populationBand: 'town' | 'city' | 'metro';
}

export interface TravelRoute {
  id: string;
  fromCityId: string;
  toCityId: string;
  distanceKm: number;
  mode: 'bus' | 'train' | 'plane';
}

export interface ClubRivalry {
  teamAId: string;
  teamBId: string;
  intensity: 1 | 2 | 3;
  reason: 'derby' | 'historic' | 'title';
}

export interface TravelEffect {
  fitness: number;
  morale: number;
  coins: number;
  scoutReport: boolean;
  injuryRisk: number;
}

export interface TravelEventChoice {
  id: string;
  labelKey: string;
  effect: TravelEffect;
  safe: boolean;
}

export interface TravelEvent {
  id: string;
  fixtureId: string;
  season: number;
  week: number;
  category: 'traffic' | 'weather' | 'fans' | 'media' | 'bonding' | 'scouting' | 'sponsor';
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
  choices: TravelEventChoice[];
  selectedChoiceId: string | null;
  resolved: boolean;
  affectedPlayerIds: string[];
}

export interface WorldState {
  generationVersion: 1;
  seed: number;
  country: GeneratedCountry;
  regions: WorldRegion[];
  cities: WorldCity[];
  routes: TravelRoute[];
  rivalries: ClubRivalry[];
  travelEvents: TravelEvent[];
}
