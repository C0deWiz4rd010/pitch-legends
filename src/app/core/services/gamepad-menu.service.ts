import { Injectable, NgZone, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Controller navigation for menus: D-pad / left stick move focus, A activates, B goes back or closes.
 * Idle unless a gamepad is connected; the live match reads the controller itself and is left alone.
 */
@Injectable({ providedIn: 'root' })
export class GamepadMenuService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private frame = 0;
  private previous: boolean[] = [];
  private repeatAt = 0;

  start(): void {
    const view = this.document.defaultView;
    if (!view || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    view.addEventListener('gamepadconnected', () => this.run());
    view.addEventListener('gamepaddisconnected', () => { if (!this.connected()) this.stop(); });
    if (this.connected()) this.run();
  }

  private connected(): boolean {
    return [...(navigator.getGamepads?.() ?? [])].some(Boolean);
  }

  private run(): void {
    if (this.frame) return;
    this.zone.runOutsideAngular(() => {
      const tick = (time: number) => { this.poll(time); this.frame = requestAnimationFrame(tick); };
      this.frame = requestAnimationFrame(tick);
    });
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private poll(time: number): void {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(Boolean);
    if (!pad) return;
    const inMatch = !!this.document.querySelector('canvas[aria-label="Live football pitch"]') && !this.document.querySelector('.pause-layer, dialog[open]');
    const pressed = pad.buttons.map(button => button.pressed);
    const edge = (index: number) => pressed[index] && !this.previous[index];
    const axisY = pad.axes[1] ?? 0, axisX = pad.axes[0] ?? 0;
    const down = pressed[13] || axisY > 0.6 || pressed[15] || axisX > 0.6;
    const up = pressed[12] || axisY < -0.6 || pressed[14] || axisX < -0.6;
    if (!inMatch) {
      if ((down || up) && time >= this.repeatAt) {
        this.move(down ? 1 : -1);
        this.repeatAt = time + (this.repeatAt && time - this.repeatAt < 400 ? 120 : 260);
      } else if (!down && !up) this.repeatAt = 0;
      if (edge(0)) this.zone.run(() => (this.document.activeElement as HTMLElement | null)?.click());
      if (edge(1)) this.zone.run(() => this.back());
    }
    this.previous = pressed;
  }

  private move(direction: 1 | -1): void {
    const scope = this.document.querySelector<HTMLElement>('dialog[open], [aria-modal="true"]') ?? this.document.body;
    const items = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null);
    if (!items.length) return;
    const index = items.indexOf(this.document.activeElement as HTMLElement);
    const next = items[(index + direction + items.length) % items.length] ?? items[0];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  private back(): void {
    const target = this.document.activeElement ?? this.document.body;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    const handled = !target.dispatchEvent(escape);
    if (!handled && !this.document.querySelector('dialog[open], [aria-modal="true"]')) this.document.defaultView?.history.back();
  }
}
