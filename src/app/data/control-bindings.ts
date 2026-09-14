import { InputAction } from '../models/game.model';

export type HumanInputDevice = 'keyboard' | 'gamepad' | 'touch';
export type ControlChapter = 'move' | 'pass' | 'attack' | 'defend' | 'tactics' | 'touch';

export interface ControlGlyph {
  label: string;
  asset?: string;
  tone?: 'green' | 'blue' | 'red' | 'yellow' | 'purple';
}

export interface ControlBinding {
  action: InputAction;
  chapter: Exclude<ControlChapter, 'touch'>;
  title: { de: string; en: string };
  description: { de: string; en: string };
  keyboard: ControlGlyph[];
  gamepad: ControlGlyph[];
  touch: ControlGlyph[];
}

const ASSET = '/assets/input-prompts/';

export const CONTROL_BINDINGS: readonly ControlBinding[] = [
  {
    action: 'move', chapter: 'move', title: { de: 'Bewegen & zielen', en: 'Move & aim' },
    description: { de: 'WASD oder Pfeiltasten bewegen den Spieler. Ohne Ball legst du damit auch die Pressingrichtung fest.', en: 'WASD or arrow keys move the player and set the pressing direction off the ball.' },
    keyboard: [{ label: 'W', asset: `${ASSET}key-w.png` }, { label: 'A', asset: `${ASSET}key-a.png` }, { label: 'S', asset: `${ASSET}key-s.png` }, { label: 'D', asset: `${ASSET}key-d.png` }],
    gamepad: [{ label: 'LEFT STICK' }], touch: [{ label: 'STICK', tone: 'blue' }],
  },
  {
    action: 'switch', chapter: 'move', title: { de: 'Spieler wechseln', en: 'Switch player' },
    description: { de: 'Leertaste/LB wechselt zwischen drei passenden Feldspielern. Richtung hilft bei der Auswahl. Deine Wahl bleibt 1,5 Sekunden geschützt. Spielerwahl „Ruhig“ folgt erst gesichertem Ballbesitz; „Manuell“ überlässt dir die Wechsel.', en: 'Space/LB cycles three suitable outfield players. Aim to guide the choice. Your selection is protected for 1.5 seconds. Quiet switching follows secure possession; Manual leaves switching to you.' },
    keyboard: [{ label: 'SPACE' }], gamepad: [{ label: 'LB' }], touch: [{ label: 'SW', tone: 'blue' }],
  },
  {
    action: 'pass', chapter: 'pass', title: { de: 'Kurzpass / Stellungstackling', en: 'Short pass / standing tackle' },
    description: { de: 'J/A halten und loslassen zum Passen; nach 0,8 Sekunden ist die Kraft voll. Sprint + Pass startet einen Doppelpasslauf. Kurz vor der Annahme loslassen ermöglicht direktes Weiterspielen. Gegen den Ball führt J/A ein Stellungstackling aus.', en: 'Hold and release J/A to pass; power is full after 0.8 seconds. Sprint + pass starts a give-and-go run. Release just before receiving to play first time. Against the ball J/A performs a standing tackle.' },
    keyboard: [{ label: 'J', asset: `${ASSET}key-j.png` }], gamepad: [{ label: 'A', asset: `${ASSET}gamepad-a.png` }], touch: [{ label: 'A', tone: 'green' }],
  },
  {
    action: 'through', chapter: 'pass', title: { de: 'Steilpass / Torwart rufen', en: 'Through ball / rush keeper' },
    description: { de: 'K/Y spielt in den Laufraum. In der Defensive lässt dieselbe Taste den Torwart herauslaufen.', en: 'K/Y passes into space. In defence the same button rushes the goalkeeper.' },
    keyboard: [{ label: 'K', asset: `${ASSET}key-k.png` }], gamepad: [{ label: 'Y', asset: `${ASSET}gamepad-y.png` }], touch: [{ label: 'Y', tone: 'yellow' }],
  },
  {
    action: 'lob', chapter: 'pass', title: { de: 'Lob / Flanke / Grätsche', en: 'Lob / cross / slide' },
    description: { de: 'U/X hebt den Ball für Flanken und Lobs an. Ohne Ball startest du eine riskantere Grätsche.', en: 'U/X lifts the ball for crosses and lobs. Without the ball it starts a riskier slide tackle.' },
    keyboard: [{ label: 'U', asset: `${ASSET}key-u.png` }], gamepad: [{ label: 'X', asset: `${ASSET}gamepad-x.png` }], touch: [{ label: 'X', tone: 'blue' }],
  },
  {
    action: 'shoot', chapter: 'attack', title: { de: 'Schuss / Befreiung', en: 'Shoot / clearance' },
    description: { de: 'L/B halten, zielen und loslassen. Kurzes Antippen schießt flach, nach 0,9 Sekunden ist die Kraft voll. I/RB beim Loslassen halten für einen angeschnittenen Schuss; U/X für einen Lupfer.', en: 'Hold L/B, aim and release. A quick tap shoots low; full power takes 0.9 seconds. Hold I/RB on release for a finesse shot, or U/X for a chip.' },
    keyboard: [{ label: 'L', asset: `${ASSET}key-l.png` }], gamepad: [{ label: 'B', asset: `${ASSET}gamepad-b.png` }], touch: [{ label: 'B', tone: 'red' }],
  },
  {
    action: 'sprint', chapter: 'attack', title: { de: 'Sprint', en: 'Sprint' },
    description: { de: 'Shift/RT erhöht das Tempo, kostet Fitness und macht enge Richtungswechsel schwieriger.', en: 'Shift/RT raises speed, drains fitness, and makes tight turns harder.' },
    keyboard: [{ label: 'SHIFT' }], gamepad: [{ label: 'RT' }], touch: [{ label: 'RT', tone: 'blue' }],
  },
  {
    action: 'skill', chapter: 'attack', title: { de: 'Skill / enge Führung', en: 'Skill / close control' },
    description: { de: 'I/RB plus Richtung löst Ballrolle oder Drag Back aus. Ohne Ball rufst du genau einen Mitspieler zum Pressing.', en: 'I/RB plus direction performs a ball roll or drag back. Off the ball it calls one teammate to press.' },
    keyboard: [{ label: 'I' }], gamepad: [{ label: 'RB' }], touch: [{ label: 'SK', tone: 'purple' }],
  },
  {
    action: 'keeper', chapter: 'defend', title: { de: 'Torwart', en: 'Goalkeeper' },
    description: { de: 'K/Y halten ruft den Torwart heraus. Er fängt oder wehrt erreichbare Bälle ab, sammelt gefangene Bälle und eröffnet selbstständig. Die automatische Spielerwahl springt nicht auf den Torwart.', en: 'Hold K/Y to rush the keeper. He catches or parries reachable balls, gathers catches and distributes automatically. Automatic player switching does not select the goalkeeper.' },
    keyboard: [{ label: 'K', asset: `${ASSET}key-k.png` }], gamepad: [{ label: 'Y', asset: `${ASSET}gamepad-y.png` }], touch: [{ label: 'Y', tone: 'yellow' }],
  },
  {
    action: 'tactics', chapter: 'tactics', title: { de: 'Quick-Taktik', en: 'Quick tactics' },
    description: { de: 'Q öffnet Mentalität, Pressing und Breite. Die Partie läuft dabei stark verlangsamt.', en: 'Q opens mentality, pressing, and width while the match slows down.' },
    keyboard: [{ label: 'Q' }], gamepad: [{ label: 'D-PAD' }], touch: [{ label: 'TAKTIK', tone: 'purple' }],
  },
] as const;

export const CONTROL_CHAPTERS: readonly { id: ControlChapter; de: string; en: string }[] = [
  { id: 'move', de: 'Bewegung', en: 'Movement' },
  { id: 'pass', de: 'Passen', en: 'Passing' },
  { id: 'attack', de: 'Angriff', en: 'Attack' },
  { id: 'defend', de: 'Verteidigen', en: 'Defending' },
  { id: 'tactics', de: 'Taktik', en: 'Tactics' },
  { id: 'touch', de: 'Touch', en: 'Touch' },
] as const;

export const CONTROL_INPUT_MAP = {
  sprint: { keyboard: ['ShiftLeft', 'ShiftRight'], gamepadButton: 7 },
  pass: { keyboard: ['KeyJ'], gamepadButton: 0 },
  through: { keyboard: ['KeyK'], gamepadButton: 3 },
  lob: { keyboard: ['KeyU'], gamepadButton: 2 },
  shoot: { keyboard: ['KeyL'], gamepadButton: 1 },
  skill: { keyboard: ['KeyI'], gamepadButton: 5 },
  switch: { keyboard: ['Space'], gamepadButton: 4 },
} as const;

export const MOVEMENT_KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
} as const;
