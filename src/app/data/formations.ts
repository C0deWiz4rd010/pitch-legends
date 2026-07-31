import { Formation, FormationSlot, defaultInstruction } from '../models/tactics.model';
import { Position } from '../models/enums';
import { getRole } from './roles';

interface SlotTemplate {
  position: Position;
  x: number;
  y: number;
  roleId: string;
}

interface FormationTemplate {
  id: string;
  name: string;
  slots: SlotTemplate[];
}

/** x: 0 own goal -> 1 opponent goal. y: 0 left touchline -> 1 right touchline. */
export const FORMATION_TEMPLATES: FormationTemplate[] = [
  {
    id: '4-4-2',
    name: '4-4-2',
    slots: [
      { position: 'GK', x: 0.06, y: 0.5, roleId: 'gk' },
      { position: 'LB', x: 0.24, y: 0.13, roleId: 'fb' },
      { position: 'LCB', x: 0.2, y: 0.38, roleId: 'cd' },
      { position: 'RCB', x: 0.2, y: 0.62, roleId: 'cd' },
      { position: 'RB', x: 0.24, y: 0.87, roleId: 'fb' },
      { position: 'LM', x: 0.54, y: 0.14, roleId: 'w' },
      { position: 'CM', x: 0.48, y: 0.4, roleId: 'cm' },
      { position: 'CM', x: 0.48, y: 0.6, roleId: 'b2b' },
      { position: 'RM', x: 0.54, y: 0.86, roleId: 'w' },
      { position: 'ST', x: 0.82, y: 0.4, roleId: 'poacher' },
      { position: 'ST', x: 0.82, y: 0.6, roleId: 'cf' },
    ],
  },
  {
    id: '4-3-3',
    name: '4-3-3',
    slots: [
      { position: 'GK', x: 0.06, y: 0.5, roleId: 'gk' },
      { position: 'LB', x: 0.24, y: 0.13, roleId: 'fb' },
      { position: 'LCB', x: 0.2, y: 0.38, roleId: 'bpd' },
      { position: 'RCB', x: 0.2, y: 0.62, roleId: 'cd' },
      { position: 'RB', x: 0.24, y: 0.87, roleId: 'fb' },
      { position: 'CDM', x: 0.42, y: 0.5, roleId: 'dlp' },
      { position: 'CM', x: 0.56, y: 0.32, roleId: 'b2b' },
      { position: 'CM', x: 0.56, y: 0.68, roleId: 'cm' },
      { position: 'LW', x: 0.8, y: 0.16, roleId: 'if' },
      { position: 'ST', x: 0.86, y: 0.5, roleId: 'cf' },
      { position: 'RW', x: 0.8, y: 0.84, roleId: 'if' },
    ],
  },
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    slots: [
      { position: 'GK', x: 0.06, y: 0.5, roleId: 'gk' },
      { position: 'LB', x: 0.24, y: 0.13, roleId: 'fb' },
      { position: 'LCB', x: 0.2, y: 0.38, roleId: 'cd' },
      { position: 'RCB', x: 0.2, y: 0.62, roleId: 'bpd' },
      { position: 'RB', x: 0.24, y: 0.87, roleId: 'fb' },
      { position: 'CDM', x: 0.4, y: 0.38, roleId: 'dlp' },
      { position: 'CDM', x: 0.4, y: 0.62, roleId: 'bwm' },
      { position: 'LM', x: 0.66, y: 0.16, roleId: 'iw' },
      { position: 'CAM', x: 0.66, y: 0.5, roleId: 'ap' },
      { position: 'RM', x: 0.66, y: 0.84, roleId: 'iw' },
      { position: 'ST', x: 0.86, y: 0.5, roleId: 'cf' },
    ],
  },
  {
    id: '3-5-2',
    name: '3-5-2',
    slots: [
      { position: 'GK', x: 0.06, y: 0.5, roleId: 'gk' },
      { position: 'LCB', x: 0.2, y: 0.28, roleId: 'cd' },
      { position: 'CB', x: 0.18, y: 0.5, roleId: 'cd' },
      { position: 'RCB', x: 0.2, y: 0.72, roleId: 'cd' },
      { position: 'LWB', x: 0.5, y: 0.1, roleId: 'wb' },
      { position: 'CM', x: 0.46, y: 0.34, roleId: 'b2b' },
      { position: 'CDM', x: 0.42, y: 0.5, roleId: 'dlp' },
      { position: 'CM', x: 0.46, y: 0.66, roleId: 'cm' },
      { position: 'RWB', x: 0.5, y: 0.9, roleId: 'wb' },
      { position: 'ST', x: 0.82, y: 0.4, roleId: 'poacher' },
      { position: 'ST', x: 0.82, y: 0.6, roleId: 'cf' },
    ],
  },
  {
    id: '5-3-2',
    name: '5-3-2',
    slots: [
      { position: 'GK', x: 0.06, y: 0.5, roleId: 'gk' },
      { position: 'LWB', x: 0.3, y: 0.1, roleId: 'wb' },
      { position: 'LCB', x: 0.18, y: 0.32, roleId: 'cd' },
      { position: 'CB', x: 0.16, y: 0.5, roleId: 'cd' },
      { position: 'RCB', x: 0.18, y: 0.68, roleId: 'cd' },
      { position: 'RWB', x: 0.3, y: 0.9, roleId: 'wb' },
      { position: 'CM', x: 0.5, y: 0.3, roleId: 'b2b' },
      { position: 'CM', x: 0.46, y: 0.5, roleId: 'dlp' },
      { position: 'CM', x: 0.5, y: 0.7, roleId: 'cm' },
      { position: 'ST', x: 0.82, y: 0.4, roleId: 'poacher' },
      { position: 'ST', x: 0.82, y: 0.6, roleId: 'cf' },
    ],
  },
  {
    id: '4-1-2-1-2',
    name: '4-1-2-1-2 ◆',
    slots: [
      { position: 'GK', x: 0.06, y: 0.5, roleId: 'gk' },
      { position: 'LB', x: 0.24, y: 0.13, roleId: 'fb' },
      { position: 'LCB', x: 0.2, y: 0.38, roleId: 'cd' },
      { position: 'RCB', x: 0.2, y: 0.62, roleId: 'cd' },
      { position: 'RB', x: 0.24, y: 0.87, roleId: 'fb' },
      { position: 'CDM', x: 0.4, y: 0.5, roleId: 'anchor' },
      { position: 'CM', x: 0.55, y: 0.28, roleId: 'cm' },
      { position: 'CM', x: 0.55, y: 0.72, roleId: 'b2b' },
      { position: 'CAM', x: 0.68, y: 0.5, roleId: 'ap' },
      { position: 'ST', x: 0.84, y: 0.4, roleId: 'poacher' },
      { position: 'ST', x: 0.84, y: 0.6, roleId: 'cf' },
    ],
  },
];

export const FORMATION_IDS = FORMATION_TEMPLATES.map((f) => f.id);

let slotCounter = 0;

/** Build a fresh Formation instance (with empty player slots) from a template id. */
export function createFormation(templateId: string): Formation {
  const template = FORMATION_TEMPLATES.find((f) => f.id === templateId) ?? FORMATION_TEMPLATES[0];
  const slots: FormationSlot[] = template.slots.map((s) => ({
    id: `slot-${slotCounter++}`,
    position: s.position,
    x: s.x,
    y: s.y,
    roleId: s.roleId,
    playerId: null,
    instruction: defaultInstruction(getRole(s.roleId).defaultDuty),
  }));
  return { id: template.id, name: template.name, slots };
}
