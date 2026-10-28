import { TestBed } from '@angular/core/testing';
import { Cond } from './core/rpg/conditions';
import { attributeSources, buildStatBlock, resolveAttribute, resolveHook } from './core/rpg/stat-block';
import { RpgService } from './core/services/rpg.service';
import { createNewGame } from './data/generators';
import { conditionText } from './data/cond-labels';
import { TALENT_NODES, talentsFor } from './data/talents';
import { Player, PlayerArchetype } from './models/player.model';
import { TalentTreeComponent } from './shared/components/player-sheet/talent-tree.component';
import { TrainingPanelComponent } from './shared/components/player-sheet/training-panel.component';

const ARCHETYPES = [...new Set(TALENT_NODES.map((node) => node.archetype))] as PlayerArchetype[];

function playerOf(archetype: PlayerArchetype, extra: Partial<Player> = {}): Player {
  const game = createNewGame({ managerName: 'Sheet', clubName: 'Sheet FC', seed: 101 });
  const player = structuredClone(game.teams[0].players[5]) as Player;
  player.archetype = archetype;
  player.traitIds = [];
  player.talentRanks = {};
  player.level = 12;
  player.skillPoints = 30;
  player.morale = 65;
  player.form = 0;
  player.dna = { version: 3, rarity: 'rare', nickname: null, signatures: [], quirks: [], chronicle: [] };
  return Object.assign(player, extra);
}

describe('Talent tree', () => {
  it('has a root, two exclusive branches and an elite node below each, for every archetype', () => {
    expect(ARCHETYPES).toHaveLength(12);
    for (const archetype of ARCHETYPES) {
      const nodes = talentsFor(archetype);
      expect(nodes.map((node) => node.id)).toEqual([1, 2, 3, 4, 5].map((index) => `${archetype}-${index}`));
      expect(nodes.map((node) => node.tier)).toEqual([1, 2, 2, 3, 3]);
      const [root, a, b, eliteA, eliteB] = nodes;
      expect(root.requires).toBeUndefined();
      expect(a).toMatchObject({ requires: root.id, excludes: b.id, branch: 'a' });
      expect(b).toMatchObject({ requires: root.id, excludes: a.id, branch: 'b' });
      expect(eliteA.requires).toBe(a.id);
      expect(eliteB.requires).toBe(b.id);
      for (const node of [a, b, eliteA, eliteB]) expect(node.effects?.length, node.id).toBeGreaterThan(0);
    }
  });

  it('reports the status of every node and enforces it when unlocking', () => {
    const service = new RpgService();
    const player = playerOf('finisher');
    const [root, a, b, eliteA, eliteB] = talentsFor('finisher');
    expect(service.talentStatus(player, root)).toBe('open');
    expect(service.talentStatus(player, a)).toBe('needs-parent');
    expect(service.unlockTalent(player, a.id)).toBe(false);
    expect(service.unlockTalent(player, root.id)).toBe(true);
    expect(service.talentStatus(player, a)).toBe('open');
    expect(service.unlockTalent(player, a.id)).toBe(true);
    expect(service.talentStatus(player, b)).toBe('excluded');
    expect(service.unlockTalent(player, b.id)).toBe(false);
    player.level = 8;
    expect(service.talentStatus(player, eliteA)).toBe('needs-level');
    player.level = 10;
    expect(service.talentStatus(player, eliteA)).toBe('open');
    expect(service.talentStatus(player, eliteB)).toBe('needs-parent');
    player.skillPoints = 0;
    expect(service.talentStatus(player, eliteA)).toBe('needs-points');
    player.skillPoints = 10;
    service.unlockTalent(player, eliteA.id);
    service.unlockTalent(player, eliteA.id);
    expect(service.talentStatus(player, eliteA)).toBe('owned');
    expect(service.unlockTalent(player, eliteA.id)).toBe(false);
  });

  it('keeps ranks from before the tree grew valid', () => {
    const player = playerOf('finisher', { talentRanks: { 'finisher-2': 1 } });
    const block = buildStatBlock(player);
    expect(block.base.shooting).toBeGreaterThan(buildStatBlock(playerOf('finisher')).base.shooting);
  });

  it('lets talent branches act through the effect pipeline, scaled by rank', () => {
    const player = playerOf('finisher', { talentRanks: { 'finisher-1': 1, 'finisher-2': 2 } });
    const block = buildStatBlock(player);
    expect(resolveHook(block, 'shotError', 1, 0)).toBeCloseTo(0.94, 5);
    const other = buildStatBlock(playerOf('finisher', { talentRanks: { 'finisher-1': 1, 'finisher-3': 2 } }));
    expect(resolveAttribute(other, 'shooting', Cond.inOppBox)).toBeCloseTo(resolveAttribute(other, 'shooting', 0) + 2, 5);
  });
});

describe('Attribute sources', () => {
  it('adds up to the attribute the match starts from and lists situational effects', () => {
    const player = playerOf('finisher', { talentRanks: { 'finisher-1': 2 }, traitIds: ['rock'] });
    player.dna!.quirks = [{ id: 'derby-hero', revealed: true }];
    player.training = { mastery: {}, load: [2, 2, 2, 2], weekLoad: 0, buffs: [{ drillId: 'strength', effects: [{ hook: 'physical', op: 'add', value: 3 }], season: 1, week: 1 }] };
    const physical = attributeSources(player, 'physical', player.position);
    expect(physical.talents).toBe(0);
    expect(physical.traits).toBe(6);
    expect(physical.training).toBe(3);
    expect(physical.base + physical.talents + physical.traits + physical.training + physical.quirks + physical.state).toBeCloseTo(physical.total, 5);
    const shooting = attributeSources(player, 'shooting', player.position);
    expect(shooting.talents).toBe(4);
    expect(attributeSources(player, 'shooting', player.position).conditional.some((effect) => effect.source.kind === 'quirk' && effect.when === Cond.derby)).toBe(true);
    const root = attributeSources(player, 'shooting');
    expect(root.total).toBeGreaterThan(0);
  });

  it('shows form, morale and position as separate points', () => {
    const player = playerOf('finisher', { form: 5, morale: 100 });
    expect(attributeSources(player, 'shooting', player.position).state).toBeGreaterThan(0);
    const bad = playerOf('finisher', { form: -5, morale: 10 });
    expect(attributeSources(bad, 'shooting', bad.position).state).toBeLessThan(0);
  });

  it('describes situations in both languages', () => {
    expect(conditionText(Cond.derby | Cond.late, 0, 'en')).toBe('from minute 75, in derbies');
    expect(conditionText(0, Cond.derby, 'de')).toBe('außer im Derby');
    expect(conditionText(0, 0, 'en')).toBe('');
  });
});

describe('Player sheet components', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('draws the talent tree and unlocks an open node with a click', () => {
    const fixture = TestBed.createComponent(TalentTreeComponent);
    const player = playerOf('speedster');
    fixture.componentRef.setInput('player', player);
    const unlocked: string[] = [];
    fixture.componentInstance.unlock.subscribe((id) => unlocked.push(id));
    fixture.detectChanges();
    const nodes = fixture.nativeElement.querySelectorAll('g.node') as NodeListOf<SVGGElement>;
    expect(nodes).toHaveLength(5);
    expect(nodes[0].getAttribute('data-status')).toBe('open');
    expect(nodes[1].getAttribute('data-status')).toBe('needs-parent');
    nodes[1].dispatchEvent(new Event('click'));
    nodes[0].dispatchEvent(new Event('click'));
    expect(unlocked).toEqual(['speedster-1']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.detail')).not.toBeNull();
  });

  it('shows mastery, load and buffs of a player', () => {
    const fixture = TestBed.createComponent(TrainingPanelComponent);
    const player = playerOf('speedster');
    player.training = { mastery: { pace: 60, shooting: 100 }, load: [2, 3, 2, 4], weekLoad: 2, buffs: [{ drillId: 'sprints', effects: [], season: 1, week: 1 }] };
    fixture.componentRef.setInput('player', player);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('figure')).toHaveLength(8);
    expect(element.querySelector('circle.value.full')).not.toBeNull();
    expect(element.querySelectorAll('.load svg circle')).toHaveLength(5);
    expect(element.querySelector('.chip')?.getAttribute('data-zone')).toMatch(/green|yellow|red/);
    expect(element.querySelector('.buff')?.textContent).toContain('Sprints');
  });
});
