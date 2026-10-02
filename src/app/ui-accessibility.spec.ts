import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { localizeTransferText } from './shared/transfer-text';
import { TACTIC_LABELS, tacticLabel } from './shared/tactic-labels';
import { ModalDirective } from './shared/modal.directive';
import { FACILITIES } from './core/services/facilities.service';

@Component({
  imports: [ModalDirective],
  template: `
    <button id="opener">open</button>
    @if (open()) {
      <div role="dialog" appModal (dismiss)="open.set(false)">
        <button id="first">first</button><button id="last">last</button>
      </div>
    }
  `,
})
class ModalHost { readonly open = signal(false); }

describe('UI, language and accessibility', () => {
  it('translates stored German transfer texts, including templated ones, and leaves German untouched', () => {
    expect(localizeTransferText('Der Kader ist voll.', 'en')).toBe('The squad is full.');
    expect(localizeTransferText('HBR bietet CR 1.250.000.', 'en')).toBe('HBR offer CR 1,250,000.');
    expect(localizeTransferText('Mika Stone wechselt zu SUN.', 'en')).toBe('Mika Stone joins SUN.');
    expect(localizeTransferText('Der Kader ist voll.', 'de')).toBe('Der Kader ist voll.');
    expect(localizeTransferText('Unbekannt', 'en')).toBe('Unbekannt');
  });

  it('gives every tactical enum and facility a label in both languages', () => {
    for (const label of Object.values(TACTIC_LABELS)) { expect(label.de).toBeTruthy(); expect(label.en).toBeTruthy(); }
    expect(tacticLabel('gegenpress', 'de')).toBe('Gegenpressing');
    expect(tacticLabel('ultra-defensive', 'en')).toBe('Park the bus');
    for (const facility of FACILITIES) {
      expect(facility.name.de).not.toBe('');
      expect(facility.effect(3).de).not.toBe(facility.effect(3).en);
    }
  });

  it('moves focus into a modal, traps Tab, closes on Escape and returns focus to the opener', async () => {
    const fixture = TestBed.createComponent(ModalHost);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    document.body.appendChild(fixture.nativeElement);
    opener.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const first = dialog.querySelector('#first') as HTMLButtonElement, last = dialog.querySelector('#last') as HTMLButtonElement;
    last.focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    // jsdom has no layout, so the trap works on DOM order: focus wraps from last to first.
    expect([first, last]).toContain(document.activeElement);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    fixture.nativeElement.remove();
  });
});
