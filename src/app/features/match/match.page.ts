import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  NgZone,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { SeasonService } from '../../core/services/season.service';
import { MatchEngineService } from '../../core/services/match-engine.service';
import { MatchCheckpointService } from '../../core/services/match-checkpoint.service';
import {
  AssistPreset,
  EMPTY_MATCH_COMMAND,
  InputDevice,
  MatchCheckpoint,
  MatchCommand,
  MatchEvent,
  MatchMode,
  MatchRenderState,
  MatchResult,
  MatchViewState,
  MatchWeather,
} from '../../models/match.model';
import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import { Mentality, PressingIntensity, Width } from '../../models/enums';
import { ratingColor } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';
import { I18nService } from '../../core/services/i18n.service';
import { ARCADE_MATCH_TUNING, ArcadeMatch, MATCH_TICK } from '../../core/services/arcade-match';
import { ArcadePitchRenderer } from './arcade-renderer';
import { AudioService } from '../../core/services/audio.service';
import { ControlHelpService } from '../../core/services/control-help.service';
import { CONTROL_INPUT_MAP, MOVEMENT_KEYS } from '../../data/control-bindings';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { MiniKitComponent } from '../../shared/components/mini-kit.component';
import { ManagerPortraitComponent } from '../../shared/components/manager-portrait.component';
import { TravelService } from '../../core/services/travel.service';
import { BufferedButton, TickInputBuffer } from '../../core/football/tick-input';
import { MatchMetrics } from '../../core/football/match-metrics';
import { createPracticeTeams } from '../../core/football/practice';
import { interpolateThreeReplay } from './three-render-state';
import type { ThreePitchRenderer } from './three-pitch.renderer';

type PagePhase = 'preview' | 'intro' | 'simulating' | 'match' | 'halftime' | 'result';
type TouchAction = 'sprint' | 'pass' | 'through' | 'lob' | 'shoot' | 'skill' | 'switch';

const EMPTY_MATCH_VIEW: MatchViewState = {
  footballMinute: 0,
  homeScore: 0,
  awayScore: 0,
  phase: 'preMatch',
  rulePhase: 'kickoff',
  momentumHome: 50,
  controlledPlayerId: '',
  controlledFitness: 100,
  controllerMode: 'human',
  eventRevision: 0,
};

@Component({
  selector: 'app-match',
  host: { '[class.practice-mode]': 'practice' },
  imports: [RouterLink, DecimalPipe, ClubCrestComponent, MiniKitComponent, ManagerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './match.page.html',
  styleUrl: './match.page.scss',
})
export class MatchPage implements OnDestroy {
  protected readonly gs = inject(GameStateService);
  private readonly season = inject(SeasonService);
  private readonly engine = inject(MatchEngineService);
  private readonly checkpoints = inject(MatchCheckpointService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly practice = this.route.snapshot.routeConfig?.path === 'play';
  private readonly practiceTeams = this.practice ? createPracticeTeams() : null;
  private readonly matchFixture = computed(() => this.practice ? { id: 'practice-20260905', week: 1 } : this.gs.nextFixture());
  protected readonly graphicsLoading = signal(false);
  protected readonly graphicsError = signal('');
  private startingRenderer = false;
  private disposed = false;
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly inputBuffer = new TickInputBuffer();
  private readonly metrics = new MatchMetrics();
  protected readonly i18n = inject(I18nService);
  private readonly audio = inject(AudioService);
  private readonly travel = inject(TravelService);
  protected readonly controlHelp = inject(ControlHelpService);
  protected readonly ratingColor = ratingColor;
  protected readonly playerName = playerName;
  protected readonly homeManager = computed(() => this.homeTeam() ? this.gs.managerForTeam(this.homeTeam()!.id) ?? null : null);
  protected readonly awayManager = computed(() => this.awayTeam() ? this.gs.managerForTeam(this.awayTeam()!.id) ?? null : null);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('pitch');
  protected readonly phase = signal<PagePhase>('preview');
  protected readonly result = signal<MatchResult | null>(null);
  protected readonly revealed = signal<MatchEvent[]>([]);
  protected readonly selectedMode = signal<MatchMode>('play');
  protected readonly assist = signal<AssistPreset>('balanced');
  protected readonly playerLock = signal(false);
  protected readonly playerLockId = signal('');
  protected readonly resumeOffer = signal<MatchCheckpoint | null>(null);
  protected readonly playing = signal(true);
  protected readonly speed = signal(1);
  protected readonly flash = signal<string | null>(null);
  protected readonly performanceMessage = signal('');
  protected readonly inputDevice = signal<InputDevice>('keyboard');
  protected readonly autoEnabled = signal(false);
  protected readonly fullscreenActive = signal(false);
  protected readonly matchView = signal<MatchViewState>(EMPTY_MATCH_VIEW);
  protected readonly committing = signal(false);
  protected readonly showSubs = signal(false);
  protected readonly showTactics = signal(false);
  protected readonly subOutId = signal('');
  protected readonly subInId = signal('');
  protected readonly touchX = signal(0);
  protected readonly touchY = signal(0);
  private readonly touchActions = signal<Record<TouchAction, boolean>>({
    sprint: false,
    pass: false,
    through: false,
    lob: false,
    shoot: false,
    skill: false,
    switch: false,
  });

  private arcade: ArcadeMatch | null = null;
  private renderer: ArcadePitchRenderer | ThreePitchRenderer | null = null;
  private raf = 0;
  private lastTs = 0;
  private fixedAccumulator = 0;
  private previousRenderState: MatchRenderState | null = null;
  private currentRenderState: MatchRenderState | null = null;
  private lastViewSync = 0;
  private lastSimulationCost = 0;
  private lastMetricsAt = 0;
  private replayElapsed = 0;
  private prevHome = 0;
  private prevAway = 0;
  private previousRule = '';
  private lastAudioEvent = 0;
  private introTimer: ReturnType<typeof setTimeout> | null = null;
  private gamepadSeen = false;
  private touchPointer: number | null = null;
  private touchOrigin = { x: 0, y: 0 };
  private readonly keys = new Set<string>();
  private readonly edgeKeys = new Set<string>();
  private readonly touchEdges = new Set<TouchAction>();
  private pausedForHelp = false;
  private previousLearningPass = false;
  private pendingPassAttempt = -1;
  private readonly autoStartRequested = this.route.snapshot.queryParamMap.get('auto') === '1';
  private readonly instantStartRequested = this.route.snapshot.queryParamMap.get('mode') === 'instant';

  protected readonly mentalities: Mentality[] = ['ultra-defensive', 'defensive', 'balanced', 'attacking', 'ultra-attacking'];
  protected readonly pressings: PressingIntensity[] = ['low', 'medium', 'high', 'gegenpress'];
  protected readonly widths: Width[] = ['narrow', 'balanced', 'wide'];
  protected readonly assists: AssistPreset[] = ['assisted', 'balanced', 'manual'];

  protected readonly homeTeam = computed<Team | null>(() => {
    if (this.practiceTeams) return this.practiceTeams.home;
    const result = this.result();
    const fixture = this.gs.nextFixture();
    return this.gs.teamById(result?.homeTeamId ?? fixture?.homeTeamId ?? '') ?? null;
  });
  protected readonly awayTeam = computed<Team | null>(() => {
    if (this.practiceTeams) return this.practiceTeams.away;
    const result = this.result();
    const fixture = this.gs.nextFixture();
    return this.gs.teamById(result?.awayTeamId ?? fixture?.awayTeamId ?? '') ?? null;
  });
  protected readonly controlledTeam = computed(() => this.practiceTeams?.home ?? this.gs.playerTeam());
  protected readonly opponent = computed(() => {
    const club = this.controlledTeam();
    return this.homeTeam()?.id === club?.id ? this.awayTeam() : this.homeTeam();
  });
  protected readonly isHome = computed(() => this.homeTeam()?.id === this.controlledTeam()?.id);
  protected readonly minute = computed(() => this.result() ? 90 : this.matchView().footballMinute);
  protected readonly homeScore = computed(() => this.result()?.homeScore ?? this.matchView().homeScore);
  protected readonly awayScore = computed(() => this.result()?.awayScore ?? this.matchView().awayScore);
  protected readonly matchPhase = computed(() => this.matchView().phase);
  protected readonly tickerEvents = computed(() => [...this.revealed()].reverse());
  protected readonly momentumHome = computed(() => this.matchView().momentumHome);
  protected readonly expectedWeather = computed<MatchWeather>(() => {
    const fixture = this.gs.nextFixture();
    if (!fixture) return 'clear';
    const roll = this.stableSeed(fixture.id) % 10;
    return roll < 6 ? 'clear' : roll < 9 ? 'rain' : 'storm';
  });
  protected readonly lineupErrors = computed(() => this.validateLineup(this.controlledTeam()));
  protected readonly starters = computed(() => {
    const team = this.controlledTeam();
    if (!team) return [];
    return team.formation.slots.map((slot) => team.players.find((player) => player.id === slot.playerId)).filter((player): player is Player => !!player);
  });
  protected readonly keyPlayer = computed(() => [...(this.opponent()?.players ?? [])].sort((a, b) => b.overall - a.overall)[0]);
  protected readonly scoutingDetail = computed(() => (this.gs.manager()?.perks.scouting ?? 0) >= 2);
  protected readonly kitConflict = computed(() => {
    const home = this.homeTeam()?.kit.primary;
    const away = this.awayTeam()?.kit.primary;
    return home && away ? this.colorDistance(home, away) < 110 : false;
  });

  private readonly keyDown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape' && this.phase() === 'match' && !event.repeat) {
      event.preventDefault();
      this.togglePlay();
      return;
    }
    if (event.code === 'KeyQ' && this.phase() === 'match' && !event.repeat) this.showTactics.update((value) => !value);
    if (!event.repeat) this.edgeKeys.add(event.code);
    this.keys.add(event.code);
    this.captureKeyboard(event.code, true);
  };
  private readonly keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); this.captureKeyboard(event.code, false); };
  private readonly visibilityChange = () => {
    if (document.hidden && (this.phase() === 'match' || this.phase() === 'halftime')) this.pauseFor('Match automatisch pausiert: Browser-Tab verlassen.');
  };
  private readonly blur = () => {
    this.resetInputs();
    if (this.phase() === 'match') this.pauseFor('Match automatisch pausiert: Fokus verloren.');
  };
  private readonly gamepadDisconnected = () => {
    if (this.gamepadSeen && this.phase() === 'match') this.pauseFor('Controller getrennt. Bitte Eingabegerät prüfen.');
  };
  private readonly fullscreenChange = () => this.fullscreenActive.set(!!this.document.fullscreenElement);

  constructor() {
    const settings = this.gs.game()?.settings;
    this.assist.set(settings?.assistPreset ?? 'balanced');
    if (this.instantStartRequested) this.selectedMode.set('instant');
    else if (this.autoStartRequested) this.selectedMode.set('play');
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    window.addEventListener('gamepaddisconnected', this.gamepadDisconnected);
    document.addEventListener('visibilitychange', this.visibilityChange);
    document.addEventListener('fullscreenchange', this.fullscreenChange);
    effect(() => {
      this.document.body.classList.toggle('match-immersive', this.phase() === 'match');
    });
    effect(() => {
      const fixture = this.gs.nextFixture();
      this.resumeOffer.set(!this.practice && fixture ? this.checkpoints.load(fixture.id) : null);
    });
    effect(() => {
      const canvas = this.canvasRef();
      if (this.phase() === 'match' && canvas && !this.renderer && this.arcade) this.startAnimation(canvas.nativeElement);
    });
    effect(() => {
      const helpVisible = this.controlHelp.visible();
      if (this.phase() !== 'match' || !this.arcade) return;
      if (helpVisible && this.playing()) {
        this.pausedForHelp = true;
        this.playing.set(false);
        this.arcade.setPaused(true);
      } else if (!helpVisible && this.pausedForHelp) {
        this.pausedForHelp = false;
        this.playing.set(true);
        this.arcade.setPaused(false);
      }
    });
    if (this.autoStartRequested || this.instantStartRequested || this.practice) queueMicrotask(() => { this.kickOff(); if (this.practice) this.skipIntro(); });
  }

  protected teamRating(team: Team | null): number {
    if (!team) return 0;
    const top = [...team.players].sort((a, b) => b.overall - a.overall).slice(0, 11);
    return top.length ? Math.round(top.reduce((sum, player) => sum + player.overall, 0) / top.length) : 0;
  }

  protected form(teamId: string | undefined): ('W' | 'D' | 'L')[] {
    const game = this.gs.game();
    if (!game || !teamId) return [];
    return game.league.fixtures
      .filter((fixture) => fixture.played && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId))
      .sort((a, b) => a.week - b.week)
      .slice(-5)
      .map((fixture) => {
        const scored = fixture.homeTeamId === teamId ? fixture.homeScore! : fixture.awayScore!;
        const conceded = fixture.homeTeamId === teamId ? fixture.awayScore! : fixture.homeScore!;
        return scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
      });
  }

  protected prediction(): { home: number; draw: number; away: number } {
    const homeRating = this.teamRating(this.homeTeam()) + 3;
    const awayRating = this.teamRating(this.awayTeam());
    const diff = homeRating - awayRating;
    const homeBase = 1 / (1 + Math.pow(10, -diff / 12));
    const draw = 0.26 - Math.min(0.14, Math.abs(diff) / 110);
    const home = homeBase * (1 - draw);
    const away = (1 - homeBase) * (1 - draw);
    return { home: Math.round(home * 100), draw: Math.round(draw * 100), away: Math.round(away * 100) };
  }

  protected weakness(team: Team | null): string {
    if (!team) return 'Unbekannt';
    const groups = ['DEF', 'MID', 'ATT'] as const;
    const weakest = groups
      .map((group) => ({ group, value: team.players.filter((player) => player.positionGroup === group).reduce((sum, player, _, list) => sum + player.overall / Math.max(1, list.length), 0) }))
      .sort((a, b) => a.value - b.value)[0]?.group;
    return weakest === 'DEF' ? 'Raum hinter der Abwehr' : weakest === 'MID' ? 'Aufbau unter Druck' : 'Abschlussqualität';
  }

  protected kickOff(): void {
    const home = this.homeTeam();
    const away = this.awayTeam();
    const fixture = this.matchFixture();
    const settings = this.gs.game()?.settings;
    if (!home || !away || !fixture || this.lineupErrors().length) return;
    if (!this.practice) this.travel.resolveSafeForFixture(fixture.id);
    if (this.selectedMode() === 'instant') {
      this.phase.set('simulating');
      void this.engine.simulateAsync(home, away, fixture.week, this.stableSeed(fixture.id), fixture.id).then((result) => {
        this.result.set(result);
        this.revealed.set([...result.events]);
        this.phase.set('result');
      });
      return;
    }
    void this.enterImmersiveMode(false);
    const lockId = this.playerLock() ? this.playerLockId() || this.starters().find((player) => player.positionGroup !== 'GK')?.id || null : null;
    this.arcade = this.engine.createSession(home, away, {
      mode: this.selectedMode(),
      controllerMode: this.selectedMode() === 'coach' || this.autoStartRequested ? 'auto' : 'human',
      fixtureId: fixture.id,
      controlledTeamId: this.controlledTeam()?.id ?? home.id,
      halfMinutes: settings?.matchDuration ?? 3,
      seed: this.stableSeed(fixture.id),
      difficulty: settings?.difficulty ?? 'normal',
      assist: this.assist(),
      playerLockId: lockId,
      weather: this.practice ? 'clear' : this.expectedWeather(),
      inputDevice: this.selectedMode() === 'coach' ? 'ai' : this.inputDevice(),
      camera: { zoom: this.practice ? 1.25 : 1, lookAhead: 0.18, shake: settings?.cameraShake ?? true, reducedMotion: settings?.reducedMotion ?? false },
    }, this.gs.manager()?.perks.tactics ?? 0);
    this.autoEnabled.set(this.arcade.controllerMode === 'auto');
    this.prevHome = this.arcade.homeScore;
    this.prevAway = this.arcade.awayScore;
    this.revealed.set([...this.arcade.events]);
    this.lastAudioEvent = this.arcade.events.length;
    this.initializeMatchProjection();
    this.saveCheckpoint();
    this.phase.set('intro');
    this.audio.startMusic();
    this.introTimer = setTimeout(() => this.skipIntro(), 2800);
  }

  protected resumeMatch(): void {
    const checkpoint = this.resumeOffer();
    const home = this.homeTeam();
    const away = this.awayTeam();
    if (!checkpoint || !home || !away) return;
    this.arcade = this.engine.createSession(home, away, checkpoint.config, this.gs.manager()?.perks.tactics ?? 0);
    if (!this.arcade.restore(checkpoint)) {
      this.checkpoints.clear();
      this.resumeOffer.set(null);
      return;
    }
    this.selectedMode.set(this.arcade.config.mode);
    this.autoEnabled.set(this.arcade.controllerMode === 'auto');
    this.prevHome = this.arcade.homeScore;
    this.prevAway = this.arcade.awayScore;
    this.revealed.set([...this.arcade.events]);
    this.lastAudioEvent = this.arcade.events.length;
    this.initializeMatchProjection();
    if (this.arcade.phase === 'halftime') {
      this.phase.set('halftime');
    } else {
      this.arcade.setPaused(false);
      this.phase.set('match');
      this.playing.set(true);
    }
  }

  protected discardCheckpoint(): void {
    this.checkpoints.clear();
    this.resumeOffer.set(null);
  }

  protected skipIntro(): void {
    if (this.phase() !== 'intro') return;
    if (this.introTimer) clearTimeout(this.introTimer);
    this.introTimer = null;
    this.audio.stopMusic();
    this.audio.whistle();
    if (navigator.userActivation?.isActive) void this.enterImmersiveMode(false);
    this.phase.set('match');
    this.playing.set(true);
    if (!this.practice && this.selectedMode() === 'play' && !this.autoEnabled() && !this.gs.game()?.settings.controlLearning.introSeen) this.controlHelp.open('pass');
  }

  protected openControls(): void {
    this.controlHelp.open('pass');
  }

  protected async toggleImmersive(): Promise<void> {
    if (this.document.fullscreenElement) {
      await this.exitImmersiveMode();
      return;
    }
    await this.enterImmersiveMode(true);
  }

  private async startAnimation(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.arcade || this.startingRenderer || this.disposed) return;
    this.startingRenderer = true;
    const match = this.arcade;
    if (this.practice) {
      this.graphicsLoading.set(true);
      try {
        const { ThreePitchRenderer } = await import('./three-pitch.renderer');
        if (this.disposed || this.arcade !== match || !canvas.isConnected) return;
        const renderer = this.zone.runOutsideAngular(() => new ThreePitchRenderer(canvas));
        this.renderer = renderer;
        await renderer.prepare(match);
        if (this.disposed || this.arcade !== match || this.renderer !== renderer) return;
      } catch {
        this.graphicsError.set(this.i18n.locale() === 'de' ? 'Die 3D-Grafik konnte nicht gestartet werden. Aktiviere Hardwarebeschleunigung und versuche es erneut.' : 'Could not start 3D graphics. Enable hardware acceleration and try again.');
        this.renderer?.destroy(); this.renderer = null;
        this.startingRenderer = false; this.graphicsLoading.set(false);
        return;
      }
      this.graphicsLoading.set(false);
    } else this.renderer = new ArcadePitchRenderer(canvas);
    this.startingRenderer = false;
    this.lastTs = 0;
    this.fixedAccumulator = 0;
    if (!this.currentRenderState) this.initializeMatchProjection();
    this.zone.runOutsideAngular(() => { this.raf = requestAnimationFrame((time) => this.loop(time)); });
  }

  private loop(timestamp: number): void {
    if (!this.arcade || this.phase() !== 'match') return;
    if (!this.lastTs) this.lastTs = timestamp;
    const rawDelta = Math.max(0, (timestamp - this.lastTs) / 1000);
    const renderDelta = Math.min(rawDelta, 0.05);
    this.lastTs = timestamp;
    if (this.arcade.phase === 'goalReplay') {
      this.replayElapsed += renderDelta;
      const frames = this.arcade.replaySnapshots();
      const cursor = Math.min(frames.length - 1, this.replayElapsed / 3.4 * Math.max(0, frames.length - 1));
      const index = Math.max(0, Math.floor(cursor));
      const current = this.currentRenderState ?? this.arcade.renderState();
      const replay = frames.length ? interpolateThreeReplay(frames[index], frames[Math.min(frames.length - 1, index + 1)], cursor - index) : undefined;
      this.renderer?.render(this.arcade, { previous: current, current, alpha: 1, deltaSeconds: renderDelta }, replay);
      if (this.replayElapsed >= 3.4) this.skipReplay();
      this.raf = requestAnimationFrame((time) => this.loop(time));
      return;
    }
    if (this.playing()) {
      const simulationStarted = performance.now();
      const tacticalTimeScale = this.showTactics() ? 0.15 : 1;
      const simulationSpeed = this.selectedMode() === 'coach' && this.autoEnabled() ? this.speed() : 1;
      this.fixedAccumulator += Math.min(rawDelta, 0.5) * simulationSpeed * tacticalTimeScale;
      const input = this.arcade.controllerMode === 'human' ? this.readInput() : EMPTY_MATCH_COMMAND;
      let steps = 0;
      while (this.fixedAccumulator >= MATCH_TICK && steps < ARCADE_MATCH_TUNING.maxCatchUpSteps) {
        this.previousRenderState = this.currentRenderState ?? this.arcade.renderState();
        this.arcade.step(MATCH_TICK, this.inputBuffer.consume(input, timestamp));
        this.currentRenderState = this.arcade.renderState();
        this.fixedAccumulator -= MATCH_TICK;
        steps++;
      }
      if (this.fixedAccumulator > 0.25) {
        // A delayed GPU frame must not strand the player in a pause menu.
        // Discard wall-clock debt, keeping every simulated tick at exactly 60 Hz.
        this.fixedAccumulator %= MATCH_TICK;
        if (this.renderer && 'setQuality' in this.renderer) this.renderer.setQuality('low');
      }
      this.syncMatch(timestamp);
      this.lastSimulationCost = performance.now() - simulationStarted;
    }
    const current = this.currentRenderState ?? this.arcade.renderState();
    const previous = this.previousRenderState ?? current;
    const renderStarted = performance.now();
    this.renderer?.render(this.arcade, {
      previous,
      current,
      alpha: Math.max(0, Math.min(1, this.fixedAccumulator / MATCH_TICK)),
      deltaSeconds: renderDelta,
    });
    if (this.playing() && rawDelta > 0) this.metrics.record(rawDelta * 1000, this.lastSimulationCost, performance.now() - renderStarted);
    if (timestamp - this.lastMetricsAt > 1000) {
      this.lastMetricsAt = timestamp;
      const canvas = this.canvasRef()?.nativeElement;
      if (canvas) {
        canvas.dataset['performance'] = JSON.stringify(this.metrics.summary());
        const actor = this.arcade.actors.find(player => player.player.id === this.arcade!.selectedPlayerId);
        canvas.dataset['matchState'] = JSON.stringify({ tick: this.arcade.tick, rule: this.arcade.rule.phase, controlledId: actor?.player.id, x: actor?.x, y: actor?.y, vx: actor?.vx, vy: actor?.vy, facingX: actor?.facingX, facingY: actor?.facingY, activePlayers: this.arcade.actors.filter(player => player.active).length });
        if (this.renderer && 'diagnostics' in this.renderer) canvas.dataset['graphics'] = JSON.stringify(this.renderer.diagnostics());
      }
    }
    if (this.arcade.phase === 'halftime') {
      this.enterHalftime();
      return;
    }
    if (this.arcade.finished) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame((time) => this.loop(time));
  }

  private syncMatch(timestamp: number, forceView = false): void {
    if (!this.arcade) return;
    const eventChanged = this.arcade.events.length !== this.matchView().eventRevision;
    if (eventChanged) this.revealed.set([...this.arcade.events]);
    for (const event of this.arcade.events.slice(this.lastAudioEvent)) this.audio.matchEvent(event);
    this.lastAudioEvent = this.arcade.events.length;
    const controlledStats = this.arcade.controlledSide === 'home' ? this.arcade.homeStats : this.arcade.awayStats;
    if (this.pendingPassAttempt >= 0 && controlledStats.passesAttempted > this.pendingPassAttempt) {
      if (!this.practice) this.controlHelp.complete('pass');
      this.pendingPassAttempt = -1;
    }
    if (this.arcade.homeScore > this.prevHome) {
      this.celebrate('home');
      this.prevHome = this.arcade.homeScore;
    }
    if (this.arcade.awayScore > this.prevAway) {
      this.celebrate('away');
      this.prevAway = this.arcade.awayScore;
    }
    const safeRules = ['kickoff', 'throwIn', 'corner', 'goalKick', 'freeKick', 'penalty'];
    if (this.arcade.rule.phase !== this.previousRule && safeRules.includes(this.arcade.rule.phase)) {
      this.saveCheckpoint();
      this.previousRule = this.arcade.rule.phase;
    } else if (this.arcade.rule.phase === 'playing') {
      this.previousRule = 'playing';
    }
    const currentView = this.matchView();
    const immediate = eventChanged || this.arcade.homeScore !== currentView.homeScore || this.arcade.awayScore !== currentView.awayScore || this.arcade.phase !== currentView.phase || this.arcade.rule.phase !== currentView.rulePhase || this.arcade.controllerMode !== currentView.controllerMode;
    if (forceView || immediate || timestamp - this.lastViewSync >= 100) {
      this.matchView.set(this.projectMatchView());
      this.lastViewSync = timestamp;
    }
  }

  private initializeMatchProjection(): void {
    if (!this.arcade) return;
    const state = this.arcade.renderState();
    this.previousRenderState = state;
    this.currentRenderState = state;
    this.lastViewSync = 0;
    this.matchView.set(this.projectMatchView());
  }

  private projectMatchView(): MatchViewState {
    if (!this.arcade) return EMPTY_MATCH_VIEW;
    const selected = this.arcade.actors.find((actor) => actor.player.id === this.arcade!.selectedPlayerId);
    return {
      footballMinute: this.arcade.footballMinute,
      homeScore: this.arcade.homeScore,
      awayScore: this.arcade.awayScore,
      phase: this.arcade.phase,
      rulePhase: this.arcade.rule.phase,
      momentumHome: Math.round(this.arcade.ball.x / 105 * 100),
      controlledPlayerId: this.arcade.selectedPlayerId,
      controlledFitness: selected?.stamina ?? 100,
      controllerMode: this.arcade.controllerMode,
      eventRevision: this.arcade.events.length,
    };
  }

  private celebrate(side: 'home' | 'away'): void {
    const scorer = [...(this.arcade?.events ?? [])].reverse().find((event) => event.type === 'goal' && event.side === side);
    this.flash.set(scorer?.playerName ?? 'GOAL');
    this.renderer?.triggerGoal();
    this.replayElapsed = 0;
    setTimeout(() => this.flash.set(null), 1500);
  }

  protected skipReplay(): void {
    if (!this.arcade || this.arcade.phase !== 'goalReplay') return;
    this.arcade.endReplay();
    this.replayElapsed = 0;
    this.initializeMatchProjection();
  }

  private enterHalftime(): void {
    if (!this.arcade) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderer?.destroy();
    this.renderer = null;
    this.saveCheckpoint();
    this.phase.set('halftime');
    this.audio.whistle();
  }

  protected resumeSecondHalf(): void {
    if (!this.arcade) return;
    if (this.playerLock() && this.playerLockId()) {
      this.arcade.config.playerLockId = this.playerLockId();
      this.arcade.selectedPlayerId = this.playerLockId();
    }
    this.arcade.resumeSecondHalf();
    this.initializeMatchProjection();
    this.phase.set('match');
    this.playing.set(true);
  }

  protected togglePlay(): void {
    if (!this.arcade || this.arcade.phase === 'goalReplay') return;
    this.playing.update((value) => !value);
    this.fixedAccumulator = 0;
    this.lastTs = 0;
    this.resetInputs();
    this.arcade.setPaused(!this.playing());
    this.matchView.set(this.projectMatchView());
    if (!this.playing()) this.saveCheckpoint();
    else this.performanceMessage.set('');
  }

  private pauseFor(message: string): void {
    this.resetInputs();
    this.fixedAccumulator = 0;
    this.lastTs = 0;
    if (!this.arcade) return;
    this.playing.set(false);
    this.arcade.setPaused(true);
    this.matchView.set(this.projectMatchView());
    this.performanceMessage.set(message);
    this.saveCheckpoint();
  }

  protected cycleSpeed(): void {
    if (this.selectedMode() !== 'coach' || !this.autoEnabled()) return;
    this.speed.update((value) => value === 1 ? 2 : value === 2 ? 4 : 1);
  }

  protected toggleAuto(): void {
    if (!this.arcade || this.arcade.config.mode === 'instant') return;
    const mode = this.arcade.controllerMode === 'auto' ? 'human' : 'auto';
    this.resetInputs();
    this.arcade.setControllerMode(mode);
    this.autoEnabled.set(mode === 'auto');
    this.matchView.set(this.projectMatchView());
    if (mode === 'human') this.speed.set(1);
    this.saveCheckpoint();
  }

  protected simulateRemainder(): void {
    if (!this.arcade || !window.confirm('Den Rest des Spiels unwiderruflich simulieren?')) return;
    cancelAnimationFrame(this.raf);
    this.arcade.config.mode = 'instant';
    this.arcade.setPaused(false);
    this.arcade.simulateToEnd();
    this.finish();
  }

  protected forfeit(): void {
    if (!this.arcade || !window.confirm('Match wirklich aufgeben? Das erzeugt mindestens eine 0:3-Niederlage.')) return;
    cancelAnimationFrame(this.raf);
    this.result.set(this.arcade.forfeitControlled());
    this.revealed.set([...this.result()!.events]);
    this.phase.set('result');
    this.destroyRenderer();
  }

  private finish(): void {
    if (!this.arcade) return;
    cancelAnimationFrame(this.raf);
    const result = this.arcade.result();
    result.week = this.gs.nextFixture()?.week ?? result.week;
    this.result.set(result);
    this.revealed.set([...result.events]);
    this.phase.set('result');
    this.destroyRenderer();
    this.audio.whistle();
  }

  protected async confirm(): Promise<void> {
    const result = this.result();
    if (!result || this.committing()) return;
    if (this.practice) { this.reset(); this.kickOff(); this.skipIntro(); return; }
    this.committing.set(true);
    const committed = await this.season.commitWeek(result);
    if (committed) this.checkpoints.clear();
    this.reset();
    await this.router.navigateByUrl(this.gs.seasonOver() ? '/league' : '/');
  }

  protected currentMentality(): Mentality | undefined { return this.arcade?.controlledTeam.tactics.mentality; }
  protected currentPressing(): PressingIntensity | undefined { return this.arcade?.controlledTeam.tactics.pressing; }
  protected currentWidth(): Width | undefined { return this.arcade?.controlledTeam.tactics.width; }
  protected setMentality(value: Mentality): void { this.arcade?.setMentality(value); }
  protected setPressing(value: PressingIntensity): void { this.arcade?.setPressing(value); }
  protected setWidth(value: Width): void { this.arcade?.setWidth(value); }
  protected toggleCounter(): void { this.arcade?.toggleCounter(); }

  protected onPitchPlayers(): Player[] {
    return this.arcade?.actors.filter((actor) => actor.active && actor.side === this.arcade!.controlledSide).map((actor) => actor.player) ?? [];
  }
  protected benchPlayers(): Player[] { return this.arcade?.bench() ?? []; }
  protected subsRemaining(): number { return this.arcade ? Math.max(0, 5 - this.arcade.subsUsed) : 0; }
  protected doSub(): void {
    if (!this.arcade || !this.subOutId() || !this.subInId()) return;
    if (this.arcade.makeSub(this.subOutId(), this.subInId())) {
      this.subOutId.set('');
      this.subInId.set('');
      this.showSubs.set(false);
      this.saveCheckpoint();
    }
  }

  protected matchStats(side: 'home' | 'away') { return side === 'home' ? this.arcade?.homeStats : this.arcade?.awayStats; }

  protected motmName(): string {
    const result = this.result();
    if (!result?.manOfTheMatchId) return '—';
    const player = [this.homeTeam(), this.awayTeam()].flatMap((team) => team?.players ?? []).find((candidate) => candidate.id === result.manOfTheMatchId);
    return player ? playerName(player) : '—';
  }

  protected playerRatings() {
    const result = this.result();
    const club = this.controlledTeam();
    if (!result || !club) return [];
    return club.players
      .filter((player) => result.ratings[player.id] !== undefined)
      .map((player) => ({ player, rating: result.ratings[player.id], contribution: result.contributions[player.id], motm: player.id === result.manOfTheMatchId }))
      .sort((a, b) => b.rating - a.rating);
  }

  protected setTouchAction(action: TouchAction, active: boolean): void {
    this.inputBuffer.set(`touch-${action}`, action === 'switch' ? 'switchPlayer' : action, active, performance.now());
    if (active) this.touchEdges.add(action);
    this.touchActions.update((current) => ({ ...current, [action]: active }));
  }

  protected touchStickStart(event: PointerEvent): void {
    this.touchPointer = event.pointerId;
    this.touchOrigin = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.updateInputDevice('touch');
  }

  protected touchStickMove(event: PointerEvent): void {
    if (event.pointerId !== this.touchPointer) return;
    const dx = event.clientX - this.touchOrigin.x;
    const dy = event.clientY - this.touchOrigin.y;
    const length = Math.hypot(dx, dy);
    const scale = Math.max(40, length);
    this.touchX.set(dx / scale);
    this.touchY.set(dy / scale);
  }

  protected touchStickEnd(event: PointerEvent): void {
    if (event.pointerId !== this.touchPointer) return;
    this.touchPointer = null;
    this.touchX.set(0);
    this.touchY.set(0);
  }

  private readInput(): MatchCommand {
    const gamepad = typeof navigator !== 'undefined' ? navigator.getGamepads?.()[0] : null;
    const [axisX, axisY] = radialAxes(gamepad?.axes[0] ?? 0, gamepad?.axes[1] ?? 0);
    const keyboardX = (MOVEMENT_KEYS.right.some((key) => this.keys.has(key)) ? 1 : 0) - (MOVEMENT_KEYS.left.some((key) => this.keys.has(key)) ? 1 : 0);
    const keyboardY = (MOVEMENT_KEYS.down.some((key) => this.keys.has(key)) ? 1 : 0) - (MOVEMENT_KEYS.up.some((key) => this.keys.has(key)) ? 1 : 0);
    const touches = this.touchActions();
    const gamepadActive = !!gamepad && (Math.abs(axisX) + Math.abs(axisY) > 0 || gamepad.buttons.some((button) => button.pressed));
    if (gamepadActive) {
      this.gamepadSeen = true;
      this.updateInputDevice('gamepad');
    } else if (this.touchX() || this.touchY() || Object.values(touches).some(Boolean)) this.updateInputDevice('touch');
    else if (keyboardX || keyboardY || [...this.keys].some((key) => key.startsWith('Key') || key.startsWith('Shift') || key === 'Space')) this.updateInputDevice('keyboard');
    const moveX = clampInput(keyboardX + axisX + this.touchX());
    const moveY = clampInput(keyboardY + axisY + this.touchY());
    const pressed = (action: keyof typeof CONTROL_INPUT_MAP): boolean => {
      const binding = CONTROL_INPUT_MAP[action];
      this.inputBuffer.set(`gamepad-${action}`, action === 'switch' ? 'switchPlayer' : action, !!gamepad?.buttons[binding.gamepadButton]?.pressed, performance.now());
      return binding.keyboard.some((key) => this.keys.has(key) || this.edgeKeys.has(key)) || !!gamepad?.buttons[binding.gamepadButton]?.pressed || touches[action] || this.touchEdges.has(action as TouchAction);
    };
    const pass = pressed('pass');
    const arcade = this.arcade;
    if (pass && !this.previousLearningPass && arcade && arcade.ball.ownerId === arcade.selectedPlayerId) {
      const stats = arcade.controlledSide === 'home' ? arcade.homeStats : arcade.awayStats;
      this.pendingPassAttempt = stats.passesAttempted;
    }
    this.previousLearningPass = pass;
    const command: MatchCommand = {
      moveX,
      moveY,
      aimX: moveX,
      aimY: moveY,
      sprint: pressed('sprint'),
      pass,
      through: pressed('through'),
      lob: pressed('lob'),
      shoot: pressed('shoot'),
      skill: pressed('skill'),
      switchPlayer: pressed('switch'),
      keeperRush: pressed('through'),
      tacticX: 0,
      tacticY: 0,
      pause: false,
      device: this.inputDevice(),
    };
    this.edgeKeys.clear();
    this.touchEdges.clear();
    return command;
  }

  private captureKeyboard(code: string, active: boolean): void {
    for (const [action, binding] of Object.entries(CONTROL_INPUT_MAP)) {
      if ((binding.keyboard as readonly string[]).includes(code)) this.inputBuffer.set(`key-${code}`, (action === 'switch' ? 'switchPlayer' : action) as BufferedButton, active, performance.now());
    }
  }

  private updateInputDevice(device: Exclude<InputDevice, 'ai'>): void {
    if (this.inputDevice() === device) return;
    this.inputDevice.set(device);
    if (!this.practice) this.controlHelp.setDevice(device);
  }

  private validateLineup(team: Team | null): string[] {
    if (!team) return ['Kein kontrolliertes Team verfügbar.'];
    const ids = team.formation.slots.map((slot) => slot.playerId).filter((id): id is string => !!id);
    const players = ids.map((id) => team.players.find((player) => player.id === id)).filter((player): player is Player => !!player);
    const errors: string[] = [];
    if (ids.length !== 11 || players.length !== 11) errors.push('Die Startelf muss exakt elf gültige Spieler enthalten.');
    if (new Set(ids).size !== ids.length) errors.push('Ein Spieler ist mehrfach aufgestellt.');
    if (players.filter((player) => player.positionGroup === 'GK').length !== 1) errors.push('Die Startelf benötigt genau einen Torwart.');
    if (players.some((player) => player.injuryWeeks > 0)) errors.push('Verletzte Spieler müssen aus der Startelf entfernt werden.');
    return errors;
  }

  private saveCheckpoint(): void {
    if (!this.practice && this.arcade) this.checkpoints.save(this.arcade.checkpoint());
  }

  private resetInputs(): void {
    this.inputBuffer.clear();
    this.keys.clear();
    this.edgeKeys.clear();
    this.touchEdges.clear();
    this.previousLearningPass = false;
    this.pendingPassAttempt = -1;
    this.touchX.set(0);
    this.touchY.set(0);
    this.touchActions.set({ sprint: false, pass: false, through: false, lob: false, shoot: false, skill: false, switch: false });
  }

  private async enterImmersiveMode(force: boolean): Promise<void> {
    if (!this.isTouchDevice()) return;
    if (!force && !this.isInstalledApp()) return;

    const root = this.document.documentElement;
    try {
      if (!this.document.fullscreenElement && root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      // Installed PWAs and iOS can already be immersive without exposing the API.
    }

    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'landscape') => Promise<void>;
    };
    try {
      await orientation.lock?.('landscape');
    } catch {
      // Orientation locking is optional and browser-dependent.
    }
  }

  private async exitImmersiveMode(): Promise<void> {
    const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
    try {
      orientation.unlock?.();
    } catch {
      // No-op on browsers that keep the installed-app orientation.
    }
    try {
      if (this.document.fullscreenElement && this.document.exitFullscreen) await this.document.exitFullscreen();
    } catch {
      // The operating system can own fullscreen state after an app switch.
    }
  }

  private isInstalledApp(): boolean {
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    return navigatorWithStandalone.standalone === true
      || matchMedia('(display-mode: fullscreen)').matches
      || matchMedia('(display-mode: standalone)').matches;
  }

  private isTouchDevice(): boolean {
    return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  }

  private reset(): void {
    if (this.introTimer) clearTimeout(this.introTimer);
    cancelAnimationFrame(this.raf);
    this.destroyRenderer();
    this.arcade = null;
    this.previousRenderState = null;
    this.currentRenderState = null;
    this.matchView.set(EMPTY_MATCH_VIEW);
    this.autoEnabled.set(false);
    this.result.set(null);
    this.revealed.set([]);
    this.committing.set(false);
    this.phase.set('preview');
    this.audio.stopMusic();
  }

  private destroyRenderer(): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.raf = 0;
  }

  private stableSeed(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private colorDistance(first: string, second: string): number {
    const parse = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const a = parse(first);
    const b = parse(second);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  ngOnDestroy(): void {
    this.disposed = true;
    if (this.introTimer) clearTimeout(this.introTimer);
    cancelAnimationFrame(this.raf);
    this.destroyRenderer();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    window.removeEventListener('gamepaddisconnected', this.gamepadDisconnected);
    document.removeEventListener('visibilitychange', this.visibilityChange);
    document.removeEventListener('fullscreenchange', this.fullscreenChange);
    this.document.body.classList.remove('match-immersive');
    void this.exitImmersiveMode();
    this.audio.stopMusic();
  }
}

function clampInput(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function radialAxes(x: number, y: number): [number, number] {
  const deadzone = 0.18;
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return [0, 0];
  const normalized = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const curved = Math.pow(normalized, 1.12);
  return [x / magnitude * curved, y / magnitude * curved];
}
