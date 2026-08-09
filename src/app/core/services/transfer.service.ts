import { Injectable, computed, inject } from '@angular/core';
import { Player } from '../../models/player.model';
import { Position } from '../../models/enums';
import { generatePlayer } from '../../data/generators';
import { Rng, clamp } from '../util';
import { GameStateService } from './game-state.service';

const MARKET_POSITIONS: { position: Position; alts: Position[] }[] = [
  { position: 'GK', alts: [] },
  { position: 'CB', alts: ['RCB', 'LCB'] },
  { position: 'RB', alts: ['RWB'] },
  { position: 'LB', alts: ['LWB'] },
  { position: 'CDM', alts: ['CM'] },
  { position: 'CM', alts: ['CAM', 'CDM'] },
  { position: 'CAM', alts: ['CM'] },
  { position: 'RW', alts: ['RM'] },
  { position: 'LW', alts: ['LM'] },
  { position: 'ST', alts: ['CF'] },
];

export const MAX_SQUAD_SIZE = 26;
const REFRESH_COST = 15000;

@Injectable({ providedIn: 'root' })
export class TransferService {
  private readonly gs = inject(GameStateService);
  private rng = new Rng();
  readonly market = computed<Player[]>(() => this.gs.game()?.transferMarket ?? []);

  ensureMarket(): void {
    const game = this.gs.game();
    if (!game) return;
    const weekKey = game.league.season * 100 + game.league.currentWeek;
    if (game.transferMarketWeek === weekKey && game.transferMarket.length) return;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      draft.transferMarket = this.generatePlayers(14, club.facilities.youthAcademy);
      draft.transferMarketWeek = weekKey;
    });
  }

  generateMarket(size = 14): void {
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      draft.transferMarket = this.generatePlayers(size, club.facilities.youthAcademy);
      draft.transferMarketWeek = draft.league.season * 100 + draft.league.currentWeek;
    });
  }

  private generatePlayers(size: number, academyLevel: number): Player[] {
    const players: Player[] = [];
    for (let i = 0; i < size; i++) {
      const slot = this.rng.pick(MARKET_POSITIONS);
      const target = clamp(Math.round(this.rng.gaussian(64 + academyLevel, 11)), 46, 91);
      const player = generatePlayer(this.rng, slot.position, slot.alts, target, this.rng.int(2, 39));
      if (academyLevel >= 3 && this.rng.bool(0.35)) player.age = this.rng.int(17, 22);
      players.push(player);
    }
    players.sort((a, b) => b.overall - a.overall);
    return players;
  }

  /** Refresh scouting for a coin fee. Returns false if unaffordable. */
  refresh(): boolean {
    const club = this.gs.playerTeam();
    if (!club || club.coins < REFRESH_COST) return false;
    this.rng = new Rng(Date.now() >>> 0);
    this.gs.mutate((draft) => {
      const c = draft.teams.find((t) => t.id === draft.clubId)!;
      c.coins -= REFRESH_COST;
      draft.transferMarket = this.generatePlayers(14, c.facilities.youthAcademy);
      draft.transferMarketWeek = draft.league.season * 100 + draft.league.currentWeek;
    });
    return true;
  }

  get refreshCost(): number {
    return REFRESH_COST;
  }

  canBuy(player: Player): { ok: boolean; reason?: string } {
    const club = this.gs.playerTeam();
    if (!club) return { ok: false, reason: 'No club.' };
    if (club.players.length >= MAX_SQUAD_SIZE) return { ok: false, reason: 'Squad is full.' };
    if (club.coins < player.marketValue) return { ok: false, reason: 'Not enough coins.' };
    return { ok: true };
  }

  buy(player: Player): boolean {
    const check = this.canBuy(player);
    if (!check.ok) return false;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      club.coins -= player.marketValue;
      // Assign a free kit number.
      const used = new Set(club.players.map((p) => p.kitNumber));
      let kit = player.kitNumber;
      while (used.has(kit)) kit = clamp(kit + 1, 1, 99);
      club.players.push({ ...structuredClone(player), kitNumber: kit });
      draft.transferMarket = draft.transferMarket.filter((candidate) => candidate.id !== player.id);
    });
    return true;
  }

  /** Sell a squad player for ~90% of value. Cannot sell below a minimum squad size. */
  sell(playerId: string): boolean {
    const club = this.gs.playerTeam();
    if (!club || club.players.length <= 14) return false;
    const player = club.players.find((p) => p.id === playerId);
    if (!player) return false;
    this.gs.mutate((draft) => {
      const c = draft.teams.find((t) => t.id === draft.clubId)!;
      const fee = Math.round(player.marketValue * 0.9);
      c.coins += fee;
      c.players = c.players.filter((p) => p.id !== playerId);
      // Clear from any formation slot & set-piece roles.
      c.formation.slots.forEach((s) => {
        if (s.playerId === playerId) s.playerId = null;
      });
      if (c.tactics.captainId === playerId) c.tactics.captainId = null;
      if (c.tactics.penaltyTakerId === playerId) c.tactics.penaltyTakerId = null;
      if (c.tactics.freeKickTakerId === playerId) c.tactics.freeKickTakerId = null;
      if (c.tactics.cornerTakerId === playerId) c.tactics.cornerTakerId = null;
    });
    return true;
  }
}
