import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { GameStateService } from '../../core/services/game-state.service';
import { SeasonService } from '../../core/services/season.service';
import { MatchEngineService } from '../../core/services/match-engine.service';
import { LiveMatch } from '../../core/services/match-sim';
import { InputFrame, MatchEvent, MatchMode, MatchResult } from '../../models/match.model';
import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import { Mentality, PressingIntensity } from '../../models/enums';
import { ratingColor } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';
import { MatchPitchRenderer } from './match-renderer';
import { I18nService } from '../../core/services/i18n.service';
import { ArcadeMatch } from '../../core/services/arcade-match';
import { ArcadePitchRenderer } from './arcade-renderer';
import { AudioService } from '../../core/services/audio.service';

type Phase = 'preview' | 'coach' | 'play' | 'result';

@Component({
  selector: 'app-match',
  imports: [RouterLink, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './match.page.html',
  styleUrl: './match.page.scss',
})
export class MatchPage implements OnDestroy {
  protected readonly gs = inject(GameStateService);
  private readonly season = inject(SeasonService);
  private readonly engine = inject(MatchEngineService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);
  private readonly audio = inject(AudioService);
  protected readonly ratingColor = ratingColor;
  protected readonly playerName = playerName;

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('pitch');

  protected readonly phase = signal<Phase>('preview');
  protected readonly result = signal<MatchResult | null>(null);
  protected readonly minute = signal(0);
  protected readonly playing = signal(true);
  protected readonly speed = signal(1);
  protected readonly revealed = signal<MatchEvent[]>([]);
  protected readonly flash = signal<string | null>(null);
  protected readonly momentum = signal(0);
  protected readonly showSubs = signal(false);
  protected readonly subOutId = signal<string>('');
  protected readonly subInId = signal<string>('');
  protected readonly selectedMode = signal<MatchMode>('play');
  protected readonly touchX = signal(0);
  protected readonly touchY = signal(0);
  protected readonly touchSprint = signal(false);
  protected readonly touchPass = signal(false);
  protected readonly touchThrough = signal(false);
  protected readonly touchShoot = signal(false);
  protected readonly touchSwitch = signal(false);

  private live: LiveMatch | null = null;
  private arcade: ArcadeMatch | null = null;
  private renderer: MatchPitchRenderer | null = null;
  private arcadeRenderer: ArcadePitchRenderer | null = null;
  private raf = 0;
  private lastTs = 0;
  private virtualMinute = 0;
  private prevHome = 0;
  private prevAway = 0;
  private fixedAccumulator = 0;
  private readonly keys = new Set<string>();
  private readonly keyDown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
  };
  private readonly keyUp = (event: KeyboardEvent) => this.keys.delete(event.code);

  protected readonly mentalities: Mentality[] = ['ultra-defensive', 'defensive', 'balanced', 'attacking', 'ultra-attacking'];
  protected readonly pressings: PressingIntensity[] = ['low', 'medium', 'high', 'gegenpress'];

  protected readonly homeTeam = computed<Team | null>(() => {
    const r = this.result();
    const fx = this.gs.nextFixture();
    if (r) return this.gs.teamById(r.homeTeamId) ?? null;
    return fx ? this.gs.teamById(fx.homeTeamId) ?? null : null;
  });
  protected readonly awayTeam = computed<Team | null>(() => {
    const r = this.result();
    const fx = this.gs.nextFixture();
    if (r) return this.gs.teamById(r.awayTeamId) ?? null;
    return fx ? this.gs.teamById(fx.awayTeamId) ?? null : null;
  });
  protected readonly isHome = computed(() => this.homeTeam()?.id === this.gs.playerTeam()?.id);

  /** Average overall of a team's best XI. */
  protected teamRating(team: Team | null): number {
    if (!team) return 0;
    const top = [...team.players].sort((a, b) => b.overall - a.overall).slice(0, 11);
    return top.length ? Math.round(top.reduce((s, p) => s + p.overall, 0) / top.length) : 0;
  }

  /** Last up to five league results for a team as W/D/L, oldest → newest. */
  protected form(teamId: string | undefined): ('W' | 'D' | 'L')[] {
    const g = this.gs.game();
    if (!g || !teamId) return [];
    return g.league.fixtures
      .filter((f) => f.played && (f.homeTeamId === teamId || f.awayTeamId === teamId))
      .sort((a, b) => a.week - b.week)
      .slice(-5)
      .map((f) => {
        const gf = f.homeTeamId === teamId ? f.homeScore! : f.awayScore!;
        const ga = f.homeTeamId === teamId ? f.awayScore! : f.homeScore!;
        return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      });
  }

  /** Rough win/draw/away prediction from squad ratings + home advantage. */
  protected prediction(): { home: number; draw: number; away: number } {
    const h = this.teamRating(this.homeTeam()) + 4;
    const a = this.teamRating(this.awayTeam());
    const diff = h - a;
    const homeW = 1 / (1 + Math.pow(10, -diff / 12));
    const draw = 0.26 - Math.min(0.16, Math.abs(diff) / 100);
    const home = Math.max(0.05, homeW * (1 - draw));
    const away = Math.max(0.05, (1 - homeW) * (1 - draw));
    const total = home + draw + away;
    return {
      home: Math.round((home / total) * 100),
      draw: Math.round((draw / total) * 100),
      away: Math.round((away / total) * 100),
    };
  }


  protected readonly liveHome = computed(
    () => this.revealed().filter((e) => e.type === 'goal' && e.side === 'home').length,
  );
  protected readonly liveAway = computed(
    () => this.revealed().filter((e) => e.type === 'goal' && e.side === 'away').length,
  );
  protected readonly tickerEvents = computed(() => [...this.revealed()].reverse());
  protected readonly momentumHome = computed(() => Math.round((this.momentum() + 1) * 50));

  constructor() {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    effect(() => {
      const canvas = this.canvasRef();
      if ((this.phase() === 'coach' || this.phase() === 'play') && canvas && !this.renderer && !this.arcadeRenderer) {
        this.startAnimation(canvas.nativeElement);
      }
    });
  }

  protected kickOff(mode: MatchMode = this.selectedMode()): void {
    const home = this.homeTeam();
    const away = this.awayTeam();
    const fx = this.gs.nextFixture();
    if (!home || !away || !fx) return;
    const controlledTeamId = this.gs.playerTeam()?.id ?? home.id;
    if (mode === 'instant') {
      const result = this.engine.simulate(home, away, fx.week);
      this.result.set(result);
      this.revealed.set([...result.events]);
      this.minute.set(90);
      this.phase.set('result');
      return;
    }

    this.audio.whistle();
    this.audio.startMusic();

    if (mode === 'play') {
      const settings = this.gs.game()?.settings;
      this.arcade = new ArcadeMatch(
        home,
        away,
        controlledTeamId,
        settings?.matchDuration ?? 3,
        Date.now() >>> 0,
        settings?.difficulty ?? 'normal',
        this.gs.manager()?.perks.tactics ?? 0,
      );
      this.revealed.set([...this.arcade.events]);
      this.phase.set('play');
    } else {
      this.live = this.engine.createLiveMatch(home, away, fx.week, controlledTeamId);
      this.revealed.set([...this.live.events]);
      this.phase.set('coach');
    }
    this.virtualMinute = 0;
    this.minute.set(0);
    this.momentum.set(0);
    this.prevHome = 0;
    this.prevAway = 0;
    this.playing.set(true);
    this.speed.set(1);
    this.fixedAccumulator = 0;
  }

  private startAnimation(canvas: HTMLCanvasElement): void {
    if (this.phase() === 'play' && this.arcade) {
      this.arcadeRenderer = new ArcadePitchRenderer(canvas);
    } else if (this.live) {
      this.renderer = new MatchPitchRenderer(canvas, this.live.home, this.live.away, this.live.keyframes);
    } else return;
    this.lastTs = 0;
    this.raf = requestAnimationFrame((ts) => this.loop(ts));
  }

  private loop(ts: number): void {
    if (!this.lastTs) this.lastTs = ts;
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    if (this.playing() && this.phase() === 'coach' && this.live) {
      this.virtualMinute += dt * 2.4 * this.speed();
      this.live.stepTo(this.virtualMinute);
      const m = Math.min(90, Math.floor(this.virtualMinute));
      if (m !== this.minute()) this.minute.set(m);
      this.syncFromLive();
      if (this.virtualMinute >= 90) return this.finish();
    } else if (this.playing() && this.phase() === 'play' && this.arcade) {
      this.fixedAccumulator = Math.min(this.fixedAccumulator + dt, 0.2);
      const input = this.readInput();
      while (this.fixedAccumulator >= 1 / 60) {
        this.arcade.step(1 / 60, input);
        this.fixedAccumulator -= 1 / 60;
      }
      this.syncFromArcade();
      if (this.arcade.finished) return this.finish();
    }

    this.renderer?.render(this.virtualMinute);
    if (this.arcade && this.arcadeRenderer) this.arcadeRenderer.render(this.arcade);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private syncFromLive(): void {
    if (!this.live) return;
    this.revealed.set([...this.live.events]);
    this.momentum.set(this.live.momentum);
    if (this.live.homeScore > this.prevHome) {
      this.celebrate('home');
      this.prevHome = this.live.homeScore;
    }
    if (this.live.awayScore > this.prevAway) {
      this.celebrate('away');
      this.prevAway = this.live.awayScore;
    }
  }

  private syncFromArcade(): void {
    if (!this.arcade) return;
    this.revealed.set([...this.arcade.events]);
    this.minute.set(this.arcade.footballMinute);
    this.momentum.set(Math.max(-1, Math.min(1, (this.arcade.ball.x - 0.5) * 2)));
    if (this.arcade.homeScore > this.prevHome) {
      this.celebrate('home');
      this.prevHome = this.arcade.homeScore;
    }
    if (this.arcade.awayScore > this.prevAway) {
      this.celebrate('away');
      this.prevAway = this.arcade.awayScore;
    }
  }

  private celebrate(side: 'home' | 'away'): void {
    const scorer = [...(this.live?.events ?? this.arcade?.events ?? [])]
      .reverse()
      .find((e) => e.type === 'goal' && e.side === side);
    this.flash.set(scorer?.playerName ?? 'GOAL');
    this.renderer?.triggerGoal(side === 'home');
    this.arcadeRenderer?.triggerGoal();
    this.audio.goal();
    setTimeout(() => this.flash.set(null), 1800);
  }

  // ── Live management ────────────────────────────────────────────────────────
  protected currentMentality(): Mentality | undefined {
    return this.live?.controlled.tactics.mentality ?? this.arcade?.controlledTeam.tactics.mentality;
  }
  protected currentPressing(): PressingIntensity | undefined {
    return this.live?.controlled.tactics.pressing ?? this.arcade?.controlledTeam.tactics.pressing;
  }
  protected setMentality(m: Mentality): void {
    if (this.live) {
      this.live.setMentality(m);
      this.syncFromLive();
    } else if (this.arcade) {
      this.arcade.setMentality(m);
      this.syncFromArcade();
    }
  }
  protected setPressing(p: PressingIntensity): void {
    if (this.live) {
      this.live.setPressing(p);
      this.syncFromLive();
    } else if (this.arcade) {
      this.arcade.setPressing(p);
      this.syncFromArcade();
    }
  }

  protected onPitchPlayers(): Player[] {
    if (this.arcade) return this.arcade.actors.filter((actor) => actor.active && actor.side === this.arcade!.controlledSide).map((actor) => actor.player);
    if (!this.live) return [];
    return this.live.controlled.formation.slots
      .map((s) => this.live!.controlled.players.find((p) => p.id === s.playerId))
      .filter((p): p is Player => !!p);
  }
  protected benchPlayers(): Player[] {
    return this.live?.bench() ?? this.arcade?.bench() ?? [];
  }
  protected subsRemaining(): number {
    return this.live?.subsRemaining ?? (this.arcade ? Math.max(0, 5 - this.arcade.events.filter((event) => event.type === 'sub').length) : 0);
  }
  protected doSub(): void {
    const out = this.subOutId();
    const inId = this.subInId();
    if ((!this.live && !this.arcade) || !out || !inId) return;
    const changed = this.live ? this.live.makeSub(out, inId) : this.arcade!.makeSub(out, inId);
    if (changed) {
      if (this.live) this.renderer?.refreshNumbers(this.live.home, this.live.away);
      this.subOutId.set('');
      this.subInId.set('');
      this.showSubs.set(false);
      if (this.live) this.syncFromLive();
      else this.syncFromArcade();
    }
  }

  protected togglePlay(): void {
    this.playing.update((p) => !p);
  }
  protected cycleSpeed(): void {
    if (this.phase() === 'play') return;
    this.speed.update((s) => (s === 1 ? 2 : s === 2 ? 4 : 1));
  }
  protected skip(): void {
    if (this.arcade) {
      this.arcade.simulateToEnd();
      this.syncFromArcade();
    } else if (this.live) {
      this.live.stepTo(90);
      this.virtualMinute = 90;
      this.syncFromLive();
    }
    this.finish();
  }

  private finish(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.minute.set(90);
    if (this.live) {
      const r = this.live.finalize();
      this.result.set(r);
      this.revealed.set([...r.events]);
    } else if (this.arcade) {
      const r = this.arcade.result();
      const fx = this.gs.nextFixture();
      if (fx) r.week = fx.week;
      this.result.set(r);
      this.revealed.set([...r.events]);
    }
    this.phase.set('result');
    this.audio.whistle();
    this.audio.stopMusic();
  }

  protected confirm(): void {
    const r = this.result();
    if (!r) return;
    this.season.commitWeek(r);
    this.reset();
    if (this.gs.seasonOver()) this.router.navigateByUrl('/league');
    else this.router.navigateByUrl('/');
  }

  private reset(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.destroy();
    this.renderer = null;
    this.arcadeRenderer?.destroy();
    this.arcadeRenderer = null;
    this.live = null;
    this.arcade = null;
    this.audio.stopMusic();
    this.result.set(null);
    this.phase.set('preview');
  }

  protected motmName(): string {
    const r = this.result();
    if (!r?.manOfTheMatchId) return '—';
    const p = [this.homeTeam(), this.awayTeam()]
      .flatMap((t) => t?.players ?? [])
      .find((pl) => pl.id === r.manOfTheMatchId);
    return p ? playerName(p) : '—';
  }

  protected playerRatings() {
    const r = this.result();
    const club = this.gs.playerTeam();
    if (!r || !club) return [];
    return club.players
      .filter((p) => r.ratings[p.id] !== undefined)
      .map((p) => ({ player: p, rating: r.ratings[p.id], motm: p.id === r.manOfTheMatchId }))
      .sort((a, b) => b.rating - a.rating);
  }

  protected setTouchDirection(x: number, y: number, active: boolean): void {
    this.touchX.set(active ? x : 0);
    this.touchY.set(active ? y : 0);
  }

  protected setTouchAction(action: 'sprint' | 'pass' | 'through' | 'shoot' | 'switch', active: boolean): void {
    if (action === 'sprint') this.touchSprint.set(active);
    if (action === 'pass') this.touchPass.set(active);
    if (action === 'through') this.touchThrough.set(active);
    if (action === 'shoot') this.touchShoot.set(active);
    if (action === 'switch') this.touchSwitch.set(active);
  }

  private readInput(): InputFrame {
    const gamepad = typeof navigator !== 'undefined' ? navigator.getGamepads?.()[0] : null;
    const axisX = Math.abs(gamepad?.axes[0] ?? 0) > 0.18 ? gamepad!.axes[0] : 0;
    const axisY = Math.abs(gamepad?.axes[1] ?? 0) > 0.18 ? gamepad!.axes[1] : 0;
    const keyboardX = (this.keys.has('ArrowRight') || this.keys.has('KeyD') ? 1 : 0) -
      (this.keys.has('ArrowLeft') || this.keys.has('KeyA') ? 1 : 0);
    const keyboardY = (this.keys.has('ArrowDown') || this.keys.has('KeyS') ? 1 : 0) -
      (this.keys.has('ArrowUp') || this.keys.has('KeyW') ? 1 : 0);
    return {
      moveX: Math.max(-1, Math.min(1, keyboardX + axisX + this.touchX())),
      moveY: Math.max(-1, Math.min(1, keyboardY + axisY + this.touchY())),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || !!gamepad?.buttons[7]?.pressed || this.touchSprint(),
      pass: this.keys.has('KeyJ') || !!gamepad?.buttons[0]?.pressed || this.touchPass(),
      through: this.keys.has('KeyK') || !!gamepad?.buttons[3]?.pressed || this.touchThrough(),
      shoot: this.keys.has('KeyL') || !!gamepad?.buttons[1]?.pressed || this.touchShoot(),
      switchPlayer: this.keys.has('Space') || !!gamepad?.buttons[4]?.pressed || this.touchSwitch(),
    };
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.destroy();
    this.arcadeRenderer?.destroy();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    this.audio.stopMusic();
  }
}
