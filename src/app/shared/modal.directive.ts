import { Directive, ElementRef, OnDestroy, OnInit, effect, inject, input, output } from '@angular/core';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal behaviour: focus moves inside, Tab stays inside, Escape closes and focus returns
 * to the opener afterwards. A native <dialog> host is opened with showModal() while [appModalOpen] is true.
 */
@Directive({
  selector: '[appModal]',
  host: { '(keydown)': 'onKeydown($event)', '[attr.aria-modal]': '"true"' },
})
export class ModalDirective implements OnInit, OnDestroy {
  readonly appModalOpen = input(true);
  readonly dismiss = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const element = this.host.nativeElement;
      if (!(element instanceof HTMLDialogElement)) return;
      if (this.appModalOpen() && !element.open) { this.remember(); element.showModal?.(); this.focusFirst(); }
      else if (!this.appModalOpen() && element.open) { element.close(); this.restore(); }
    });
  }

  ngOnInit(): void {
    if (this.host.nativeElement instanceof HTMLDialogElement) return;
    this.remember();
    queueMicrotask(() => this.focusFirst());
  }

  ngOnDestroy(): void {
    if (!(this.host.nativeElement instanceof HTMLDialogElement)) this.restore();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismiss.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusable();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  private focusable(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null || element === document.activeElement);
  }

  private focusFirst(): void {
    const target = this.focusable()[0] ?? this.host.nativeElement;
    if (!target.hasAttribute('tabindex') && target === this.host.nativeElement) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  private remember(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  private restore(): void {
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }
}
