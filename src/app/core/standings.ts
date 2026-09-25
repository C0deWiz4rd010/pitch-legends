import { Fixture, StandingRow, emptyStanding } from '../models/league.model';

/** League table: points, goal difference, goals scored, then name — the single tie-break used everywhere. */
export function computeStandings(teams: readonly { id: string; name: string }[], fixtures: readonly Fixture[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  teams.forEach((team) => rows.set(team.id, emptyStanding(team.id, team.name)));
  for (const fixture of fixtures) {
    if (!fixture.played || fixture.homeScore == null || fixture.awayScore == null) continue;
    const home = rows.get(fixture.homeTeamId);
    const away = rows.get(fixture.awayTeamId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.goalsFor += fixture.homeScore;
    home.goalsAgainst += fixture.awayScore;
    away.goalsFor += fixture.awayScore;
    away.goalsAgainst += fixture.homeScore;
    if (fixture.homeScore > fixture.awayScore) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (fixture.homeScore < fixture.awayScore) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
      b.goalsFor - a.goalsFor ||
      a.teamName.localeCompare(b.teamName),
  );
}
