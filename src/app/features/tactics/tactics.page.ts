import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import {
  analyzeTactics,
  applyTacticPreset,
  detectTacticPreset,
  rankSetPieceTakers,
  setPieceScore,
  SetPieceType,
  TacticPresetId,
} from '../../core/tactics-analysis';
import { effectiveRating, groupForPosition, playerName } from '../../core/ratings';
import { FORMATION_TEMPLATES, createFormation } from '../../data/formations';
import { autoFillLineup } from '../../data/generators';
import { getRole, rolesForPosition } from '../../data/roles';
import {
  BuildUpStyle,
  DefensiveLine,
  ForwardRuns,
  MarkingStyle,
  Mentality,
  PassingStyle,
  Position,
  PressingIntensity,
  SupportDuty,
  Tempo,
  Width,
} from '../../models/enums';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { Formation, FormationSlot, PlayerInstruction, Tactics, defaultInstruction } from '../../models/tactics.model';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { ratingColor } from '../../shared/rating-color';

type InspectorTab = 'lineup' | 'idea' | 'roles' | 'setpieces';
type MobileView = 'pitch' | 'inspector';
type TacticalSnapshot = { formation: Formation; tactics: Tactics };

@Component({
  selector: 'app-tactics',
  imports: [PlayerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tactics.page.html',
  styleUrl: './tactics.page.scss',
})
export class TacticsPage {
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  protected readonly ratingColor = ratingColor;
  protected readonly playerName = playerName;
  protected readonly getRole = getRole;
  protected readonly formations = FORMATION_TEMPLATES;

  protected readonly tab = signal<InspectorTab>('lineup');
  protected readonly mobileView = signal<MobileView>('pitch');
  protected readonly selectedSlotId = signal<string | null>(null);
  protected readonly shapeEdit = signal(false);
  protected readonly undoSnapshot = signal<TacticalSnapshot | null>(null);

  protected readonly team = computed(() => this.gs.playerTeam());
  protected readonly slots = computed(() => this.team()?.formation.slots ?? []);
  protected readonly tactics = computed<Tactics | null>(() => this.team()?.tactics ?? null);
  protected readonly activePreset = computed<TacticPresetId>(() => {
    const tactics = this.tactics();
    return tactics ? detectTacticPreset(tactics) : 'custom';
  });
  protected readonly analysis = computed(() => {
    const team = this.team();
    return team ? analyzeTactics(team) : null;
  });
  protected readonly starterIds = computed(
    () => new Set(this.slots().map((slot) => slot.playerId).filter((id): id is string => !!id)),
  );
  protected readonly bench = computed(() =>
    this.gs.squad().filter((player) => !this.starterIds().has(player.id)),
  );
  protected readonly starters = computed(() =>
    this.slots().map((slot) => this.playerById(slot.playerId)).filter((player): player is Player => !!player),
  );
  protected readonly selectedSlot = computed(
    () => this.slots().find((slot) => slot.id === this.selectedSlotId()) ?? null,
  );
  protected readonly teamFit = computed(() => {
    const fit = this.slots().map((slot) => this.slotFit(slot)).filter(Boolean);
    return fit.length ? Math.round(fit.reduce((sum, value) => sum + value, 0) / fit.length) : 0;
  });

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
  protected readonly presetIds: Exclude<TacticPresetId, 'custom'>[] = ['balanced', 'possession', 'gegenpress', 'counter', 'low-block'];
  protected readonly analysisKeys = ['attack', 'control', 'defence', 'transition', 'fitnessLoad', 'risk'] as const;
  protected readonly setPieceTypes: SetPieceType[] = ['captain', 'penalty', 'freeKick', 'corner'];

  protected text(de: string, en: string): string {
    return this.i18n.locale() === 'de' ? de : en;
  }

  protected playerById(id: string | null): Player | undefined {
    return id ? this.gs.squad().find((player) => player.id === id) : undefined;
  }

  protected slotPlayer(slot: FormationSlot): Player | undefined {
    return this.playerById(slot.playerId);
  }

  protected slotFit(slot: FormationSlot): number {
    const player = this.slotPlayer(slot);
    return player ? Math.round(effectiveRating(player, getRole(slot.roleId), slot.position)) : 0;
  }

  protected rolesFor(slot: FormationSlot) {
    return rolesForPosition(slot.position);
  }

  protected selectSlot(id: string, openInspector = false): void {
    this.selectedSlotId.set(id);
    if (openInspector) {
      this.tab.set('lineup');
      this.mobileView.set('inspector');
    }
  }

  protected changeFormation(id: string): void {
    this.mutateWithUndo((club) => {
      club.formation = createFormation(id);
      autoFillLineup(club);
    });
    this.selectedSlotId.set(null);
  }

  protected autoFill(): void {
    this.mutateWithUndo((club) => autoFillLineup(club));
  }

  protected resetFormation(): void {
    const team = this.team();
    if (!team) return;
    const assignments = team.formation.slots.map((slot) => slot.playerId);
    this.mutateWithUndo((club) => {
      const reset = createFormation(club.formation.id);
      reset.slots.forEach((slot, index) => slot.playerId = assignments[index] ?? null);
      club.formation = reset;
    });
  }

  protected undo(): void {
    const snapshot = this.undoSnapshot();
    if (!snapshot) return;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((team) => team.id === draft.clubId);
      if (!club) return;
      club.formation = structuredClone(snapshot.formation);
      club.tactics = structuredClone(snapshot.tactics);
    });
    this.undoSnapshot.set(null);
  }

  protected applyPreset(id: Exclude<TacticPresetId, 'custom'>): void {
    this.mutateWithUndo((club) => club.tactics = applyTacticPreset(club.tactics, id));
  }

  protected assignToSelected(playerId: string): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.mutateWithUndo((club) => this.assignPlayer(club, slotId, playerId));
  }

  protected clearSlot(): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.mutateWithUndo((club) => {
      const slot = club.formation.slots.find((candidate) => candidate.id === slotId);
      if (slot) slot.playerId = null;
    });
  }

  protected beginSlotDrag(slot: FormationSlot, event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `slot:${slot.id}`);
  }

  protected beginPlayerDrag(player: Player, event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `player:${player.id}`);
  }

  protected allowDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  protected dropOnSlot(targetId: string, event: DragEvent): void {
    event.preventDefault();
    const payload = event.dataTransfer?.getData('text/plain') ?? '';
    if (payload.startsWith('player:')) {
      this.mutateWithUndo((club) => this.assignPlayer(club, targetId, payload.slice(7)));
      return;
    }
    if (payload.startsWith('slot:') && !this.shapeEdit()) {
      const sourceId = payload.slice(5);
      if (sourceId === targetId) return;
      this.mutateWithUndo((club) => {
        const source = club.formation.slots.find((slot) => slot.id === sourceId);
        const target = club.formation.slots.find((slot) => slot.id === targetId);
        if (!source || !target) return;
        [source.playerId, target.playerId] = [target.playerId, source.playerId];
      });
    }
  }

  protected dropShape(event: DragEvent): void {
    event.preventDefault();
    if (!this.shapeEdit()) return;
    const payload = event.dataTransfer?.getData('text/plain') ?? '';
    if (!payload.startsWith('slot:')) return;
    const pitch = event.currentTarget as HTMLElement;
    const rect = pitch.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.moveSlot(payload.slice(5), x, y);
  }

  protected onSlotKeydown(slot: FormationSlot, event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectSlot(slot.id, true);
      return;
    }
    if (!this.shapeEdit() || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const delta = event.shiftKey ? 0.06 : 0.02;
    const x = slot.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0);
    const y = slot.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0);
    this.moveSlot(slot.id, x, y);
  }

  protected setRole(roleId: string): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.mutateWithUndo((club) => {
      const slot = club.formation.slots.find((candidate) => candidate.id === slotId);
      if (!slot) return;
      const role = getRole(roleId);
      slot.roleId = roleId;
      slot.instruction.duty = role.defaultDuty;
    });
  }

  protected setInstruction<K extends keyof PlayerInstruction>(key: K, value: PlayerInstruction[K]): void {
    const slotId = this.selectedSlotId();
    if (!slotId) return;
    this.mutateWithUndo((club) => {
      const slot = club.formation.slots.find((candidate) => candidate.id === slotId);
      if (slot) slot.instruction[key] = value;
    });
  }

  protected setTactic<K extends keyof Tactics>(key: K, value: Tactics[K]): void {
    this.mutateWithUndo((club) => club.tactics[key] = value);
  }

  protected setPieceValue(type: SetPieceType): string | null {
    const tactics = this.tactics();
    if (!tactics) return null;
    return tactics[this.setPieceKey(type)];
  }

  protected setSetPiece(type: SetPieceType, playerId: string): void {
    this.setTactic(this.setPieceKey(type), playerId || null);
  }

  protected setPieceRanking(type: SetPieceType): Player[] {
    return rankSetPieceTakers(this.starters(), type);
  }

  protected setPieceScore(player: Player, type: SetPieceType): number {
    return Math.round(setPieceScore(player, type));
  }

  protected presetLabel(id: TacticPresetId): string {
    const labels: Record<TacticPresetId, [string, string]> = {
      balanced: ['Ausgewogen', 'Balanced'],
      possession: ['Ballbesitz', 'Possession'],
      gegenpress: ['Gegenpress', 'Gegenpress'],
      counter: ['Konter', 'Counter'],
      'low-block': ['Tiefblock', 'Low block'],
      custom: ['Individuell', 'Custom'],
    };
    return this.text(...labels[id]);
  }

  protected analysisLabel(key: typeof this.analysisKeys[number]): string {
    const labels: Record<typeof this.analysisKeys[number], readonly [string, string]> = {
      attack: ['Angriff', 'Attack'], control: ['Kontrolle', 'Control'], defence: ['Defensive', 'Defence'],
      transition: ['Umschalten', 'Transition'], fitnessLoad: ['Fitnesslast', 'Fitness load'], risk: ['Risiko', 'Risk'],
    } as const;
    const label = labels[key];
    return this.text(label[0], label[1]);
  }

  protected tacticLabel(value: string): string {
    const dictionary: Record<string, [string, string]> = {
      'ultra-defensive': ['Sehr defensiv', 'Ultra defensive'], defensive: ['Defensiv', 'Defensive'], balanced: ['Ausgewogen', 'Balanced'],
      attacking: ['Offensiv', 'Attacking'], 'ultra-attacking': ['Sehr offensiv', 'Ultra attacking'], low: ['Niedrig', 'Low'],
      medium: ['Mittel', 'Medium'], high: ['Hoch', 'High'], gegenpress: ['Gegenpress', 'Gegenpress'], slow: ['Langsam', 'Slow'],
      fast: ['Schnell', 'Fast'], narrow: ['Eng', 'Narrow'], wide: ['Breit', 'Wide'], deep: ['Tief', 'Deep'],
      'play-out-of-defence': ['Kurz eröffnen', 'Play out'], 'long-ball': ['Langer Ball', 'Long ball'], short: ['Kurz', 'Short'],
      mixed: ['Gemischt', 'Mixed'], direct: ['Direkt', 'Direct'], defend: ['Absichern', 'Defend'], support: ['Unterstützen', 'Support'],
      attack: ['Angreifen', 'Attack'], rarely: ['Selten', 'Rarely'], often: ['Oft', 'Often'], zonal: ['Raumdeckung', 'Zonal'],
      man: ['Manndeckung', 'Man marking'], aggressive: ['Aggressiv', 'Aggressive'],
    };
    return dictionary[value] ? this.text(...dictionary[value]) : value;
  }

  protected setPieceLabel(type: SetPieceType): string {
    const labels: Record<SetPieceType, [string, string]> = {
      captain: ['Kapitän', 'Captain'], penalty: ['Elfmeter', 'Penalties'], freeKick: ['Freistoß', 'Free kicks'], corner: ['Ecken', 'Corners'],
    };
    return this.text(...labels[type]);
  }

  private setPieceKey(type: SetPieceType): 'captainId' | 'penaltyTakerId' | 'freeKickTakerId' | 'cornerTakerId' {
    const keys = { captain: 'captainId', penalty: 'penaltyTakerId', freeKick: 'freeKickTakerId', corner: 'cornerTakerId' } as const;
    return keys[type];
  }

  private moveSlot(slotId: string, rawX: number, rawY: number): void {
    this.mutateWithUndo((club) => {
      const slot = club.formation.slots.find((candidate) => candidate.id === slotId);
      if (!slot) return;
      const group = groupForPosition(slot.position);
      const [minX, maxX] = group === 'GK' ? [0.02, 0.16] : group === 'DEF' ? [0.14, 0.36] : group === 'MID' ? [0.34, 0.68] : [0.62, 0.94];
      slot.x = snap(Math.max(minX, Math.min(maxX, rawX)));
      slot.y = snap(Math.max(0.08, Math.min(0.92, rawY)));
      const mirrored = mirrorPosition(slot.position, slot.y);
      if (mirrored !== slot.position) {
        slot.position = mirrored;
        const availableRoles = rolesForPosition(mirrored);
        if (!availableRoles.some((role) => role.id === slot.roleId)) {
          const fallback = availableRoles[0];
          slot.roleId = fallback.id;
          slot.instruction = defaultInstruction(fallback.defaultDuty);
        }
      }
    });
  }

  private assignPlayer(club: Team, targetId: string, playerId: string): void {
    const target = club.formation.slots.find((slot) => slot.id === targetId);
    if (!target) return;
    const previous = club.formation.slots.find((slot) => slot.playerId === playerId);
    if (previous) previous.playerId = target.playerId;
    target.playerId = playerId;
  }

  private mutateWithUndo(mutator: (club: Team) => void): void {
    const current = this.team();
    if (!current) return;
    this.undoSnapshot.set({ formation: structuredClone(current.formation), tactics: structuredClone(current.tactics) });
    this.gs.mutate((draft) => {
      const club = draft.teams.find((team) => team.id === draft.clubId);
      if (club) mutator(club);
    });
  }
}

function snap(value: number): number {
  return Math.round(value / 0.02) * 0.02;
}

function mirrorPosition(position: Position, y: number): Position {
  const leftToRight: Partial<Record<Position, Position>> = { LB: 'RB', LWB: 'RWB', LCB: 'RCB', LM: 'RM', LW: 'RW' };
  const rightToLeft: Partial<Record<Position, Position>> = { RB: 'LB', RWB: 'LWB', RCB: 'LCB', RM: 'LM', RW: 'LW' };
  return y > 0.5 ? leftToRight[position] ?? position : rightToLeft[position] ?? position;
}
