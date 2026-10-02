export interface Fixture {
  id: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  played: boolean;
  /** Absent on league fixtures of older saves. */
  competition?: 'league' | 'cup';
}

export interface StandingRow {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export function emptyStanding(teamId: string, teamName: string): StandingRow {
  return {
    teamId,
    teamName,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };
}

export interface League {
  id: string;
  name: string;
  season: number;
  currentWeek: number;
  totalWeeks: number;
  teamIds: string[];
  fixtures: Fixture[];
  /** 1 = top flight, 2 = second division. */
  tier: 1 | 2;
}
