import { Team } from '../models/team.model';
import { KitDesign, KitPattern } from '../models/visual.model';
import { contrastRatio, mixHex } from './visual-identity';

export interface PixelRamp {
  outline: string;
  shadow: string;
  base: string;
  highlight: string;
}

export interface MatchKitSelection {
  home: KitDesign;
  away: KitDesign;
  homeGoalkeeper: KitDesign;
  awayGoalkeeper: KitDesign;
  emergencyAway: boolean;
}

const EMERGENCY_COLOURS = ['#f8fafc', '#07111f', '#ffd23f', '#24d6c8', '#ff5d7d', '#9b7cff'] as const;
const EMERGENCY_PATTERNS: readonly KitPattern[] = ['halves', 'stripes', 'hoops', 'sash', 'chevron'];

/** Four hard pixel shades derived from any persisted kit colour. */
export function createPixelRamp(base: string): PixelRamp {
  const normalized = normalizeHex(base);
  const luminance = relativeLuminance(normalized);
  return {
    outline: mixHex(normalized, '#050711', luminance < 0.09 ? 0.46 : 0.72),
    shadow: mixHex(normalized, '#050711', luminance < 0.09 ? 0.2 : 0.38),
    base: normalized,
    highlight: mixHex(normalized, '#f8fafc', luminance < 0.09 ? 0.5 : 0.26),
  };
}

/** Resolve fixture kits once; the returned choice is deterministic and never mutates a club. */
export function resolveMatchKits(home: Team, away: Team): MatchKitSelection {
  const homeKit = home.visuals.kits.home;
  const candidates = [away.visuals.kits.away, away.visuals.kits.home];
  const bestAway = [...candidates].sort((a, b) => kitSeparationScore(homeKit, b) - kitSeparationScore(homeKit, a))[0];
  const emergencyAway = kitSeparationScore(homeKit, bestAway) < 8;
  const awayKit = emergencyAway ? createEmergencyKit(away, [homeKit], false) : bestAway;
  const homeGoalkeeper = readableKeeperKit(home, [homeKit, awayKit], 0);
  const awayGoalkeeper = readableKeeperKit(away, [homeKit, awayKit, homeGoalkeeper], 1);
  return { home: homeKit, away: awayKit, homeGoalkeeper, awayGoalkeeper, emergencyAway };
}

export function kitSeparationScore(a: KitDesign, b: KitDesign): number {
  const shirtContrast = contrastRatio(a.shirt, b.shirt);
  const shortsContrast = contrastRatio(a.shorts, b.shorts);
  const socksContrast = contrastRatio(a.socks, b.socks);
  const colourDistance = rgbDistance(a.shirt, b.shirt) / 64;
  const patternBonus = a.pattern === b.pattern ? 0 : 1.4;
  return shirtContrast * 1.7 + shortsContrast * 0.35 + socksContrast * 0.2 + colourDistance + patternBonus;
}

export function kitVisualSignature(kit: KitDesign): string {
  return [kit.pattern, kit.shirt, kit.secondary, kit.trim, kit.shorts, kit.socks, kit.number, kit.collar, kit.sleeve].join(':');
}

function readableKeeperKit(team: Team, visible: KitDesign[], salt: number): KitDesign {
  const keeper = team.visuals.kits.goalkeeper;
  const lowestScore = Math.min(...visible.map((kit) => kitSeparationScore(kit, keeper)));
  return lowestScore >= 7 ? keeper : createEmergencyKit(team, visible, true, salt);
}

function createEmergencyKit(team: Team, visible: KitDesign[], goalkeeper: boolean, salt = 0): KitDesign {
  const ranked = EMERGENCY_COLOURS
    .map((colour, index) => ({
      colour,
      index,
      score: Math.min(...visible.map((kit) => contrastRatio(kit.shirt, colour) + rgbDistance(kit.shirt, colour) / 72)),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const primary = ranked[0].colour;
  const secondary = ranked.find((candidate) => contrastRatio(primary, candidate.colour) >= 3)?.colour ?? (relativeLuminance(primary) > 0.4 ? '#07111f' : '#f8fafc');
  const patternIndex = Math.abs(team.visuals.seed + salt * 11) % EMERGENCY_PATTERNS.length;
  return {
    pattern: goalkeeper ? 'solid' : EMERGENCY_PATTERNS[patternIndex],
    shirt: primary,
    secondary,
    trim: secondary,
    shorts: goalkeeper ? mixHex(primary, '#07111f', 0.42) : secondary,
    socks: primary,
    number: relativeLuminance(primary) > 0.42 ? '#07111f' : '#f8fafc',
    collar: goalkeeper ? 'crew' : team.visuals.kits.away.collar,
    sleeve: goalkeeper ? 'cuff' : team.visuals.kits.away.sleeve,
  };
}

function normalizeHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#7f8799';
}

function rgbDistance(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function relativeLuminance(value: string): number {
  const channels = parseHex(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function parseHex(value: string): [number, number, number] {
  const hex = normalizeHex(value).slice(1);
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}
