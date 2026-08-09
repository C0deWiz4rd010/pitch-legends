import { Faker, base, de, en, es, fr, it, nl, pl, pt_BR } from '@faker-js/faker';
import { Delaunay } from 'd3-delaunay';
import { Rng } from '../core/util';
import { hash32 } from '../core/visual-identity';
import { ClubIdentity } from './names';
import { ClubRivalry, TravelRoute, WorldCity, WorldPoint, WorldRegion, WorldState } from '../models/world.model';

const REGION_COLORS = ['#315b78', '#4d684d', '#735349', '#5c4d78', '#7b673a', '#386d68'];
const PRIMARY_COLORS = ['#e11d48', '#2563eb', '#f59e0b', '#22d3ee', '#10b981', '#7c3aed', '#ec4899', '#f97316', '#38bdf8', '#eab308', '#14b8a6'];
const SECONDARY_COLORS = ['#0b1020', '#f8fafc', '#111827', '#082f49', '#052e2b', '#faf5ff', '#1f0a1a', '#1c1917', '#0c4a6e', '#3b1d0e', '#042f2e'];
const CLUB_SUFFIXES = ['United', 'Athletic', 'City', 'Rovers', 'Wanderers', 'Rangers', 'Albion', 'FC', 'Town', 'Sporting', 'Olympic'];
const LANDMARKS = ['Old Harbour', 'Glass Tower', 'Moon Bridge', 'Iron Market', 'Royal Gardens', 'Skyline Gate', 'Ancient Walls', 'Sunset Pier'];
const STADIUM_SUFFIXES = ['Arena', 'Ground', 'Park', 'Bowl', 'Stadion', 'Field'];
const SYLLABLES_A = ['Alder', 'Astra', 'Bel', 'Cael', 'Dun', 'Elden', 'Frost', 'Glen', 'High', 'Iron', 'Kest', 'Luma', 'Mer', 'Nor', 'Orin', 'Port', 'Raven', 'Solar', 'Storm', 'Val'];
const SYLLABLES_B = ['bridge', 'bury', 'dale', 'ford', 'gate', 'haven', 'holm', 'mere', 'mont', 'port', 'ridge', 'stead', 'ton', 'vale', 'wick'];

const PERSON_LOCALES = [de, en, fr, es, it, pt_BR, nl, pl] as const;
const NATIONALITIES = ['Germany', 'England', 'France', 'Spain', 'Italy', 'Brazil', 'Netherlands', 'Poland'] as const;

export interface GeneratedPersonName {
  firstName: string;
  lastName: string;
  nationality: string;
}

export interface WorldBlueprint {
  world: WorldState;
  clubIdentities: ClubIdentity[];
}

export function generatePersonName(seed: number, key: string | number): GeneratedPersonName {
  const index = hash32(`${seed}|locale|${key}`) % PERSON_LOCALES.length;
  const faker = new Faker({ locale: [PERSON_LOCALES[index], en, base] });
  faker.seed(hash32(`${seed}|person|${key}`));
  return {
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    nationality: NATIONALITIES[index],
  };
}

export function generateWorld(seed: number, teamIds: string[], playerClubName: string): WorldBlueprint {
  const rng = new Rng(hash32(`${seed}|world-v1`));
  const countryRoot = uniqueWord(rng, 0);
  const countryName = `${countryRoot}${rng.pick(['ia', 'en', 'ora', 'mark', 'land'])}`;
  const outline = generateOutline(rng);
  const regionCount = rng.int(4, 6);
  const regions = generateRegions(rng, regionCount);
  const cities = generateCities(rng, regions, teamIds);
  const clubIdentities = cities.map((city, index) => ({
    name: index === 0 ? playerClubName : `${city.name} ${CLUB_SUFFIXES[(hash32(`${seed}|club|${index}`) + index) % CLUB_SUFFIXES.length]}`,
    short: index === 0 ? playerClubName.slice(0, 3).toUpperCase() : shortName(city.name, index),
    primary: PRIMARY_COLORS[index % PRIMARY_COLORS.length],
    secondary: SECONDARY_COLORS[index % SECONDARY_COLORS.length],
  }));
  const routes = generateRoutes(cities);
  const rivalries = generateRivalries(cities, routes, teamIds);
  return {
    world: {
      generationVersion: 1,
      seed,
      country: {
        name: countryName,
        demonym: `${countryRoot}ian`,
        leagueName: `${countryRoot} Legends League`,
        flag: {
          primary: PRIMARY_COLORS[rng.int(0, PRIMARY_COLORS.length - 1)],
          secondary: SECONDARY_COLORS[rng.int(0, SECONDARY_COLORS.length - 1)],
          accent: '#ffd34e',
          pattern: rng.pick(['cross', 'bands', 'diagonal', 'star'] as const),
        },
        outline,
      },
      regions,
      cities,
      routes,
      rivalries,
      travelEvents: [],
    },
    clubIdentities,
  };
}

function generateOutline(rng: Rng): WorldPoint[] {
  const points: WorldPoint[] = [];
  const count = 34;
  for (let index = 0; index < count; index++) {
    const angle = index / count * Math.PI * 2;
    const wave = 1 + Math.sin(angle * 3 + rng.float(-0.5, 0.5)) * 0.13 + rng.float(-0.09, 0.09);
    points.push({
      x: snap(480 + Math.cos(angle) * 390 * wave),
      y: snap(300 + Math.sin(angle) * 235 * wave),
    });
  }
  return points;
}

function generateRegions(rng: Rng, count: number): WorldRegion[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2 + rng.float(-0.25, 0.25);
    return {
      id: `region-${index + 1}`,
      name: `${uniqueWord(rng, index + 20)} Reach`,
      color: REGION_COLORS[index % REGION_COLORS.length],
      centre: { x: snap(480 + Math.cos(angle) * rng.float(90, 250)), y: snap(300 + Math.sin(angle) * rng.float(65, 155)) },
    };
  });
}

function generateCities(rng: Rng, regions: WorldRegion[], teamIds: string[]): WorldCity[] {
  const used = new Set<string>();
  return teamIds.map((teamId, index) => {
    const region = regions[index % regions.length];
    let name = uniqueWord(rng, index + 100);
    while (used.has(name)) name = uniqueWord(rng, index + used.size + 200);
    used.add(name);
    return {
      id: `city-${index + 1}`,
      name,
      regionId: region.id,
      teamId,
      position: {
        x: snap(clampMap(region.centre.x + rng.float(-110, 110), 110, 850)),
        y: snap(clampMap(region.centre.y + rng.float(-70, 70), 90, 510)),
      },
      stadiumName: `${name} ${rng.pick(STADIUM_SUFFIXES)}`,
      landmark: rng.pick(LANDMARKS),
      populationBand: rng.pick(['town', 'city', 'city', 'metro'] as const),
    };
  });
}

function generateRoutes(cities: WorldCity[]): TravelRoute[] {
  const delaunay = Delaunay.from(cities, (city) => city.position.x, (city) => city.position.y);
  const pairs = new Set<string>();
  const routes: TravelRoute[] = [];
  cities.forEach((city, index) => {
    for (const neighbour of delaunay.neighbors(index)) {
      const a = Math.min(index, neighbour);
      const b = Math.max(index, neighbour);
      const key = `${a}-${b}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      const other = cities[neighbour];
      const distanceKm = Math.round(Math.hypot(city.position.x - other.position.x, city.position.y - other.position.y) * 1.25);
      routes.push({
        id: `route-${key}`,
        fromCityId: cities[a].id,
        toCityId: cities[b].id,
        distanceKm,
        mode: distanceKm < 180 ? 'bus' : distanceKm <= 420 ? 'train' : 'plane',
      });
    }
  });
  return routes;
}

function generateRivalries(cities: WorldCity[], routes: TravelRoute[], teamIds: string[]): ClubRivalry[] {
  const nearest = [...routes].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 4);
  return nearest.map((route, index) => {
    const cityA = cities.find((city) => city.id === route.fromCityId)!;
    const cityB = cities.find((city) => city.id === route.toCityId)!;
    return {
      teamAId: teamIds[cities.indexOf(cityA)],
      teamBId: teamIds[cities.indexOf(cityB)],
      intensity: (index < 2 ? 3 : 2) as 2 | 3,
      reason: cityA.regionId === cityB.regionId ? 'derby' : 'historic',
    };
  });
}

function uniqueWord(rng: Rng, salt: number): string {
  return `${SYLLABLES_A[(rng.int(0, 1000) + salt) % SYLLABLES_A.length]}${SYLLABLES_B[(rng.int(0, 1000) + salt * 3) % SYLLABLES_B.length]}`;
}

function shortName(name: string, salt: number): string {
  const letters = name.replace(/[^a-z]/gi, '').toUpperCase();
  return `${letters.slice(0, 2)}${letters[(2 + salt) % Math.max(3, letters.length)] ?? 'X'}`.slice(0, 3);
}

function snap(value: number): number {
  return Math.round(value / 4) * 4;
}

function clampMap(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
