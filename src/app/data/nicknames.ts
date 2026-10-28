import { PlayerArchetype } from '../models/player.model';

/** German and English epithet pairs; the UI shows the one for the current language. */
export type Nickname = [string, string];

/** Epithets tied to the playing style; each archetype has a handful so squads rarely repeat. */
export const NICKNAMES: Record<PlayerArchetype, Nickname[]> = {
  'shot-stopper': [['Die Katze', 'The Cat'], ['Der Magnet', 'The Magnet'], ['Die Faust', 'The Fist'], ['Der Vorhang', 'The Curtain']],
  sweeper: [['Der Libero', 'The Sweeper'], ['Der Späher', 'The Scout'], ['Der Kapitän im Tor', 'The Keeper-Captain'], ['Der Fünfte Mann', 'The Fifth Man']],
  distributor: [['Das Katapult', 'The Catapult'], ['Der Schleuderer', 'The Slinger'], ['Der Startschuss', 'The Starting Gun'], ['Die Rakete im Rücken', 'The Rocket Behind']],
  stopper: [['Der Fels', 'The Rock'], ['Die Mauer', 'The Wall'], ['El Muro', 'El Muro'], ['Der Türsteher', 'The Bouncer']],
  'ball-player': [['Der Architekt', 'The Architect'], ['Der Seidenfuß', 'Silk Boot'], ['Der Aufbauer', 'The Builder'], ['Der Dirigent', 'The Conductor']],
  runner: [['Der Dauerläufer', 'The Marathoner'], ['Der Windhund', 'The Greyhound'], ['Die Lunge', 'The Lungs'], ['Der Pendler', 'The Commuter']],
  'ball-winner': [['Der Jagdhund', 'The Bloodhound'], ['Der Staubsauger', 'The Hoover'], ['Der Pitbull', 'The Pitbull'], ['Die Zecke', 'The Tick']],
  playmaker: [['Der Regisseur', 'The Director'], ['Die Seidenpfote', 'Silkpaw'], ['Der Uhrmacher', 'The Watchmaker'], ['Der Zauberer', 'The Wizard']],
  'box-to-box': [['Der Motor', 'The Engine'], ['Der Alleskönner', 'The All-Rounder'], ['Die Walze', 'The Steamroller'], ['Der Zweikampf-Pendler', 'The Box-Crosser']],
  finisher: [['Der Vollstrecker', 'The Executioner'], ['Der Eiskalte', 'The Ice Man'], ['Der Torjäger', 'The Poacher'], ['Der Heckenschütze', 'The Sniper']],
  creator: [['Der Magier', 'The Magician'], ['Der Vorbereiter', 'The Provider'], ['Der Zauberfuß', 'Magic Foot'], ['Der Künstler', 'The Artist']],
  speedster: [['Die Rakete', 'The Rocket'], ['Der Blitz', 'The Bolt'], ['Der Komet', 'The Comet'], ['Der Düsenjäger', 'The Jet']],
};

/** Mythic players carry a title instead of a plain epithet. */
export const MYTHIC_PREFIX: [string, string] = ['Der Unvergleichliche –', 'The Unrivalled –'];
