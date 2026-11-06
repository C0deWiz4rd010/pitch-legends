import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EXPECTED_SHARE, answerRoomEvent, roomView, talkToPlayer } from '../../core/career/dressing-room';
import { PERK_ATTRIBUTE_STEP, hasManagerTrait, managerAttribute } from '../../core/career/manager-effects';
import { SIGNING_WEEKS, candidatesFor, dismissStaff, hireStaff, staffEffect, staffWeeklyCost } from '../../core/career/staff';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { RpgService } from '../../core/services/rpg.service';
import { MetaService } from '../../core/services/meta.service';
import { playerName } from '../../core/ratings';
import { roomEventById } from '../../data/dressing-room-events';
import { ManagerAttributes, ManagerPerkPath } from '../../models/game.model';
import { PRESS_QUESTIONS, PRESS_STYLES, REASON_LABEL } from '../../data/press-conference';
import { answerPress, pressOdds } from '../../core/career/press-conference';
import { SUPPLIERS, activeSupplier, signSupplier } from '../../core/career/supplier';
import { SOCIAL_LABEL, socialRole } from '../../core/rpg/social';
import { heatOf, rivalryBetween } from '../../core/career/rivalry';
import { PressStyle } from '../../models/club-life.model';
import { RoomRole } from '../../models/dressing-room.model';
import { STAFF_ROLES, StaffRole, StaffSpecialty } from '../../models/staff.model';
import { ManagerPortraitComponent } from '../../shared/components/manager-portrait.component';
import { formatCoins } from '../../shared/rating-color';

const ATTRIBUTES: { key: keyof ManagerAttributes; de: string; en: string; effect: [string, string] }[] = [
  { key: 'coaching', de: 'Coaching', en: 'Coaching', effect: ['Mehr Erfahrung aus jedem Training', 'More experience from every session'] },
  { key: 'tactics', de: 'Taktik', en: 'Tactics', effect: ['Schnellere taktische Reaktion im Spiel', 'Faster tactical reactions in matches'] },
  { key: 'scouting', de: 'Scouting', en: 'Scouting', effect: ['Günstigere und genauere Berichte', 'Cheaper and more precise reports'] },
  { key: 'leadership', de: 'Führung', en: 'Leadership', effect: ['Teamgeist, Moral und Manager-XP', 'Team spirit, morale and manager XP'] },
  { key: 'negotiation', de: 'Verhandlung', en: 'Negotiation', effect: ['Bessere Vertragskonditionen', 'Better contract terms'] },
  { key: 'youthDevelopment', de: 'Jugend', en: 'Youth', effect: ['Besserer Nachwuchs, mehr Wachstum für Junge', 'A better intake, more growth for the young'] },
  { key: 'media', de: 'Medien', en: 'Media', effect: ['Bessere Chancen in Pressekonferenzen', 'Better odds in press conferences'] },
];

const TRAITS: Record<string, { de: string; en: string; effect: [string, string] }> = {
  calm: { de: 'Besonnen', en: 'Calm', effect: ['Niederlagen kosten weniger Moral und Teamgeist', 'Defeats cost less morale and spirit'] },
  motivator: { de: 'Motivator', en: 'Motivator', effect: ['Siege heben die Moral stärker, der Teamgeist liegt höher', 'Wins lift morale more, spirit settles higher'] },
  analyst: { de: 'Analytiker', en: 'Analyst', effect: ['Scoutaufträge sind eine Woche früher fertig', 'Scout assignments finish a week sooner'] },
  developer: { de: 'Entwickler', en: 'Developer', effect: ['Mehr Trainingserfahrung, besserer Nachwuchs', 'More training experience, a better intake'] },
  'risk-taker': { de: 'Risikofreudig', en: 'Risk-taker', effect: ['Mutige Antworten in der Kabine wirken stärker, in beide Richtungen', 'Bold answers in the dressing room swing further both ways'] },
  negotiator: { de: 'Verhandler', en: 'Negotiator', effect: ['Spielerverträge werden etwas günstiger', 'Player contracts get a little cheaper'] },
};

const ROLE_LABEL: Record<RoomRole, [string, string]> = {
  star: ['Star', 'Star'],
  starter: ['Stammspieler', 'Starter'],
  rotation: ['Rotation', 'Rotation'],
  prospect: ['Talent', 'Prospect'],
  fringe: ['Ergänzung', 'Squad filler'],
};

const STAFF_LABEL: Record<StaffRole, { de: string; en: string; effect: [string, string] }> = {
  assistant: { de: 'Co-Trainer', en: 'Assistant coach', effect: ['Mehr Trainingserfahrung für alle', 'More training experience for everyone'] },
  goalkeeping: { de: 'Torwarttrainer', en: 'Goalkeeping coach', effect: ['Torhüter wachsen schneller', 'Keepers grow faster'] },
  fitness: { de: 'Fitnesstrainer', en: 'Fitness coach', effect: ['Mehr Fitness-Erholung pro Woche', 'More fitness recovered each week'] },
  scout: { de: 'Chefscout', en: 'Chief scout', effect: ['Schnellere und günstigere Scoutberichte', 'Faster and cheaper scout reports'] },
  physio: { de: 'Physio', en: 'Physio', effect: ['Verletzungen heilen etwas schneller', 'Injuries heal a little faster'] },
  youth: { de: 'Jugendtrainer', en: 'Youth coach', effect: ['Besserer Nachwuchs, mehr Wachstum für U22', 'A better intake, more growth for under-22s'] },
};

const SPECIALTY: Record<StaffSpecialty, [string, string]> = {
  technical: ['Technik', 'Technique'],
  physical: ['Athletik', 'Athletics'],
  tactical: ['Taktik', 'Tactics'],
  mental: ['Psyche', 'Mind'],
};

@Component({
  selector: 'app-office',
  imports: [ManagerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './office.page.html',
  styleUrl: './office.page.scss',
})
export class OfficePage {
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  private readonly rpg = inject(RpgService);
  private readonly meta = inject(MetaService);
  protected readonly formatCoins = formatCoins;
  protected readonly message = signal('');
  protected readonly signingWeeks = SIGNING_WEEKS;

  protected readonly manager = this.gs.manager;
  protected readonly attributes = computed(() => {
    const manager = this.manager();
    if (!manager) return [];
    return ATTRIBUTES.map((entry) => {
      const rank = manager.perks[entry.key as ManagerPerkPath] ?? 0;
      return {
        key: entry.key as ManagerPerkPath,
        label: this.text(entry.de, entry.en),
        effect: this.text(entry.effect[0], entry.effect[1]),
        base: manager.attributes[entry.key],
        value: managerAttribute(manager, entry.key),
        rank,
        maxed: rank >= 5,
      };
    });
  });
  protected readonly traits = computed(() => {
    const manager = this.manager();
    return (manager?.traits ?? []).filter((id) => hasManagerTrait(manager!, id) && TRAITS[id]).map((id) => ({
      id,
      label: this.text(TRAITS[id].de, TRAITS[id].en),
      effect: this.text(TRAITS[id].effect[0], TRAITS[id].effect[1]),
    }));
  });
  protected readonly perkStep = PERK_ATTRIBUTE_STEP;
  protected readonly xpShare = computed(() => {
    const manager = this.manager();
    return manager ? Math.min(100, Math.round((manager.xp / Math.max(1, manager.xpToNext)) * 100)) : 0;
  });

  protected readonly room = computed(() => this.gs.game()?.dressingRoom ?? null);
  protected readonly spirit = computed(() => Math.round(this.room()?.spirit ?? 0));
  protected readonly spiritLabel = computed(() => {
    const value = this.spirit();
    return value >= 75 ? this.text('Eine Einheit', 'One unit') : value >= 55 ? this.text('Gute Stimmung', 'Good mood') : value >= 35 ? this.text('Angespannt', 'Tense') : this.text('Zerstritten', 'Divided');
  });
  protected readonly event = computed(() => {
    const state = this.room()?.event;
    const def = state ? roomEventById(state.eventId) : undefined;
    if (!state || !def) return null;
    const coins = this.gs.coins();
    return {
      state,
      title: this.text(def.title[0], def.title[1]),
      body: this.text(def.body[0], def.body[1]),
      options: def.options.map((option) => ({ label: this.text(option.label[0], option.label[1]), affordable: (option.effect.coins ?? 0) >= 0 || coins >= -(option.effect.coins ?? 0) })),
    };
  });
  protected readonly squad = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return roomView(game).map((entry) => ({
      id: entry.player.id,
      name: playerName(entry.player),
      overall: entry.player.overall,
      role: this.text(ROLE_LABEL[entry.role][0], ROLE_LABEL[entry.role][1]),
      expected: Math.round(entry.expected * 100),
      played: Math.round(entry.played * 100),
      unhappyWeeks: entry.unhappyWeeks,
      unhappy: entry.unhappyWeeks > 0,
      requested: entry.requested,
      canTalk: (entry.unhappyWeeks > 0 || entry.requested) && game.dressingRoom?.talked[entry.player.id] !== game.league.season,
      shortOfTime: entry.expected > 0 && entry.played < entry.expected * 0.5,
      social: ((role) => (role ? this.text(SOCIAL_LABEL[role].name[0], SOCIAL_LABEL[role].name[1]) : ''))(socialRole(entry.player)),
      partner: this.partnerName(entry.player.id),
    }));
  });

  private partnerName(playerId: string): string {
    const club = this.gs.playerTeam();
    const link = club?.partners?.[playerId];
    const partner = link ? club?.players.find((candidate) => candidate.id === link.partnerId) : undefined;
    return partner ? playerName(partner) : '';
  }

  /** The press conference before a big match: the question, the three answers with their odds, or what the last one did. */
  protected readonly press = computed(() => {
    const game = this.gs.game();
    const conference = game?.press?.current;
    if (!game || !conference) return null;
    const opponent = game.teams.find((team) => team.id === conference.opponentId)?.name ?? '—';
    const question = PRESS_QUESTIONS[conference.question] ?? PRESS_QUESTIONS[0];
    return {
      reason: this.text(REASON_LABEL[conference.reason][0], REASON_LABEL[conference.reason][1]),
      question: this.text(question.text[0], question.text[1]).replace('{opponent}', opponent),
      answered: conference.answer !== null,
      outcome: conference.outcome ?? null,
      answers: PRESS_STYLES.map((style) => {
        const odds = pressOdds(game, conference.reason, style.id);
        return { id: style.id, label: this.text(style.label[0], style.label[1]), quote: this.text(style.quote[0], style.quote[1]), chance: Math.round(odds.chance * 100), chosen: conference.answer === style.id };
      }),
    };
  });

  protected answerPress(style: PressStyle): void {
    let text = '';
    this.gs.mutate((draft) => {
      const result = answerPress(draft, style);
      if (result.ok) this.meta.record({ type: 'press' });
      text = !result.ok ? this.text('Hier wartet keine Pressekonferenz.', 'No press conference is waiting.') : result.success ? this.text('Die Antwort kam gut an.', 'The answer went down well.') : this.text('Die Antwort ging nach hinten los.', 'The answer backfired.');
    });
    this.message.set(text);
  }

  /** Kit suppliers: the deal in force and what is on offer. */
  protected readonly suppliers = computed(() => {
    const game = this.gs.game();
    const club = this.gs.playerTeam();
    if (!game || !club) return [];
    const active = activeSupplier(game).id;
    return SUPPLIERS.map((supplier) => ({
      id: supplier.id,
      name: this.text(supplier.name[0], supplier.name[1]),
      text: this.text(supplier.text[0], supplier.text[1]),
      fee: supplier.weeklyFee,
      tier: supplier.tier,
      active: supplier.id === active,
      locked: club.reputation < supplier.minReputation,
      minReputation: supplier.minReputation,
      canSign: supplier.id !== 'basic' && active === 'basic' && club.reputation >= supplier.minReputation,
    }));
  });

  protected signSupplier(id: string): void {
    let text = '';
    this.gs.mutate((draft) => {
      const result = signSupplier(draft, id);
      text = result.ok ? this.text('Vertrag unterschrieben. Die Schuhe der Spieler wirken stärker.', 'Contract signed. The boots of your players now give more.') : result.reason === 'running' ? this.text('Es läuft schon ein Vertrag.', 'A contract is already running.') : this.text('Dafür reicht der Ruf des Vereins nicht.', 'The reputation of the club is not enough for that.');
    });
    this.message.set(text);
  }

  /** The rivalries of the club and how hot each one is. */
  protected readonly rivalries = computed(() => {
    const game = this.gs.game();
    const club = this.gs.playerTeam();
    if (!game || !club) return [];
    return club.rivalTeamIds.flatMap((id) => {
      const rivalry = rivalryBetween(game, club.id, id);
      const team = game.teams.find((candidate) => candidate.id === id);
      return rivalry && team ? [{ id, name: team.name, heat: Math.round(heatOf(rivalry)), level: rivalry.intensity }] : [];
    });
  });
  protected readonly requests = computed(() => this.room()?.requests.length ?? 0);

  protected readonly weeklyCost = computed(() => { const game = this.gs.game(); return game ? staffWeeklyCost(game) : 0; });
  protected readonly staff = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return STAFF_ROLES.map((role) => {
      const member = game.staff?.members[role];
      return {
        role,
        label: this.text(STAFF_LABEL[role].de, STAFF_LABEL[role].en),
        effect: this.text(STAFF_LABEL[role].effect[0], STAFF_LABEL[role].effect[1]),
        member: member ? { name: `${member.firstName} ${member.lastName}`, rating: member.rating, salary: member.salary, specialty: this.text(SPECIALTY[member.specialty][0], SPECIALTY[member.specialty][1]), help: Math.round(staffEffect(game, role) * 100) } : null,
        candidates: candidatesFor(game, role).map((candidate) => ({ id: candidate.id, name: `${candidate.firstName} ${candidate.lastName}`, rating: candidate.rating, salary: candidate.salary, specialty: this.text(SPECIALTY[candidate.specialty][0], SPECIALTY[candidate.specialty][1]), fee: candidate.salary * SIGNING_WEEKS, affordable: this.gs.coins() >= candidate.salary * SIGNING_WEEKS })),
      };
    });
  });

  protected unlockPerk(path: ManagerPerkPath): void {
    let unlocked = false;
    this.gs.mutate((draft) => (unlocked = this.rpg.unlockManagerPerk(draft.manager, path)));
    this.message.set(this.i18n.t(unlocked ? 'settings.perkUnlocked' : 'settings.noSkillPoint'));
  }

  protected answer(option: 0 | 1): void {
    let outcome = '';
    this.gs.mutate((draft) => {
      const result = answerRoomEvent(draft, option);
      if (!result.ok) { outcome = result.error; return; }
      if (result.xp) this.rpg.awardManagerXp(draft.manager, result.xp);
    });
    this.message.set(outcome === 'budget' ? this.text('Dafür fehlt das Geld.', 'You cannot afford that.') : outcome ? this.text('Dazu gibt es keine offene Entscheidung.', 'There is no open decision.') : this.text('Antwort gegeben. Die Kabine hat reagiert.', 'Answer given. The dressing room has reacted.'));
  }

  protected talk(playerId: string): void {
    let text = '';
    this.gs.mutate((draft) => {
      const result = talkToPlayer(draft, playerId);
      text = !result.ok ? (result.error === 'talked' ? this.text('Mit ihm hast du diese Saison schon gesprochen.', 'You already spoke to him this season.') : this.text('Hier gibt es nichts zu klären.', 'Nothing to settle here.')) : result.success ? this.text('Das Gespräch hat geholfen.', 'The talk helped.') : this.text('Er bleibt unzufrieden.', 'He stays unhappy.');
    });
    this.message.set(text);
  }

  protected hire(candidateId: string): void {
    let text = '';
    this.gs.mutate((draft) => {
      const result = hireStaff(draft, candidateId);
      if (result.ok) this.meta.record({ type: 'staff-hired' });
      text = result.ok ? this.text('Verpflichtet.', 'Signed.') : result.reason === 'budget' ? this.text('Dafür fehlt das Geld.', 'You cannot afford that.') : this.text('Bewerber nicht mehr verfügbar.', 'Applicant no longer available.');
    });
    this.message.set(text);
  }

  protected dismiss(role: StaffRole): void {
    this.gs.mutate((draft) => void dismissStaff(draft, role));
    this.message.set(this.text('Entlassen.', 'Released.'));
  }

  protected expectedShare(role: RoomRole): number { return Math.round(EXPECTED_SHARE[role] * 100); }
  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
}
