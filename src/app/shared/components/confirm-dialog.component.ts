import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

/** Modal confirmation built on the native dialog: focus is trapped and Escape cancels. */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="confirm" (cancel)="onCancel($event)" (close)="closedByBrowser()">
      <h2>{{ title() }}</h2>
      <p>{{ message() }}</p>
      <div class="actions">
        <button type="button" class="btn btn--ghost" (click)="cancelled.emit()">{{ cancelLabel() }}</button>
        <button type="button" class="btn" [class.btn--danger]="danger()" [class.btn--primary]="!danger()" (click)="confirmed.emit()" autofocus>{{ confirmLabel() }}</button>
      </div>
    </dialog>
  `,
  styles: [`
    .confirm { max-width: min(92vw, 440px); padding: 22px; color: var(--text); background: var(--surface); border: 2px solid var(--border); box-shadow: var(--shadow-2); }
    .confirm::backdrop { background: rgba(3, 5, 14, 0.7); }
    h2 { font-size: 16px; margin-bottom: 10px; }
    p { margin: 0 0 18px; color: var(--text-dim); font-size: 14px; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
  `],
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly message = input('');
  readonly confirmLabel = input('OK');
  readonly cancelLabel = input('Abbrechen');
  readonly danger = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) element.showModal?.();
      else if (!this.open() && element.open) element.close();
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.cancelled.emit();
  }

  protected closedByBrowser(): void {
    if (this.open()) this.cancelled.emit();
  }
}
