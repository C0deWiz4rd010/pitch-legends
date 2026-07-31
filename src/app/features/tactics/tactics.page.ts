import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { FORMATION_TEMPLATES, createFormation } from '../../data/formations';
import { rolesForPosition, getRole } from '../../data/roles';
import { autoFillLineup } from '../../data/generators';
import { effectiveRating, playerName } from '../../core/ratings';
import { ratingColor } from '../../shared/rating-color';
import { Player } from '../../models/player.model';
import { FormationSlot, PlayerInstruction, Tactics } from '../../models/tactics.model';
import {
  Mentality,
  PressingIntensity,
  Tempo,
  Width,
  DefensiveLine,
  BuildUpStyle,
  PassingStyle,
  SupportDuty,
  ForwardRuns,
  MarkingStyle,
} from '../../models/enums';

type Tab = 'lineup' | 'team' | 'setpieces';

@Component({
  selector: 'app-tactics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tactics.page.html',
  styleUrl: './tactics.page.scss',
})
export class TacticsPage {
  protected readonly gs = inject(GameStateService);
  protected readonly ratingColor = ratingColor;
  protected readonly playerName = playerName;
  protected readonly getRole = getRole;

  protected readonly formations = FORMATION_TEMPLATES;
  protected readonly tab = signal<Tab>('lineup');
  protected readonly selectedSlotId = signal<string | null>(null);

  protected readonly team = computed(() => this.gs.playerTeam());
  protected readonly slots = computed(() => this.team()?.formation.slots ?? []);
  protected readonly tactics = computed<Tactics | null>(() => this.team()?.tactics ?? null);

  protected readonly starterIds = computed(
    () => new Set(this.slots().map((s) => s.playerId).filter((id): id is string => !!id)),
  );

  protected readonly bench = computed<Player[]>(() =>
    this.gs.squad().filter((p) => !this.starterIds().has(p.id)),
  );

  protected readonly starters = computed<Player[]>(() =>
    this.slots()
      .map((s) => this.playerById(s.playerId))
      .filter((p): p is Player => !!p),
  );

  protected readonly teamFit = computed(() => {
    const s = this.slots();
    const fits = s.map((slot) => this.slotFit(slot)).filter((f) => f > 0);
    if (!fits.length) return 0;
    return Math.round(fits.reduce((a, b) => a + b, 0) / fits.length);
  });

  protected readonly selectedSlot = computed<FormationSlot | null>(
    () => this.slots().find((s) => s.id === this.selectedSlotId()) ?? null,
  );

  // ── Select options ─────────────────────────────────────────────────────────
  protected readonly mentalities: Mentality[] = ['ultra-defensive', 'defensive', 'balanced', 'attacking', 'ultra-attacking'];
  protected readonly pressings: PressingIntensity[] = ['low', 'medium', 'high', 'gegenpress'];
  protected readonly tempos: Tempo[] = ['slow', 'balanced', 'fast'];
  protected readonly widths: Width[] = ['narrow', 'balanced', 'wide'];
  protected readonly lines: DefensiveLine[] = ['deep', 'medium', 'high'];
  protected readonly buildUps: BuildUpStyle[] = ['play-out-of-defence', 'balanced', 'long-ball'];
  protected readonly passings: PassingStyle[] = ['short', 'mixed', 'direct'];
  protected readonly duties: SupportDuty[] = ['defend', 'support', 'attack'];
  protected readonly runsOpts: ForwardRuns[] = ['rarely', 'mixed', 'often'];
  protected readonly markings: MarkingStyle[] = ['zonal', 'man', 'aggressive'];

  protected playerById(id: string | null): Player | undefined {
    if (!id) return undefined;
    return this.gs.squad().find((p) => p.id === id);
  }

  protected slotPlayer(slot: FormationSlot): Player | undefined {
    return this.playerById(slot.playerId);
  }

  protected slotFit(slot: FormationSlot): number {
    const p = this.slotPlayer(slot);
    if (!p) return 0;
    return Math.round(effectiveRating(p, getRole(slot.roleId), slot.position));
  }

  protected rolesFor(slot: FormationSlot) {
    return rolesForPosition(slot.position);
  }

  protected selectSlot(id: string): void {
    this.selectedSlotId.set(id);
    this.tab.set('lineup');
  }

  protected changeFormation(id: string): void {
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      club.formation = createFormation(id);
      autoFillLineup(club);
    });
    this.selectedSlotId.set(null);
  }

  protected autoFill(): void {
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      autoFillLineup(club);
    });
  }

  protected assignToSelected(playerId: string): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const target = club.formation.slots.find((s) => s.id === slotId);
      if (!target) return;
      // If the player already occupies another slot, swap them.
      const previous = club.formation.slots.find((s) => s.playerId === playerId);
      if (previous) previous.playerId = target.playerId;
      target.playerId = playerId;
    });
  }

  protected clearSlot(): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const target = club.formation.slots.find((s) => s.id === slotId);
      if (target) target.playerId = null;
    });
  }

  protected setRole(roleId: string): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const target = club.formation.slots.find((s) => s.id === slotId);
      if (target) target.roleId = roleId;
    });
  }

  protected setInstruction<K extends keyof PlayerInstruction>(key: K, value: PlayerInstruction[K]): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const target = club.formation.slots.find((s) => s.id === slotId);
      if (target) target.instruction[key] = value;
    });
  }

  protected setTactic<K extends keyof Tactics>(key: K, value: Tactics[K]): void {
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      club.tactics[key] = value;
    });
  }
}
