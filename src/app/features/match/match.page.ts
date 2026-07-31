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
import { MatchEvent, MatchResult } from '../../models/match.model';
import { Team } from '../../models/team.model';
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

  private renderer: MatchPitchRenderer | null = null;
  private raf = 0;
  private lastTs = 0;
  private virtualMinute = 0;
  private revealIndex = 0;

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

  protected readonly liveHome = computed(
    () => this.revealed().filter((e) => e.type === 'goal' && e.side === 'home').length,
  );
  protected readonly liveAway = computed(
    () => this.revealed().filter((e) => e.type === 'goal' && e.side === 'away').length,
  );

  protected readonly tickerEvents = computed(() =>
    [...this.revealed()].filter((e) => e.type !== 'commentary').reverse(),
  );

  constructor() {
    effect(() => {
      const canvas = this.canvasRef();
      if (this.phase() === 'live' && canvas && !this.renderer) {
        this.startAnimation(canvas.nativeElement);
      }
    });
  }

  protected kickOff(): void {
    const r = this.season.simulatePlayerMatch();
    if (!r) return;
    this.result.set(r);
    this.revealed.set([]);
    this.revealIndex = 0;
    this.virtualMinute = 0;
    this.minute.set(0);
    this.playing.set(true);
    this.speed.set(1);
    this.phase.set('live');
  }

  private startAnimation(canvas: HTMLCanvasElement): void {
    const r = this.result();
    const home = this.homeTeam();
    const away = this.awayTeam();
    if (!r || !home || !away) return;
    this.renderer = new MatchPitchRenderer(canvas, home, away, r);
    this.lastTs = 0;
    this.raf = requestAnimationFrame((ts) => this.loop(ts));
  }

  private loop(ts: number): void {
    if (!this.lastTs) this.lastTs = ts;
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    if (this.playing()) {
      this.virtualMinute += dt * 2.6 * this.speed();
      const m = Math.min(90, Math.floor(this.virtualMinute));
      if (m !== this.minute()) this.minute.set(m);
      this.revealUpTo(this.virtualMinute);
      if (this.virtualMinute >= 90) {
        this.finish();
        return;
      }
    }

    this.renderer?.render(this.virtualMinute);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private revealUpTo(minute: number): void {
    const r = this.result();
    if (!r) return;
    while (this.revealIndex < r.events.length && r.events[this.revealIndex].minute <= minute) {
      const ev = r.events[this.revealIndex];
      this.revealed.update((list) => [...list, ev]);
      if (ev.type === 'goal') {
        this.flash.set(`⚽ ${ev.playerName}`);
        this.renderer?.triggerGoal(ev.side === 'home');
        setTimeout(() => this.flash.set(null), 1600);
      }
      this.revealIndex++;
    }
  }

  protected togglePlay(): void {
    this.playing.update((p) => !p);
  }
  protected cycleSpeed(): void {
    this.speed.update((s) => (s === 1 ? 2 : s === 2 ? 4 : 1));
  }
  protected skip(): void {
    this.virtualMinute = 90;
    this.revealUpTo(90);
    this.finish();
  }

  private finish(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.minute.set(90);
    // Ensure all events are shown.
    const r = this.result();
    if (r) this.revealed.set([...r.events]);
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
    this.renderer = null;
    this.result.set(null);
    this.phase.set('preview');
  }

  // ── Result helpers ───────────────────────────────────────────────────────
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
  }
}
