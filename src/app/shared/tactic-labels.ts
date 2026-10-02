import type { Mentality, PressingIntensity, Width } from '../models/enums';
import type { MatchWeather } from '../models/match.model';
import type { RecruitmentPhilosophy, TacticalPhilosophy } from '../models/game.model';

type Label = { de: string; en: string };

/** Readable, bilingual names for enum values that used to be shown raw. */
export const TACTIC_LABELS: Record<Mentality | PressingIntensity | Width | TacticalPhilosophy | RecruitmentPhilosophy | MatchWeather, Label> = {
  academy: { de: 'Nachwuchs', en: 'Academy' },
  stars: { de: 'Stars', en: 'Stars' },
  value: { de: 'Preis-Leistung', en: 'Value' },
  athletic: { de: 'Athletik', en: 'Athletic' },
  loyalty: { de: 'Treue', en: 'Loyalty' },
  'ultra-defensive': { de: 'Mauern', en: 'Park the bus' },
  defensive: { de: 'Defensiv', en: 'Defensive' },
  balanced: { de: 'Ausgewogen', en: 'Balanced' },
  attacking: { de: 'Offensiv', en: 'Attacking' },
  'ultra-attacking': { de: 'Alles nach vorn', en: 'All out attack' },
  low: { de: 'Tief', en: 'Low' },
  medium: { de: 'Mittel', en: 'Medium' },
  high: { de: 'Hoch', en: 'High' },
  gegenpress: { de: 'Gegenpressing', en: 'Gegenpress' },
  narrow: { de: 'Eng', en: 'Narrow' },
  wide: { de: 'Breit', en: 'Wide' },
  possession: { de: 'Ballbesitz', en: 'Possession' },
  counter: { de: 'Konter', en: 'Counter' },
  'low-block': { de: 'Tiefer Block', en: 'Low block' },
  clear: { de: 'Klar', en: 'Clear' },
  rain: { de: 'Regen', en: 'Rain' },
  storm: { de: 'Sturm', en: 'Storm' },
};

export function tacticLabel(value: string | undefined | null, locale: 'de' | 'en'): string {
  if (!value) return '—';
  const label = TACTIC_LABELS[value as keyof typeof TACTIC_LABELS];
  return label ? label[locale] : value;
}
