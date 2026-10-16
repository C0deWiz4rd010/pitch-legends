import { Page } from '@playwright/test';

/**
 * Engine messages that are not errors of the game:
 * - Safari does not know the `interactive-widget` viewport key (used by Chrome on Android) and says so.
 * - Firefox reports font downloads cut short by the next navigation (NS_BINDING_ABORTED).
 */
const BROWSER_NOISE = [
  /Viewport argument key "interactive-widget" not recognized/,
  /downloadable font: download failed.*status=2152398850/,
];

/** Collects page errors and console errors of the game; the returned array fills while the test runs. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!BROWSER_NOISE.some((pattern) => pattern.test(text))) errors.push(text);
  });
  return errors;
}
