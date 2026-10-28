import { getQuirk } from '../../data/quirks';
import { REVEAL_EVERY, careerTotal } from '../../core/rpg/quirks';
import { buildBio, chronicleLine } from '../../core/rpg/story';
import { getSignature } from '../../data/signatures';
import { dnaOf } from '../../core/rpg/player-dna';
import { I18nService } from '../../core/services/i18n.service';
import { Player } from '../../models/player.model';
import { RarityGemComponent } from './rarity-gem.component';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ModalDirective } from '../modal.directive';
import { DecimalPipe } from '@angular/common';
import { GameStateService } from '../../core/services/game-state.service';
import { RpgService } from '../../core/services/rpg.service';
import { AttributeKey, ATTRIBUTE_KEYS, ATTRIBUTE_LABELS } from '../../models/enums';
import { attributeUpgradeCost } from '../../core/progression';
import { RadarChartComponent } from './radar-chart.component';
import { ratingColor, moraleIcon } from '../rating-color';
import { TRAITS, getTrait } from '../../data/traits';
import { DevelopmentPlan, RehabPlan, Trait } from '../../models/player.model';
import { TalentNode } from '../../data/talents';
import { PlayerPortraitComponent } from './player-portrait.component';
import { PlayerPaperDollComponent } from './player-paper-doll.component';
import { MedicalService } from '../../core/services/medical.service';

@Component({
  selector: 'app-player-detail',
  imports: [RadarChartComponent, DecimalPipe, PlayerPortraitComponent, PlayerPaperDollComponent, ModalDirective, RarityGemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './player-detail.component.html',
  styleUrl: './player-detail.component.scss',
})
export class PlayerDetailComponent {
  protected readonly gs = inject(GameStateService);
  private readonly rpg = inject(RpgService);
  private readonly medical = inject(MedicalService);

  readonly playerId = input.required<string>();
  readonly close = output<void>();

  protected readonly attrKeys = ATTRIBUTE_KEYS;
  protected readonly labels = ATTRIBUTE_LABELS;
  protected readonly ratingColor = ratingColor;
  protected readonly moraleIcon = moraleIcon;
  protected readonly developmentPlans: DevelopmentPlan[] = ['balanced', 'technical', 'physical', 'position'];

  protected readonly i18n = inject(I18nService);

  /** Frame colour class of the sheet: Common stays plain. */
  protected frameRarity(player: Player): string {
    return dnaOf(player).rarity;
  }

  /** The signatures of a player as cards: name, what it does, when it wakes up and how strong it is. */
  protected signatureCards(player: Player) {
    return (dnaOf(player).signatures ?? []).map((signature) => {
      const definition = getSignature(signature.id);
      const trigger = definition?.trigger;
      const when = !trigger ? '' : trigger.kind === 'condition'
        ? this.i18n.pick('Situationsabhängig', 'While the situation lasts')
        : this.i18n.pick(`Löst aus: ${signatureEvent(trigger.event, 'de')} · ${trigger.seconds} s · Abklingzeit ${trigger.cooldown} s`, `Wakes on: ${signatureEvent(trigger.event, 'en')} · ${trigger.seconds} s · cooldown ${trigger.cooldown} s`);
      return {
        id: signature.id,
        name: this.i18n.pick(signature.name[0], signature.name[1]),
        text: definition ? this.i18n.pick(definition.text[0], definition.text[1]) : '',
        when,
        power: Math.round(signature.power * 100),
        level: signature.level,
        passive: trigger?.kind === 'condition',
      };
    });
  }

  /** Quirks as cards; hidden ones show only a "???" until they are discovered. */
  protected quirkCards(player: Player) {
    const quirks = dnaOf(player).quirks ?? [];
    const revealed = quirks.filter((quirk) => quirk.revealed).length;
    const untilNext = Math.max(1, REVEAL_EVERY * (revealed + 1) - careerTotal(player, 'appearances'));
    return quirks.map((quirk) => {
      const definition = quirk.revealed ? getQuirk(quirk.id) : undefined;
      return {
        revealed: quirk.revealed,
        name: definition ? this.i18n.pick(definition.name[0], definition.name[1]) : '???',
        plus: definition ? this.i18n.pick(definition.plus[0], definition.plus[1]) : '',
        minus: definition ? this.i18n.pick(definition.minus[0], definition.minus[1]) : '',
        hint: quirk.revealed ? '' : this.i18n.pick(`Wird nach etwa ${untilNext} Einsätzen entdeckt`, `Discovered in about ${untilNext} appearances`),
      };
    });
  }

  protected bio(player: Player): string {
    const game = this.gs.game();
    return game ? buildBio(player, game, this.i18n.locale() === 'de' ? 'de' : 'en') : '';
  }

  /** The chronicle, newest first, as readable lines with the season and week. */
  protected chronicle(player: Player) {
    const language = this.i18n.locale() === 'de' ? 'de' : 'en';
    return [...(dnaOf(player).chronicle ?? [])].reverse().map((entry) => ({
      when: `S${entry.season} · ${this.i18n.pick('Woche', 'Week')} ${entry.week}`,
      text: chronicleLine(entry, language),
    }));
  }

  protected nickname(player: Player): string | null {
    const nick = dnaOf(player).nickname;
    return nick ? this.i18n.pick(nick[0], nick[1]) : null;
  }

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

  protected setRehab(plan: RehabPlan): void {
    this.medical.setPlan(this.playerId(), plan);
  }
}

const EVENT_LABELS: Record<string, [string, string]> = {
  ballWon: ['Ballgewinn', 'ball won'],
  ballLost: ['Ballverlust', 'ball lost'],
  passReceived: ['Passannahme', 'pass received'],
  skillWon: ['gewonnenes Dribbling', 'won dribble'],
  shotAgainst: ['Schuss auf das eigene Tor', 'shot at own goal'],
  bigChanceAgainst: ['Großchance des Gegners', 'big chance against'],
};

function signatureEvent(event: string, language: 'de' | 'en'): string {
  const pair = EVENT_LABELS[event];
  return pair ? pair[language === 'de' ? 0 : 1] : event;
}
