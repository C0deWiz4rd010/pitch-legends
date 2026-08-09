import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  TRAINING_DRILLS,
  TrainingDrill,
  TrainingExecutionResult,
  TrainingService,
} from '../../core/services/training.service';
import { PositionGroup } from '../../models/enums';
import {
  TrainingIntensity,
  TrainingScope,
  TrainingSessionPlan,
  TrainingSessionResult,
} from '../../models/game.model';
import { Player } from '../../models/player.model';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { ratingColor } from '../../shared/rating-color';

type TrainingTab = 'programs' | 'schedule' | 'players';
type PlayerFilter = 'ALL' | PositionGroup;

@Component({
  selector: 'app-training',
  imports: [PlayerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './training.page.html',
  styleUrl: './training.page.scss',
})
export class TrainingPage {
  protected readonly gs = inject(GameStateService);
  private readonly training = inject(TrainingService);
  private readonly i18n = inject(I18nService);
  protected readonly ratingColor = ratingColor;
  protected readonly drills = TRAINING_DRILLS;
  protected readonly intensities: TrainingIntensity[] = ['light', 'normal', 'intense'];
  protected readonly filters: PlayerFilter[] = ['ALL', 'GK', 'DEF', 'MID', 'ATT'];
  protected readonly weekSlots = [0, 1, 2] as const;

  protected readonly mobileTab = signal<TrainingTab>('schedule');
  protected readonly activeDrillId = signal(TRAINING_DRILLS[0].id);
  protected readonly plans = signal<TrainingSessionPlan[]>([]);
  protected readonly selectedSlot = signal<0 | 1 | 2>(0);
  protected readonly playerFilter = signal<PlayerFilter>('ALL');
  protected readonly feedback = signal('');

  protected readonly team = computed(() => this.gs.playerTeam());
  protected readonly trainingGround = computed(() => this.team()?.facilities.trainingGround ?? 1);
  protected readonly selectedPlan = computed(() => this.plans().find((plan) => plan.slot === this.selectedSlot()) ?? null);
  protected readonly activeDrill = computed(() => this.drill(this.activeDrillId()) ?? TRAINING_DRILLS[0]);
  protected readonly preview = computed(() => {
    const state = this.gs.game();
    return state ? this.training.preview(state, this.plans()) : { valid: false, errors: ['game-missing'], sessions: [] };
  });
  protected readonly completed = computed(() => this.gs.game()?.trainingWeek.completedSessions ?? []);
  protected readonly squad = computed(() => {
    const filter = this.playerFilter();
    return [...this.gs.squad()]
      .filter((player) => filter === 'ALL' || player.positionGroup === filter)
      .sort((a, b) => b.overall - a.overall || b.potential - a.potential);
  });
  protected readonly targetGroup = computed<PositionGroup | null>(() => {
    const plan = this.selectedPlan();
    if (!plan || plan.scope !== 'unit' || !plan.targetIds.length) return null;
    return this.playerById(plan.targetIds[0])?.positionGroup ?? null;
  });

  protected text(de: string, en: string): string {
    return this.i18n.locale() === 'de' ? de : en;
  }

  protected drill(id: string): TrainingDrill | undefined {
    return this.training.drill(id);
  }

  protected selectDrill(drill: TrainingDrill): void {
    this.activeDrillId.set(drill.id);
    const selected = this.selectedPlan();
    if (selected) {
      this.updatePlan(selected.slot, (plan) => ({ ...plan, drillId: drill.id, intensity: drill.focus === 'recovery' ? 'light' : plan.intensity }));
    }
  }

  protected addSession(): void {
    const completedSlots = new Set(this.completed().map((session) => session.plan.slot));
    const plannedSlots = new Set(this.plans().map((plan) => plan.slot));
    const slot = ([0, 1, 2] as const).find((candidate) => !completedSlots.has(candidate) && !plannedSlots.has(candidate));
    if (slot === undefined) {
      this.feedback.set(this.text('Alle drei Einheiten sind bereits belegt.', 'All three sessions are already occupied.'));
      return;
    }
    const state = this.gs.game();
    const plan: TrainingSessionPlan = {
      id: `training-${state?.league.season ?? 1}-${state?.league.currentWeek ?? 1}-${slot}`,
      slot,
      drillId: this.activeDrillId(),
      scope: 'individual',
      intensity: this.activeDrill().focus === 'recovery' ? 'light' : 'normal',
      targetIds: [],
    };
    this.plans.update((plans) => [...plans, plan].sort((a, b) => a.slot - b.slot));
    this.selectedSlot.set(slot);
    this.mobileTab.set('players');
    this.feedback.set('');
  }

  protected chooseSlot(slot: 0 | 1 | 2): void {
    this.selectedSlot.set(slot);
    const plan = this.plans().find((candidate) => candidate.slot === slot);
    if (plan) this.activeDrillId.set(plan.drillId);
  }

  protected removePlan(slot: 0 | 1 | 2): void {
    this.plans.update((plans) => plans.filter((plan) => plan.slot !== slot));
    this.feedback.set('');
  }

  protected setScope(scope: TrainingScope): void {
    const plan = this.selectedPlan();
    if (!plan) return;
    this.updatePlan(plan.slot, (current) => ({ ...current, scope, targetIds: scope === 'individual' ? current.targetIds.slice(0, 1) : current.targetIds }));
  }

  protected setIntensity(intensity: TrainingIntensity): void {
    const plan = this.selectedPlan();
    if (plan) this.updatePlan(plan.slot, (current) => ({ ...current, intensity }));
  }

  protected toggleTarget(player: Player): void {
    const plan = this.selectedPlan();
    if (!plan || !this.canTarget(player)) return;
    this.updatePlan(plan.slot, (current) => {
      if (current.scope === 'individual') return { ...current, targetIds: [player.id] };
      const exists = current.targetIds.includes(player.id);
      const targetIds = exists ? current.targetIds.filter((id) => id !== player.id) : [...current.targetIds, player.id].slice(0, 5);
      return { ...current, targetIds };
    });
  }

  protected canTarget(player: Player): boolean {
    const plan = this.selectedPlan();
    if (!plan) return false;
    const drill = this.drill(plan.drillId);
    if (player.injuryWeeks > 0 && drill?.focus !== 'recovery') return false;
    const group = this.targetGroup();
    return plan.scope !== 'unit' || !group || group === player.positionGroup || plan.targetIds.includes(player.id);
  }

  protected isTarget(playerId: string): boolean {
    return this.selectedPlan()?.targetIds.includes(playerId) ?? false;
  }

  protected execute(): void {
    const currentPreview = this.preview();
    if (!currentPreview.valid) {
      this.feedback.set(this.errorLabel(currentPreview.errors[0] ?? 'plan-invalid'));
      return;
    }
    let result: TrainingExecutionResult = { ok: false, errors: ['plan-invalid'], sessions: [] };
    this.gs.mutate((draft) => result = this.training.executePlan(draft, this.plans()));
    if (result.ok) {
      this.plans.set([]);
      this.feedback.set(this.text('Wochenplan erfolgreich ausgeführt.', 'Weekly plan completed successfully.'));
      this.mobileTab.set('schedule');
    } else {
      this.feedback.set(this.errorLabel(result.errors[0] ?? 'plan-invalid'));
    }
  }

  protected planFor(slot: number): TrainingSessionPlan | undefined {
    return this.plans().find((plan) => plan.slot === slot);
  }

  protected completedFor(slot: number): TrainingSessionResult | undefined {
    return this.completed().find((session) => session.plan.slot === slot);
  }

  protected sessionPreview(plan: TrainingSessionPlan) {
    return this.preview().sessions.find((session) => session.plan.id === plan.id);
  }

  protected playerById(id: string): Player | undefined {
    return this.gs.squad().find((player) => player.id === id);
  }

  protected xpPercent(player: Player): number {
    return Math.min(100, Math.round((player.xp / player.xpToNext) * 100));
  }

  protected drillName(drill: TrainingDrill): string {
    const labels: Record<string, [string, string]> = {
      finishing: ['Abschluss', 'Finishing'], vision: ['Spielübersicht', 'Vision'], control: ['Ballkontrolle', 'Close control'],
      tackling: ['Zweikampf', 'Tackling'], sprints: ['Sprints', 'Sprints'], strength: ['Kraft', 'Strength'],
      endurance: ['Ausdauer', 'Endurance'], handling: ['Torwarttraining', 'Shot stopping'], recovery: ['Regeneration', 'Recovery'],
    };
    const label = labels[drill.id] ?? [drill.name, drill.name];
    return this.text(label[0], label[1]);
  }

  protected drillDescription(drill: TrainingDrill): string {
    const labels: Record<string, [string, string]> = {
      finishing: ['Abschlüsse unter Druck und saubere Schusstechnik.', drill.description], vision: ['Passwinkel, Timing und Spielverlagerungen.', drill.description],
      control: ['Erster Kontakt, enge Führung und Ballbehauptung.', drill.description], tackling: ['Stellungsspiel, Timing und Balleroberung.', drill.description],
      sprints: ['Antritt, Höchsttempo und explosive Läufe.', drill.description], strength: ['Robustheit, Balance und Kopfballduelle.', drill.description],
      endurance: ['Belastbarkeit für intensive Spielphasen.', drill.description], handling: ['Reflexe, Fangsicherheit und Stellungsspiel.', drill.description],
      recovery: ['Aktive Erholung: +30 Fitness, ohne XP oder Risiko.', drill.description],
    };
    const label = labels[drill.id] ?? [drill.description, drill.description];
    return this.text(label[0], label[1]);
  }

  protected intensityLabel(value: TrainingIntensity): string {
    return ({ light: this.text('Leicht', 'Light'), normal: this.text('Normal', 'Normal'), intense: this.text('Intensiv', 'Intense') })[value];
  }

  protected errorLabel(code: string): string {
    const plain = code.split(':')[0];
    const labels: Record<string, [string, string]> = {
      'plan-empty': ['Füge mindestens eine Einheit zum Wochenplan hinzu.', 'Add at least one session to the weekly plan.'],
      'slots-exceeded': ['Es sind nicht genügend Trainingsslots frei.', 'Not enough training slots remain.'],
      'slot-occupied': ['Mindestens eine Einheit wurde bereits abgeschlossen.', 'At least one session slot is already completed.'],
      'individual-count': ['Individualtraining benötigt genau einen Spieler.', 'Individual training needs exactly one player.'],
      'unit-count': ['Eine Gruppe benötigt drei bis fünf Spieler.', 'A unit needs three to five players.'],
      'unit-group': ['Alle Gruppenspieler müssen derselben Positionsgruppe angehören.', 'All unit players must share a position group.'],
      injured: ['Verletzte Spieler dürfen nur regenerieren.', 'Injured players may only recover.'],
      'already-trained': ['Ein Spieler darf nur eine Entwicklungseinheit pro Woche erhalten.', 'A player may only take one development session per week.'],
      fitness: ['Für intensives Training sind mindestens 55 Fitness nötig.', 'Intense training requires at least 55 fitness.'],
      'target-invalid': ['Mindestens ein Zielspieler ist nicht mehr verfügbar.', 'At least one target player is no longer available.'],
      'plan-invalid': ['Der Wochenplan ist noch nicht vollständig.', 'The weekly plan is not complete yet.'],
    };
    const label = labels[plain] ?? ['Prüfe den Trainingsplan.', 'Review the training plan.'];
    return this.text(label[0], label[1]);
  }

  private updatePlan(slot: number, update: (plan: TrainingSessionPlan) => TrainingSessionPlan): void {
    this.plans.update((plans) => plans.map((plan) => plan.slot === slot ? update(plan) : plan));
    this.feedback.set('');
  }
}
