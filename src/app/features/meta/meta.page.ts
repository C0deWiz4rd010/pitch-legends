import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACHIEVEMENTS, AchievementGroup, achievementProgress, counterValue } from '../../core/meta/achievements';
import { COSMETIC_SLOTS, COSMETICS, PATH_MAX_LEVEL, isCosmeticUnlocked } from '../../core/meta/legend-path';
import { I18nService } from '../../core/services/i18n.service';
import { GameStateService } from '../../core/services/game-state.service';
import { LegendsService } from '../../core/services/legends.service';
import { MetaService } from '../../core/services/meta.service';
import { CosmeticSlot } from '../../models/meta.model';

type Tab = 'achievements' | 'path' | 'hall';

const GROUPS: { key: AchievementGroup; de: string; en: string }[] = [
  { key: 'skill', de: 'Können', en: 'Skill' },
  { key: 'career', de: 'Karriere', en: 'Career' },
  { key: 'collection', de: 'Sammeln', en: 'Collecting' },
];

const SLOT_LABEL: Record<CosmeticSlot, [string, string]> = {
  boots: ['Schuhfarben', 'Boot colours'],
  cheer: ['Jubel', 'Cheers'],
  ball: ['Balldesigns', 'Ball designs'],
  decor: ['Stadion-Dekor', 'Ground decor'],
  kit: ['Trikotmuster', 'Kit patterns'],
};

/** Achievements, the Legends Path with its rewards and the Hall of Fame: everything the player has done in every mode. */
@Component({
  selector: 'app-meta',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meta.page.html',
  styleUrl: './meta.page.scss',
})
export class MetaPage {
  protected readonly meta = inject(MetaService);
  private readonly i18n = inject(I18nService);
  private readonly gs = inject(GameStateService);
  private readonly legends = inject(LegendsService);
  protected readonly tab = signal<Tab>('achievements');
  protected readonly group = signal<AchievementGroup | 'all'>('all');
  protected readonly groups = GROUPS;
  protected readonly maxLevel = PATH_MAX_LEVEL;
  protected readonly message = signal('');

  protected readonly unlockedCount = computed(() => Object.keys(this.meta.state().unlocked).length);
  protected readonly total = ACHIEVEMENTS.length;

  protected readonly achievements = computed(() => {
    const state = this.meta.state();
    const group = this.group();
    return ACHIEVEMENTS.filter((def) => group === 'all' || def.group === group).map((def) => ({
      id: def.id,
      name: this.text(def.name[0], def.name[1]),
      text: this.text(def.text[0], def.text[1]),
      xp: def.xp,
      unlocked: def.id in state.unlocked,
      percent: Math.round(achievementProgress(state, def) * 100),
      value: Math.min(def.target, counterValue(state, def.counter)),
      target: def.target,
    })).sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.percent - a.percent);
  });

  protected readonly cosmetics = computed(() => {
    const state = this.meta.state();
    return COSMETIC_SLOTS.map((slot) => ({
      slot,
      label: this.text(SLOT_LABEL[slot][0], SLOT_LABEL[slot][1]),
      wornAny: !!state.equipped[slot],
      items: COSMETICS.filter((cosmetic) => cosmetic.slot === slot).map((cosmetic) => ({
        id: cosmetic.id,
        name: this.text(cosmetic.name[0], cosmetic.name[1]),
        level: cosmetic.level,
        unlocked: isCosmeticUnlocked(state, cosmetic),
        worn: state.equipped[slot] === cosmetic.id,
        color: cosmetic.slot === 'boots' ? cosmetic.value : cosmetic.slot === 'decor' && cosmetic.value.startsWith('#') ? cosmetic.value : cosmetic.slot === 'ball' ? cosmetic.value.split('|')[0] : null,
      })),
    }));
  });

  /** The records of the Hall of Fame and the seasons of the current career. */
  protected readonly records = computed(() => {
    const records = this.meta.state().records;
    return [
      { key: 'titles', de: 'Meistertitel', en: 'Titles', value: String(records.titles) },
      { key: 'streak', de: 'Längste Siegesserie (Liga)', en: 'Longest winning run (league)', value: String(records.winStreak) },
      { key: 'rout', de: 'Höchster Sieg (Tordifferenz)', en: 'Biggest win (goal margin)', value: String(records.biggestWin) },
      { key: 'goals', de: 'Meiste Tore in einer Saison', en: 'Most goals in a season', value: String(records.goalsSeason) },
      { key: 'points', de: 'Meiste Punkte in einer Saison', en: 'Most points in a season', value: String(records.pointsSeason) },
      { key: 'level', de: 'Höchstes Spieler-Level', en: 'Highest player level', value: String(records.topLevel) },
      { key: 'division', de: 'Beste Division in Rivals', en: 'Best Rivals division', value: records.legendsDivision >= 10 ? '–' : String(records.legendsDivision) },
      { key: 'draft', de: 'Beste Draft-Runde', en: 'Best draft run', value: `${records.draftWins}/4` },
    ];
  });

  protected readonly seasons = computed(() =>
    [...(this.gs.game()?.archive ?? [])].reverse().map((entry) => ({
      season: entry.season,
      position: entry.club.position,
      tier: entry.club.tier,
      champion: entry.leagues.some((league) => league.championId === entry.club.teamId),
      cup: entry.cupWinnerId === entry.club.teamId,
      levels: entry.rpg?.levelsGained ?? 0,
      evolutions: entry.rpg?.evolutions ?? 0,
      climber: entry.rpg?.topClimber ?? '',
      signature: entry.rpg?.bestSignature ?? '',
    })),
  );

  protected readonly legendsFacts = computed(() => {
    const state = this.legends.state();
    if (!state) return null;
    return { cards: state.cards.length, division: state.rivals.bestDivision, packs: state.packsOpened };
  });

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }

  protected wear(slot: CosmeticSlot, id: string | null): void {
    // Boot colours are picked per player in the player sheet; here they are only opened.
    if (slot === 'boots') { this.message.set(this.text('Die Schuhfarbe wählst du pro Spieler in der Spielerakte.', 'You pick the boot colour per player in the player sheet.')); return; }
    this.message.set(this.meta.equip(slot, id) ? '' : this.text('Das schaltet erst ein höheres Level frei.', 'A higher level opens that.'));
  }
}
