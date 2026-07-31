import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
  { path: 'squad', loadComponent: () => import('./features/squad/squad.page').then((m) => m.SquadPage) },
  { path: 'tactics', loadComponent: () => import('./features/tactics/tactics.page').then((m) => m.TacticsPage) },
  { path: 'training', loadComponent: () => import('./features/training/training.page').then((m) => m.TrainingPage) },
  { path: 'match', loadComponent: () => import('./features/match/match.page').then((m) => m.MatchPage) },
  { path: 'transfer', loadComponent: () => import('./features/transfer/transfer.page').then((m) => m.TransferPage) },
  { path: 'league', loadComponent: () => import('./features/league/league.page').then((m) => m.LeaguePage) },
  { path: 'facilities', loadComponent: () => import('./features/facilities/facilities.page').then((m) => m.FacilitiesPage) },
  { path: 'settings', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: '' },
];
