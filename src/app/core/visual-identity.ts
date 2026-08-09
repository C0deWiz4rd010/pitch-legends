import { GameState, SAVE_VERSION } from '../models/game.model';
import { Player } from '../models/player.model';
import { Team } from '../models/team.model';
import {
  ClubVisualIdentity,
  CrestBorder,
  CrestDesign,
  CrestEmblem,
  CrestPattern,
  CrestShape,
  KitDesign,
  KitPattern,
  PlayerVisualIdentity,
} from '../models/visual.model';
import { Rng } from './util';

export const CREST_SHAPES: readonly CrestShape[] = ['classic', 'round', 'diamond', 'banner', 'tower', 'modern'];
export const CREST_PATTERNS: readonly CrestPattern[] = ['solid', 'halves', 'quarters', 'stripe', 'hoops', 'sash', 'chevron'];
export const CREST_BORDERS: readonly CrestBorder[] = ['single', 'double', 'riveted'];
export const KIT_PATTERNS: readonly KitPattern[] = ['solid', 'halves', 'stripes', 'hoops', 'sash', 'chest-band', 'pinstripes', 'chevron'];
export const CREST_EMBLEMS: readonly CrestEmblem[] = [
  'star', 'crown', 'tower', 'phoenix', 'wolf', 'wings', 'bolt', 'wave', 'mountain', 'sun', 'moon', 'anchor',
  'football', 'flame', 'oak', 'sword', 'shield', 'comet', 'lion', 'falcon', 'fist', 'rose', 'gear', 'initials',
];

const BOOT_COLORS = ['#f4f4df', '#141727', '#ff4f78', '#37d8ff', '#ffd34e', '#54f28b', '#e55bff', '#ff9f43', '#b7c4e8', '#d4ff63', '#ef8354', '#8d6cff'];
const AWAY_PALETTES = [
  ['#f4f4df', '#172144', '#ff4f78'],
  ['#0a1026', '#37d8ff', '#ffd34e'],
  ['#ffd34e', '#3b1d0e', '#ff4f78'],
  ['#d9ffef', '#12623e', '#e55bff'],
  ['#f2eaff', '#56308f', '#37d8ff'],
  ['#ffedf2', '#8d173c', '#54f28b'],
] as const;

export function hash32(value: string | number): number {
  const text = String(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createClubVisualIdentity(
  name: string,
  shortName: string,
  primary: string,
  secondary: string,
  seed = hash32(`${name}|${shortName}|${primary}|${secondary}`),
): ClubVisualIdentity {
  const rng = new Rng(seed);
  const accent = pickAccent(primary, secondary, rng);
  const emblem = semanticEmblem(name, rng);
  const home = createKit(rng, primary, secondary, accent, false);
  const awayPalette = selectAwayPalette(home, rng);
  const away = createKit(rng, awayPalette[0], awayPalette[1], awayPalette[2], true);
  const goalkeeper = createKeeperKit(rng, home, away);
  const crest: CrestDesign = {
    shape: rng.pick(CREST_SHAPES),
    pattern: rng.pick(CREST_PATTERNS),
    emblem,
    border: rng.pick(CREST_BORDERS),
    primary: normalizeHex(primary, '#38e07b'),
    secondary: normalizeHex(secondary, '#07120b'),
    accent,
    initials: emblem === 'initials' || rng.bool(0.18),
  };
  return {
    seed,
    crest,
    kits: { home, away, goalkeeper },
    stadium: {
      atmosphere: rng.pick(['day', 'sunset', 'night'] as const),
      standStyle: rng.pick(['compact', 'bowl', 'classic', 'industrial'] as const),
      seatColor: mixHex(primary, '#172144', 0.55),
      bannerPattern: rng.pick(CREST_PATTERNS),
      sponsorSeed: rng.snapshot(),
    },
  };
}

export function createPlayerVisualIdentity(playerId: string, salt = 0): PlayerVisualIdentity {
  const seed = hash32(`${playerId}|appearance|${salt}`);
  const rng = new Rng(seed);
  const wristTape = rng.pick(['none', 'none', 'none', 'left', 'right', 'both'] as const);
  const accessoryRoll = rng.int(0, 99);
  return {
    seed,
    skinTone: rng.int(0, 7),
    headShape: rng.int(0, 7),
    hairStyle: rng.int(0, 17),
    hairColor: rng.int(0, 7),
    facialHair: rng.int(0, 5),
    bodyBuild: rng.pick(['slim', 'average', 'average', 'strong'] as const),
    bootStyle: rng.int(0, 11),
    bootColor: BOOT_COLORS[rng.int(0, BOOT_COLORS.length - 1)],
    longSleeves: rng.bool(0.22),
    wristTape,
    headAccessory: accessoryRoll < 7 ? 'headband' : accessoryRoll < 9 ? 'protective-cap' : 'none',
    goalkeeperGloves: rng.int(0, 5),
    portraitSeed: `pitch-legends-${playerId}-${seed.toString(36)}`,
  };
}

export function ensureGameVisuals(game: GameState): GameState {
  const migrated = structuredClone(game) as GameState;
  const crestSignatures = new Set<string>();
  for (const team of migrated.teams) {
    let salt = 0;
    let visuals = isClubVisualIdentity(team.visuals)
      ? team.visuals
      : createClubVisualIdentity(team.name, team.shortName, team.kit.primary, team.kit.secondary, hash32(team.id));
    while (crestSignatures.has(crestSignature(visuals.crest)) && salt < 16) {
      salt++;
      visuals = createClubVisualIdentity(team.name, team.shortName, team.kit.primary, team.kit.secondary, hash32(`${team.id}|${salt}`));
    }
    if (crestSignatures.has(crestSignature(visuals.crest))) {
      visuals.crest.emblem = 'initials';
      visuals.crest.initials = true;
      visuals.seed = hash32(`${team.id}|initials`);
    }
    team.visuals = visuals;
    crestSignatures.add(crestSignature(visuals.crest));
    ensureSquadVisuals(team.players);
  }
  ensureSquadVisuals(migrated.transfers.freeAgents);
  migrated.settings.controlLearning = {
    introSeen: migrated.settings.controlLearning?.introSeen ?? false,
    completedActions: migrated.settings.controlLearning?.completedActions ?? [],
    dismissedHints: migrated.settings.controlLearning?.dismissedHints ?? [],
    preferredDevice: migrated.settings.controlLearning?.preferredDevice ?? 'keyboard',
  };
  migrated.version = SAVE_VERSION;
  return migrated;
}

export function ensureTeamVisuals(team: Team): Team {
  const upgraded = structuredClone(team) as Team;
  if (!isClubVisualIdentity(upgraded.visuals)) {
    upgraded.visuals = createClubVisualIdentity(upgraded.name, upgraded.shortName, upgraded.kit.primary, upgraded.kit.secondary, hash32(upgraded.id));
  }
  ensureSquadVisuals(upgraded.players);
  return upgraded;
}

export function crestSignature(crest: CrestDesign): string {
  return `${crest.shape}|${crest.pattern}|${crest.emblem}|${crest.border}|${crest.initials}`;
}

export function playerVisualSignature(visuals: PlayerVisualIdentity): string {
  return [visuals.skinTone, visuals.headShape, visuals.hairStyle, visuals.hairColor, visuals.facialHair, visuals.bodyBuild, visuals.bootStyle, visuals.longSleeves, visuals.headAccessory].join('|');
}

export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastText(background: string): string {
  return relativeLuminance(background) > 0.48 ? '#06120b' : '#f4f4df';
}

export function mixHex(a: string, b: string, weight = 0.5): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex(
    Math.round(ca[0] * (1 - weight) + cb[0] * weight),
    Math.round(ca[1] * (1 - weight) + cb[1] * weight),
    Math.round(ca[2] * (1 - weight) + cb[2] * weight),
  );
}

function ensureSquadVisuals(players: Player[]): void {
  const signatures = new Set<string>();
  for (const player of players) {
    let salt = 0;
    let visuals = isPlayerVisualIdentity(player.visuals) ? player.visuals : createPlayerVisualIdentity(player.id);
    while (signatures.has(playerVisualSignature(visuals))) visuals = createPlayerVisualIdentity(player.id, ++salt);
    player.visuals = visuals;
    signatures.add(playerVisualSignature(visuals));
  }
}

function createKit(rng: Rng, shirt: string, secondary: string, trim: string, away: boolean): KitDesign {
  return {
    pattern: rng.pick(away ? KIT_PATTERNS.filter((pattern) => pattern !== 'solid') : KIT_PATTERNS),
    shirt: normalizeHex(shirt, '#38e07b'),
    secondary: normalizeHex(secondary, '#07120b'),
    trim: normalizeHex(trim, '#f4f4df'),
    shorts: rng.bool(0.46) ? normalizeHex(secondary, '#07120b') : mixHex(shirt, '#07120b', 0.42),
    socks: rng.bool(0.55) ? normalizeHex(shirt, '#38e07b') : normalizeHex(secondary, '#07120b'),
    number: contrastText(shirt),
    collar: rng.pick(['crew', 'v', 'polo'] as const),
    sleeve: rng.pick(['plain', 'cuff', 'raglan'] as const),
  };
}

function createKeeperKit(rng: Rng, home: KitDesign, away: KitDesign): KitDesign {
  const options = ['#ffd34e', '#e55bff', '#ff9f43', '#37d8ff', '#c7ff4a', '#ff4f78'];
  const color = options.sort((a, b) => Math.min(contrastRatio(b, home.shirt), contrastRatio(b, away.shirt)) - Math.min(contrastRatio(a, home.shirt), contrastRatio(a, away.shirt)))[0];
  const secondary = mixHex(color, '#07120b', 0.68);
  return createKit(rng, color, secondary, contrastText(color), true);
}

function selectAwayPalette(home: KitDesign, rng: Rng): readonly [string, string, string] {
  const choices = rng.shuffle(AWAY_PALETTES);
  return choices.find((palette) => contrastRatio(home.shirt, palette[0]) >= 3 && colorDistance(home.shirt, palette[0]) >= 120) ?? choices[0];
}

function semanticEmblem(name: string, rng: Rng): CrestEmblem {
  const lower = name.toLowerCase();
  const semantic: Array<[string[], CrestEmblem[]]> = [
    [['solar', 'nova', 'zenith'], ['sun', 'star', 'comet']],
    [['frost', 'high', 'cliff'], ['mountain', 'tower', 'moon']],
    [['phoenix', 'crimson'], ['phoenix', 'flame', 'wings']],
    [['storm', 'vanguard'], ['bolt', 'shield', 'falcon']],
    [['emerald', 'wood'], ['oak', 'rose', 'wolf']],
    [['iron', 'gladiator', 'titan'], ['gear', 'sword', 'fist']],
    [['meridian', 'aurora'], ['wave', 'moon', 'star']],
  ];
  const match = semantic.find(([keys]) => keys.some((key) => lower.includes(key)));
  return match ? rng.pick(match[1]) : rng.pick(CREST_EMBLEMS);
}

function pickAccent(primary: string, secondary: string, rng: Rng): string {
  const candidates = ['#f4f4df', '#ffd34e', '#37d8ff', '#54f28b', '#ff4f78', '#e55bff'];
  const sorted = rng.shuffle(candidates).sort((a, b) => Math.min(contrastRatio(b, primary), contrastRatio(b, secondary)) - Math.min(contrastRatio(a, primary), contrastRatio(a, secondary)));
  return sorted[0];
}

function isClubVisualIdentity(value: unknown): value is ClubVisualIdentity {
  if (!value || typeof value !== 'object') return false;
  const visual = value as Partial<ClubVisualIdentity>;
  return typeof visual.seed === 'number' && !!visual.crest && !!visual.kits?.home && !!visual.kits.away && !!visual.kits.goalkeeper && !!visual.stadium;
}

function isPlayerVisualIdentity(value: unknown): value is PlayerVisualIdentity {
  if (!value || typeof value !== 'object') return false;
  const visual = value as Partial<PlayerVisualIdentity>;
  return typeof visual.seed === 'number' && typeof visual.skinTone === 'number' && typeof visual.hairStyle === 'number' && typeof visual.portraitSeed === 'string';
}

function normalizeHex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function relativeLuminance(color: string): number {
  const rgb = parseHex(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function colorDistance(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
}

function parseHex(color: string): [number, number, number] {
  const clean = normalizeHex(color, '#000000').slice(1);
  return [Number.parseInt(clean.slice(0, 2), 16), Number.parseInt(clean.slice(2, 4), 16), Number.parseInt(clean.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')).join('')}`;
}
