import { Player } from './player.model';

export type TransferKind = 'permanent' | 'loan';
export type NegotiationDirection = 'incoming' | 'outgoing';
export type NegotiationStatus =
  | 'draft'
  | 'submitted'
  | 'countered'
  | 'fee-agreed'
  | 'contract'
  | 'accepted'
  | 'rejected'
  | 'expired';
export type SquadRole = 'prospect' | 'rotation' | 'starter' | 'star';

export interface TransferTargetRef {
  playerId: string;
  teamId: string | null;
  addedWeek: number;
}

export interface ScoutingReport {
  playerId: string;
  season: number;
  createdWeek: number;
  confidence: number;
  overallMin: number;
  overallMax: number;
  potentialMin: number;
  potentialMax: number;
  exact: boolean;
}

export interface ContractProposal {
  weeks: 52 | 104 | 156 | 208;
  salary: number;
  squadRole: SquadRole;
  signingBonus: number;
}

export interface TransferNegotiation {
  id: string;
  playerId: string;
  fromTeamId: string | null;
  toTeamId: string;
  direction: NegotiationDirection;
  kind: TransferKind;
  status: NegotiationStatus;
  fee: number;
  requestedFee: number;
  loanFee: number;
  wageShare: 50 | 100;
  buyOption: number | null;
  contract: ContractProposal | null;
  clubCounterUsed: boolean;
  agentCounterUsed: boolean;
  createdWeek: number;
  expiresWeek: number;
  message: string;
}

export interface TransferListing {
  playerId: string;
  teamId: string;
  askingPrice: number;
  loanAvailable: boolean;
  createdWeek: number;
}

export interface LoanDeal {
  id: string;
  playerId: string;
  parentTeamId: string;
  borrowerTeamId: string;
  startSeason: number;
  startWeek: number;
  endSeason: number;
  wageShare: 50 | 100;
  fee: number;
  buyOption: number | null;
  active: boolean;
}

export interface TransferRecord {
  id: string;
  playerId: string;
  playerName: string;
  fromTeamId: string | null;
  toTeamId: string;
  kind: TransferKind | 'free-agent' | 'loan-return';
  fee: number;
  season: number;
  week: number;
}

export interface TransferActivity {
  id: string;
  season: number;
  week: number;
  tone: 'info' | 'success' | 'warning';
  text: string;
}

export interface TransferState {
  season: number;
  week: number;
  freeAgents: Player[];
  shortlist: TransferTargetRef[];
  reports: ScoutingReport[];
  negotiations: TransferNegotiation[];
  listings: TransferListing[];
  loans: LoanDeal[];
  history: TransferRecord[];
  activity: TransferActivity[];
}

export function emptyTransferState(season = 1, week = 1): TransferState {
  return {
    season,
    week,
    freeAgents: [],
    shortlist: [],
    reports: [],
    negotiations: [],
    listings: [],
    loans: [],
    history: [],
    activity: [],
  };
}
