export type CrestShape = 'classic' | 'round' | 'diamond' | 'banner' | 'tower' | 'modern';
export type CrestPattern = 'solid' | 'halves' | 'quarters' | 'stripe' | 'hoops' | 'sash' | 'chevron';
export type CrestBorder = 'single' | 'double' | 'riveted';
export type CrestEmblem =
  | 'star'
  | 'crown'
  | 'tower'
  | 'phoenix'
  | 'wolf'
  | 'wings'
  | 'bolt'
  | 'wave'
  | 'mountain'
  | 'sun'
  | 'moon'
  | 'anchor'
  | 'football'
  | 'flame'
  | 'oak'
  | 'sword'
  | 'shield'
  | 'comet'
  | 'lion'
  | 'falcon'
  | 'fist'
  | 'rose'
  | 'gear'
  | 'initials';

export type KitPattern =
  | 'solid'
  | 'halves'
  | 'stripes'
  | 'hoops'
  | 'sash'
  | 'chest-band'
  | 'pinstripes'
  | 'chevron';

export interface CrestDesign {
  shape: CrestShape;
  pattern: CrestPattern;
  emblem: CrestEmblem;
  border: CrestBorder;
  primary: string;
  secondary: string;
  accent: string;
  initials: boolean;
}

export interface KitDesign {
  pattern: KitPattern;
  shirt: string;
  secondary: string;
  trim: string;
  shorts: string;
  socks: string;
  number: string;
  collar: 'crew' | 'v' | 'polo';
  sleeve: 'plain' | 'cuff' | 'raglan';
}

export interface StadiumVisualTheme {
  atmosphere: 'day' | 'sunset' | 'night';
  standStyle: 'compact' | 'bowl' | 'classic' | 'industrial';
  seatColor: string;
  bannerPattern: CrestPattern;
  sponsorSeed: number;
}

export interface ClubVisualIdentity {
  seed: number;
  crest: CrestDesign;
  kits: {
    home: KitDesign;
    away: KitDesign;
    goalkeeper: KitDesign;
  };
  stadium: StadiumVisualTheme;
}

export interface PlayerVisualIdentity {
  seed: number;
  skinTone: number;
  headShape: number;
  hairStyle: number;
  hairColor: number;
  facialHair: number;
  bodyBuild: 'slim' | 'average' | 'strong';
  bootStyle: number;
  bootColor: string;
  longSleeves: boolean;
  wristTape: 'none' | 'left' | 'right' | 'both';
  headAccessory: 'none' | 'headband' | 'protective-cap';
  goalkeeperGloves: number;
  portraitSeed: string;
}
