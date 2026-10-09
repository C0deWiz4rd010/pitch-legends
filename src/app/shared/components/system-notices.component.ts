import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { PersistentStore } from '../../core/storage/persistent-store';

/** Routes where an update prompt would interrupt a running match. */
const MATCH_ROUTE = /^\/(?:match|play)(?:[/?#]|$)/;

/**
 * App-wide notices: failed saves, a new version waiting to be loaded, and offline play.
 * A failed save is always shown – the game never loses progress silently.
 */
@Component({
  selector: 'app-system-notices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notices" aria-live="polite">
      @if (store.issue(); as issue) {
        <div class="notice danger" role="alert">
          <strong>{{ issue.reason === 'quota' ? text('SPEICHER VOLL', 'STORAGE FULL') : text('SPEICHERN FEHLGESCHLAGEN', 'SAVE FAILED') }}</strong>
          <span>{{ issue.reason === 'quota'
            ? text('Der Browser hat keinen Platz mehr. Dein Fortschritt dieser Sitzung ist noch da, aber nicht gesichert. Exportiere die Karriere als Datei.', 'The browser is out of space. This session’s progress is still here but not stored. Export your career to a file.')
            : text('Der Spielstand konnte nicht geschrieben werden. Dein Fortschritt dieser Sitzung ist noch da, aber nicht gesichert.', 'The save could not be written. This session’s progress is still here but not stored.') }}</span>
          <div class="actions">
            @if (gs.hasGame()) {
              <button type="button" class="btn btn--sm" (click)="retry()">{{ text('ERNEUT', 'RETRY') }}</button>
              <button type="button" class="btn btn--sm" (click)="gs.exportSave()">{{ text('EXPORTIEREN', 'EXPORT') }}</button>
            }
            <button type="button" class="btn btn--ghost btn--sm" (click)="store.dismissIssue()">{{ text('SCHLIESSEN', 'DISMISS') }}</button>
          </div>
        </div>
      }
      @if (showUpdate()) {
        <div class="notice info" role="status">
          <strong>{{ text('NEUE VERSION', 'NEW VERSION') }}</strong>
          <span>{{ text('Ein Update ist geladen. Dein Spielstand bleibt erhalten.', 'An update is ready. Your saves stay as they are.') }}</span>
          <div class="actions">
            <button type="button" class="btn btn--primary btn--sm" (click)="reload()">{{ text('NEU LADEN', 'RELOAD') }}</button>
            <button type="button" class="btn btn--ghost btn--sm" (click)="updateDismissed.set(true)">{{ text('SPÄTER', 'LATER') }}</button>
          </div>
        </div>
      }
      @if (offline() && !inMatch()) {
        <div class="notice offline" role="status"><strong>OFFLINE</strong><span>{{ text('Du spielst offline. Alles wird auf diesem Gerät gespeichert.', 'You are playing offline. Everything is stored on this device.') }}</span></div>
      }
    </div>
  `,
  styles: [`
    .notices { position: fixed; z-index: 90; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); display: grid; gap: 8px; pointer-events: none; }
    .notice { pointer-events: auto; display: grid; gap: 6px; padding: 12px 14px; border: 2px solid var(--border); background: var(--surface); box-shadow: var(--shadow-1); color: var(--text); font-size: 13px; }
    .notice strong { font-family: var(--font-display); font-size: 12px; letter-spacing: .04em; }
    .notice.danger { border-color: var(--danger); }
    .notice.danger strong { color: var(--danger); }
    .notice.info { border-color: var(--accent-2); }
    .notice.info strong { color: var(--accent-2); }
    .notice.offline { grid-template-columns: auto 1fr; align-items: center; padding: 8px 12px; border-color: var(--warn); }
    .notice.offline strong { color: var(--warn); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  `],
})
export class SystemNoticesComponent {
  protected readonly store = inject(PersistentStore);
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly updates = inject(SwUpdate);
  private readonly url = signal(this.router.url);
  protected readonly inMatch = computed(() => MATCH_ROUTE.test(this.url()));
  protected readonly updateReady = signal(false);
  protected readonly updateDismissed = signal(false);
  protected readonly offline = signal(typeof navigator !== 'undefined' && navigator.onLine === false);
  /** The update notice waits until the player has left the match. */
  protected readonly showUpdate = computed(() => this.updateReady() && !this.updateDismissed() && !this.inMatch());

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe((event) => this.url.set((event as NavigationEnd).urlAfterRedirects));
    if (this.updates.isEnabled) {
      this.updates.versionUpdates.pipe(filter((event) => event.type === 'VERSION_READY'), takeUntilDestroyed())
        .subscribe(() => this.updateReady.set(true));
      // A broken cache cannot recover by itself; reloading fetches a fresh copy.
      this.updates.unrecoverable.pipe(takeUntilDestroyed()).subscribe(() => this.updateReady.set(true));
    }
    const online = () => this.offline.set(false);
    const offline = () => this.offline.set(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    });
  }

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }

  protected async retry(): Promise<void> {
    await this.gs.saveNow();
  }

  protected async reload(): Promise<void> {
    await this.gs.flushSave();
    await this.store.flush();
    document.location.reload();
  }
}
