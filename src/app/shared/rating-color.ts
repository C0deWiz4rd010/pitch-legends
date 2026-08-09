/** Maps a 0-99 rating to a themed color for badges and bars. */
export function ratingColor(value: number): string {
  if (value >= 85) return '#38e07b';
  if (value >= 78) return '#86e06b';
  if (value >= 70) return '#f5c542';
  if (value >= 60) return '#f59e0b';
  return '#f5455c';
}

/** Softer background tint for the same rating scale. */
export function ratingTint(value: number): string {
  if (value >= 85) return 'rgba(56, 224, 123, 0.16)';
  if (value >= 78) return 'rgba(134, 224, 107, 0.16)';
  if (value >= 70) return 'rgba(245, 197, 66, 0.16)';
  if (value >= 60) return 'rgba(245, 158, 11, 0.16)';
  return 'rgba(245, 69, 92, 0.16)';
}

export function moraleIcon(morale: number): string {
  if (morale >= 80) return '++';
  if (morale >= 60) return '+';
  if (morale >= 40) return '=';
  if (morale >= 25) return '-';
  return '--';
}

export function formatCoins(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M';
  if (value >= 1000) return Math.round(value / 1000) + 'k';
  return String(value);
}
