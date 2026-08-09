import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { GameStateService } from '../../core/services/game-state.service';
import { RpgService } from '../../core/services/rpg.service';
import { AttributeKey, ATTRIBUTE_KEYS, ATTRIBUTE_LABELS } from '../../models/enums';
import { attributeUpgradeCost } from '../../core/progression';
import { RadarChartComponent } from './radar-chart.component';
import { ratingColor, moraleIcon } from '../rating-color';
import { TRAITS, getTrait } from '../../data/traits';
import { DevelopmentPlan, Trait } from '../../models/player.model';
import { TalentNode } from '../../data/talents';
import { PlayerPortraitComponent } from './player-portrait.component';
import { PlayerPaperDollComponent } from './player-paper-doll.component';

@Component({
  selector: 'app-player-detail',
  imports: [RadarChartComponent, DecimalPipe, PlayerPortraitComponent, PlayerPaperDollComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './player-detail.component.html',
  styleUrl: './player-detail.component.scss',
})
export class PlayerDetailComponent {
  private readonly gs = inject(GameStateService);
  private readonly rpg = inject(RpgService);

  readonly playerId = input.required<string>();
  readonly close = output<void>();

  protected readonly attrKeys = ATTRIBUTE_KEYS;
  protected readonly labels = ATTRIBUTE_LABELS;
  protected readonly ratingColor = ratingColor;
  protected readonly moraleIcon = moraleIcon;
  protected readonly developmentPlans: DevelopmentPlan[] = ['balanced', 'technical', 'physical', 'position'];

  protected readonly player = computed(() => this.gs.squad().find((p) => p.id === this.playerId()) ?? null);
  protected readonly currentKit = computed(() => this.gs.playerTeam()?.visuals.kits.home ?? null);

  protected readonly xpPercent = computed(() => {
    const p = this.player();
    if (!p) return 0;
    return Math.min(100, Math.round((p.xp / p.xpToNext) * 100));
  });

  protected readonly ownedTraits = computed<Trait[]>(() =>
    (this.player()?.traitIds ?? [])
      .map((id) => getTrait(id))
      .filter((t): t is Trait => !!t),
  );

  protected readonly lockedTraits = computed(() => {
    const p = this.player();
    if (!p) return [];
    return TRAITS.filter((t) => !p.traitIds.includes(t.id));
  });

  protected readonly talents = computed<TalentNode[]>(() => {
    const player = this.player();
    return player ? this.rpg.availableTalents(player) : [];
  });

  protected costFor(attr: AttributeKey): number {
    const p = this.player();
    return p ? attributeUpgradeCost(p.attributes[attr]) : 0;
  }

  protected canUpgrade(attr: AttributeKey): boolean {
    const p = this.player();
    if (!p) return false;
    return p.skillPoints >= this.costFor(attr) && p.attributes[attr] < 99;
  }

  protected upgrade(attr: AttributeKey): void {
    const id = this.playerId();
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId);
      const target = club?.players.find((p) => p.id === id);
      if (target) this.rpg.upgradeAttribute(target, attr);
    });
  }

  protected unlockTrait(traitId: string): void {
    const id = this.playerId();
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId);
      const target = club?.players.find((p) => p.id === id);
      if (target) this.rpg.unlockTrait(target, traitId);
    });
  }

  protected canUnlock(traitId: string): boolean {
    const p = this.player();
    const trait = getTrait(traitId);
    if (!p || !trait) return false;
    return p.level >= trait.unlockLevel && p.skillPoints >= 4;
  }

  protected setDevelopmentPlan(plan: DevelopmentPlan): void {
    const id = this.playerId();
    this.gs.mutate((draft) => {
      const player = draft.teams.find((team) => team.id === draft.clubId)?.players.find((candidate) => candidate.id === id);
      if (player) player.developmentPlan = plan;
    });
  }

  protected unlockTalent(talentId: string): void {
    const id = this.playerId();
    this.gs.mutate((draft) => {
      const player = draft.teams.find((team) => team.id === draft.clubId)?.players.find((candidate) => candidate.id === id);
      if (player) this.rpg.unlockTalent(player, talentId);
    });
  }

  protected canUnlockTalent(talent: TalentNode): boolean {
    const player = this.player();
    if (!player) return false;
    return player.level >= talent.unlockLevel && player.skillPoints >= talent.cost && (player.talentRanks[talent.id] ?? 0) < talent.maxRank;
  }
}
