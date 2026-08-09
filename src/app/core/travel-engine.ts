import { GameState } from '../models/game.model';
import { TravelEvent, TravelEventChoice, TravelEffect } from '../models/world.model';
import { hash32 } from './visual-identity';
import { Rng, clamp } from './util';
import { applyInjury, createInjury, isPlayerAvailable } from './injury-engine';

const CATEGORIES: TravelEvent['category'][] = ['traffic', 'weather', 'fans', 'media', 'bonding', 'scouting', 'sponsor'];

export function prepareTravelEvent(state: GameState): TravelEvent | null {
  const fixture = state.league.fixtures.find((candidate) => candidate.week === state.league.currentWeek && !candidate.played && (candidate.homeTeamId === state.clubId || candidate.awayTeamId === state.clubId));
  if (!fixture || fixture.homeTeamId === state.clubId) return null;
  const existing = state.world.travelEvents.find((event) => event.fixtureId === fixture.id);
  if (existing) return existing;
  const roll = hash32(`${state.world.seed}|travel|${state.league.season}|${fixture.id}`) / 0xffffffff;
  if (roll >= .65) return null;
  const rng = new Rng(hash32(`${fixture.id}|event-v1`));
  const category = rng.pick(CATEGORIES);
  const homeCity = state.world.cities.find((city) => city.teamId === fixture.homeTeamId);
  const awayCity = state.world.cities.find((city) => city.teamId === fixture.awayTeamId);
  const distance = homeCity && awayCity ? Math.round(Math.hypot(homeCity.position.x - awayCity.position.x, homeCity.position.y - awayCity.position.y) * 1.25) : 120;
  const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
  const starterIds = team.formation.slots.map((slot) => slot.playerId).filter((id): id is string => !!id);
  const benchIds = team.players.filter((player) => !starterIds.includes(player.id) && player.injuryWeeks === 0).slice(0, 5).map((player) => player.id);
  const event: TravelEvent = {
    id: `travel-${hash32(`${fixture.id}|${category}`).toString(36)}`,
    fixtureId: fixture.id,
    season: state.league.season,
    week: state.league.currentWeek,
    category,
    titleKey: `travel.${category}.title`,
    bodyKey: `travel.${category}.body`,
    params: { city: homeCity?.name ?? 'Away City', distance, mode: distance < 180 ? 'BUS' : distance <= 420 ? 'TRAIN' : 'PLANE' },
    choices: choicesFor(category),
    selectedChoiceId: null,
    resolved: false,
    affectedPlayerIds: [...starterIds, ...benchIds],
  };
  state.world.travelEvents.push(event);
  return event;
}

export function resolveTravelEvent(state: GameState, eventId: string, choiceId?: string): boolean {
  const event = state.world.travelEvents.find((candidate) => candidate.id === eventId);
  if (!event || event.resolved) return false;
  const choice = event.choices.find((candidate) => candidate.id === choiceId) ?? event.choices.find((candidate) => candidate.safe) ?? event.choices[0];
  const club = state.teams.find((team) => team.id === state.clubId);
  if (!choice || !club) return false;
  for (const player of club.players.filter((candidate) => event.affectedPlayerIds.includes(candidate.id))) {
    player.fitness = clamp(player.fitness + choice.effect.fitness, 0, 100);
    player.morale = clamp(player.morale + choice.effect.morale, 0, 100);
  }
  club.coins = Math.max(0, club.coins + choice.effect.coins);
  if (choice.effect.injuryRisk > 0) {
    const rng = new Rng(hash32(`${event.id}|${choice.id}|travel-injury`));
    const candidates = club.players.filter((player) => event.affectedPlayerIds.includes(player.id) && isPlayerAvailable(player));
    if (candidates.length && rng.bool(choice.effect.injuryRisk)) {
      const player = rng.pick(candidates);
      applyInjury(player, createInjury({ seed: rng.snapshot(), player, cause: 'travel', season: state.league.season, week: state.league.currentWeek, severityBias: -.2 }));
    }
  }
  event.selectedChoiceId = choice.id;
  event.resolved = true;
  state.news.unshift({
    id: `news-${event.id}`,
    week: state.league.currentWeek,
    icon: 'route',
    titleKey: event.titleKey,
    bodyKey: 'travel.resolved.body',
    params: { ...event.params, choice: choice.labelKey },
  });
  state.news = state.news.slice(0, 20);
  return true;
}

function choicesFor(category: TravelEvent['category']): TravelEventChoice[] {
  const safe = effect(-1, 1, 0, false, 0);
  const bold = category === 'scouting' ? effect(-3, 1, -4000, true, 0) : category === 'sponsor' ? effect(-2, 2, 12000, false, 0) : effect(-3, 4, 0, false, .04);
  const recovery = effect(3, -1, -6000, false, 0);
  return [
    { id: 'safe', labelKey: 'travel.choice.safe', effect: safe, safe: true },
    { id: 'bold', labelKey: `travel.choice.${category}`, effect: bold, safe: false },
    { id: 'recover', labelKey: 'travel.choice.recover', effect: recovery, safe: false },
  ];
}

function effect(fitness: number, morale: number, coins: number, scoutReport: boolean, injuryRisk: number): TravelEffect {
  return { fitness, morale, coins, scoutReport, injuryRisk };
}
