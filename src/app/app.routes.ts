import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'players', loadComponent: () => import('./features/match/player-lab.page').then(m => m.PlayerLabPage) },
  { path: 'play', loadComponent: () => import('./features/match/match.page').then((m) => m.MatchPage) },
  { path: '', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
  { path: 'squad', loadComponent: () => import('./features/squad/squad.page').then((m) => m.SquadPage) },
  { path: 'tactics', loadComponent: () => import('./features/tactics/tactics.page').then((m) => m.TacticsPage) },
  { path: 'training', loadComponent: () => import('./features/training/training.page').then((m) => m.TrainingPage) },
  { path: 'match', loadComponent: () => import('./features/match/match.page').then((m) => m.MatchPage) },
  { path: 'transfer', loadComponent: () => import('./features/transfer/transfer.page').then((m) => m.TransferPage) },
  { path: 'league', loadComponent: () => import('./features/league/league.page').then((m) => m.LeaguePage) },
  { path: 'modes', loadComponent: () => import('./features/modes/modes.page').then((m) => m.ModesPage) },
  { path: 'quick', loadComponent: () => import('./features/quick/quick.page').then((m) => m.QuickPage) },
  { path: 'challenges', loadComponent: () => import('./features/challenges/challenges.page').then((m) => m.ChallengesPage) },
  { path: 'legends', loadComponent: () => import('./features/legends/legends.page').then((m) => m.LegendsPage) },
  { path: 'academy', loadComponent: () => import('./features/academy/academy.page').then((m) => m.AcademyPage) },
  { path: 'finances', loadComponent: () => import('./features/finances/finances.page').then((m) => m.FinancesPage) },
  { path: 'season-review', loadComponent: () => import('./features/season-review/season-review.page').then((m) => m.SeasonReviewPage) },
  { path: 'facilities', loadComponent: () => import('./features/facilities/facilities.page').then((m) => m.FacilitiesPage) },
  { path: 'settings', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: '' },
];
