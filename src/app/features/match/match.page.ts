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
import { MatchEvent, MatchResult } from '../../models/match.model';
import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import { Mentality, PressingIntensity } from '../../models/enums';
import { ratingColor } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';
import { MatchPitchRenderer } from './match-renderer';

type Phase = 'preview' | 'live' | 'result';

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

  private live: LiveMatch | null = null;
  private renderer: MatchPitchRenderer | null = null;
  private raf = 0;
  private lastTs = 0;
  private virtualMinute = 0;
  private prevHome = 0;
  private prevAway = 0;

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
    effect(() => {
      const canvas = this.canvasRef();
      if (this.phase() === 'live' && canvas && !this.renderer) {
        this.startAnimation(canvas.nativeElement);
      }
    });
  }

  protected kickOff(): void {
    const home = this.homeTeam();
    const away = this.awayTeam();
    const fx = this.gs.nextFixture();
    if (!home || !away || !fx) return;
    this.live = this.engine.createLiveMatch(home, away, fx.week);
    this.revealed.set([...this.live.events]);
    this.virtualMinute = 0;
    this.minute.set(0);
    this.momentum.set(0);
    this.prevHome = 0;
    this.prevAway = 0;
    this.playing.set(true);
    this.speed.set(1);
    this.phase.set('live');
  }

  private startAnimation(canvas: HTMLCanvasElement): void {
    if (!this.live) return;
    this.renderer = new MatchPitchRenderer(canvas, this.live.home, this.live.away, this.live.keyframes);
    this.lastTs = 0;
    this.raf = requestAnimationFrame((ts) => this.loop(ts));
  }

  private loop(ts: number): void {
    if (!this.lastTs) this.lastTs = ts;
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    if (this.playing() && this.live) {
      this.virtualMinute += dt * 2.4 * this.speed();
      this.live.stepTo(this.virtualMinute);
      const m = Math.min(90, Math.floor(this.virtualMinute));
      if (m !== this.minute()) this.minute.set(m);
      this.syncFromLive();
      if (this.virtualMinute >= 90) {
        this.finish();
        return;
      }
    }

    this.renderer?.render(this.virtualMinute);
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

  private celebrate(side: 'home' | 'away'): void {
    const scorer = [...(this.live?.events ?? [])].reverse().find((e) => e.type === 'goal' && e.side === side);
    this.flash.set(scorer?.playerName ?? 'GOAL');
    this.renderer?.triggerGoal(side === 'home');
    setTimeout(() => this.flash.set(null), 1800);
  }

  // ── Live management ────────────────────────────────────────────────────────
  protected currentMentality(): Mentality | undefined {
    return this.live?.home.tactics.mentality;
  }
  protected currentPressing(): PressingIntensity | undefined {
    return this.live?.home.tactics.pressing;
  }
  protected setMentality(m: Mentality): void {
    this.live?.setMentality(m);
    this.syncFromLive();
  }
  protected setPressing(p: PressingIntensity): void {
    this.live?.setPressing(p);
    this.syncFromLive();
  }

  protected onPitchPlayers(): Player[] {
    if (!this.live) return [];
    return this.live.home.formation.slots
      .map((s) => this.live!.home.players.find((p) => p.id === s.playerId))
      .filter((p): p is Player => !!p);
  }
  protected benchPlayers(): Player[] {
    return this.live?.bench() ?? [];
  }
  protected subsRemaining(): number {
    return this.live?.subsRemaining ?? 0;
  }
  protected doSub(): void {
    const out = this.subOutId();
    const inId = this.subInId();
    if (!this.live || !out || !inId) return;
    if (this.live.makeSub(out, inId)) {
      this.renderer?.refreshNumbers(this.live.home, this.live.away);
      this.subOutId.set('');
      this.subInId.set('');
      this.showSubs.set(false);
      this.syncFromLive();
    }
  }

  protected togglePlay(): void {
    this.playing.update((p) => !p);
  }
  protected cycleSpeed(): void {
    this.speed.update((s) => (s === 1 ? 2 : s === 2 ? 4 : 1));
  }
  protected skip(): void {
    if (this.live) {
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
    }
    this.phase.set('result');
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
    this.live = null;
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

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.renderer?.destroy();
  }
}
