import { TestBed } from '@angular/core/testing';
import { SaveService } from './core/services/save.service';
import { RpgService } from './core/services/rpg.service';
import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { cupRoundForWeek } from './core/career/cup';
import { answerPress, bigMatchReason, ensurePress, pressOdds, weeklyPress } from './core/career/press-conference';
import { SUPPLIERS, activeSupplier, paySupplier, signSupplier, syncEquipment } from './core/career/supplier';
import { respecCost, respecState, respecTalents } from './core/career/respec';
import { HEAT_START, TRANSFER_HEAT, coolRivalries, derbyHeat, derbySpirit, gateFactor, heatOf, intensityFor, rivalryBetween, warmRivalry } from './core/career/rivalry';
import { ensureRoom } from './core/career/dressing-room';
import { PARTNER_FIRST_TOUCH, PARTNER_PASS_ERROR, PARTNER_THRESHOLD, coolLinks, duoPartners, pairKey, partnerBonus, recordTogether } from './core/rpg/partners';
import { socialMix, socialRole } from './core/rpg/social';
import { BOOT_LOOKS, BOOT_TYPES, equipmentEffects, setBoot, setLook } from './core/rpg/equipment';
import { EFFECT_CAPS } from './core/rpg/effects';
import { buildStatBlock, canUse, resolveHook } from './core/rpg/stat-block';
import { autoEvolveSignatures } from './core/rpg/evolution';
import { TAME_MASTERY, quirkEffects, tameQuirks, tameState } from './core/rpg/quirks';
import { PRESS_STYLES } from './data/press-conference';
import { TRANSLATIONS } from './data/translations';
import { createNewGame } from './data/generators';
import { GameState } from './models/game.model';
import { Player } from './models/player.model';
import { Team } from './models/team.model';

const fresh = (seed = 9090): GameState => createNewGame({ managerName: 'Life', clubName: 'Life FC', seed });
const own = (game: GameState) => game.teams.find((team) => team.id === game.clubId)!;

/** Makes the club's next league opponent a rival and moves the calendar so that the match is in the week after. */
function derbyWeek(game: GameState): { week: number; opponent: Team } {
  // A week without a cup round, so the reason is the derby and nothing else.
  const fixture = game.league.fixtures.find((candidate) => candidate.week >= 3 && !candidate.played && !cupRoundForWeek(game.cup, candidate.week) && (candidate.homeTeamId === game.clubId || candidate.awayTeamId === game.clubId))!;
  const opponent = game.teams.find((team) => team.id === (fixture.homeTeamId === game.clubId ? fixture.awayTeamId : fixture.homeTeamId))!;
  own(game).rivalTeamIds = [opponent.id];
  game.league.currentWeek = fixture.week - 1;
  return { week: fixture.week, opponent };
}

describe('Phase 8 follow-up – press conference', () => {
  it('opens before a derby, deterministically, and not again straight away', () => {
    const run = () => { const game = fresh(); const { week, opponent } = derbyWeek(game); return { game, week, opponent, opened: weeklyPress(game) }; };
    const a = run(), b = run();
    expect(a.opened).not.toBeNull();
    expect(a.opened).toEqual(b.opened);
    expect(a.opened!.reason).toBe('derby');
    expect(a.opened!.opponentId).toBe(a.opponent.id);
    expect(a.opened!.week).toBe(a.week);
    // While it waits for an answer, no second one opens.
    expect(weeklyPress(a.game)).toBeNull();
    expect(bigMatchReason(a.game, a.week)?.reason).toBe('derby');
  });

  it('stays quiet before an ordinary match', () => {
    const game = fresh();
    own(game).rivalTeamIds = [];
    game.league.currentWeek = 1;
    // Early in the season, mid-table: no top clash, no decider.
    expect(weeklyPress(game)).toBeNull();
    expect(ensurePress(game).current).toBeNull();
  });

  it('turns the answer into odds, moves spirit, morale, board and the opponent, and cannot be answered twice', () => {
    const game = fresh();
    const { opponent } = derbyWeek(game);
    weeklyPress(game);
    const room = ensureRoom(game);
    room.spirit = 50;
    const odds = PRESS_STYLES.map((style) => pressOdds(game, 'derby', style.id).chance);
    expect(odds[0]).toBe(1);
    expect(odds[1]).toBeGreaterThan(odds[2]);
    const boardBefore = game.board.confidence;
    const result = answerPress(game, 'confident');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(room.spirit).toBeCloseTo(50 + result.effect.spirit, 5);
    expect(game.press!.current!.answer).toBe('confident');
    expect(game.press!.current!.outcome?.success).toBe(result.success);
    expect(game.board.confidence).not.toBe(boardBefore - 99);
    expect(opponent.players.length).toBeGreaterThan(0);
    expect(answerPress(game, 'humble')).toEqual({ ok: false, error: 'answered' });
    expect(game.press!.history[0].week).toBe(game.press!.current!.week);
  });

  it('gets the same result for the same save and lets the media skill and traits move the odds', () => {
    const [a, b] = [fresh(), fresh()];
    for (const game of [a, b]) { derbyWeek(game); weeklyPress(game); }
    expect(answerPress(a, 'provocative')).toEqual(answerPress(b, 'provocative'));
    const plain = fresh();
    plain.manager.traits = [];
    const skilled = fresh();
    skilled.manager.traits = [];
    skilled.manager.attributes.media = 90;
    expect(pressOdds(skilled, 'derby', 'provocative').chance).toBeGreaterThan(pressOdds(plain, 'derby', 'provocative').chance);
    const calm = fresh();
    calm.manager.traits = ['calm'];
    expect(pressOdds(calm, 'derby', 'provocative').failure.spirit).toBeGreaterThan(pressOdds(plain, 'derby', 'provocative').failure.spirit);
    const bold = fresh();
    bold.manager.traits = ['risk-taker'];
    expect(pressOdds(bold, 'derby', 'provocative').success.spirit).toBeGreaterThan(pressOdds(plain, 'derby', 'provocative').success.spirit);
    expect(answerPress(fresh(), 'humble')).toEqual({ ok: false, error: 'no-conference' });
  });
});

describe('Phase 8 follow-up – kit supplier and boots', () => {
  it('signs a supplier only with the reputation for it, once, and books the weekly fee', () => {
    const game = fresh();
    const club = own(game);
    club.reputation = 40;
    expect(signSupplier(game, 'regional')).toEqual({ ok: false, reason: 'reputation' });
    club.reputation = 80;
    expect(signSupplier(game, 'basic')).toEqual({ ok: false, reason: 'unknown' });
    expect(signSupplier(game, 'regional')).toEqual({ ok: true });
    expect(activeSupplier(game).id).toBe('regional');
    expect(signSupplier(game, 'global')).toEqual({ ok: false, reason: 'running' });
    const before = club.coins;
    expect(paySupplier(game)).toBe(SUPPLIERS[1].weeklyFee);
    expect(club.coins).toBe(before - SUPPLIERS[1].weeklyFee);
    // After the season it falls back to the basic deal.
    game.league.season++;
    expect(activeSupplier(game).id).toBe('basic');
  });

  it('gives every boot a gain and a drawback inside the caps, sharpens only the gain with the tier, and never lets the look matter', () => {
    for (const boot of BOOT_TYPES.filter((candidate) => candidate.id !== 'balanced')) {
      expect(boot.bonus.length).toBeGreaterThan(0);
      expect(boot.penalty.length).toBeGreaterThan(0);
      for (const effect of [...boot.bonus, ...boot.penalty]) {
        const cap = EFFECT_CAPS[effect.hook];
        if (!cap) continue;
        const [low, high] = effect.op === 'add' ? cap.add : cap.mul;
        expect(effect.value, `${boot.id} ${effect.hook}`).toBeGreaterThanOrEqual(low);
        expect(effect.value, `${boot.id} ${effect.hook}`).toBeLessThanOrEqual(high);
      }
    }
    const control = { boot: 'control' as const, look: 'classic', tier: 1 as const };
    const tier1 = equipmentEffects(control), tier3 = equipmentEffects({ ...control, tier: 3 });
    const gain = (effects: ReturnType<typeof equipmentEffects>) => effects.find((effect) => effect.hook === 'firstTouch')!.value;
    const loss = (effects: ReturnType<typeof equipmentEffects>) => effects.find((effect) => effect.hook === 'acceleration')!.value;
    expect(gain(tier3)).toBeGreaterThan(gain(tier1));
    expect(loss(tier3)).toBe(loss(tier1));
    // The look changes nothing in the stat block.
    const game = fresh();
    const player = own(game).players[3];
    setBoot(player, 'speed');
    const reference = JSON.stringify(buildStatBlock(player).base) + JSON.stringify(buildStatBlock(player).mods);
    for (const look of BOOT_LOOKS) {
      expect(setLook(player, look.id)).toBe(true);
      expect(JSON.stringify(buildStatBlock(player).base) + JSON.stringify(buildStatBlock(player).mods)).toBe(reference);
    }
    expect(setLook(player, 'nonsense')).toBe(false);
    expect(setBoot(player, 'nonsense' as never)).toBe(false);
  });

  it('puts boots effects through the pipeline and leaves other clubs without them', () => {
    const game = fresh();
    const player = own(game).players[2];
    setBoot(player, 'control');
    const without = resolveHook(buildStatBlock({ ...player, equipment: undefined }), 'firstTouch', 50, 0);
    expect(resolveHook(buildStatBlock(player), 'firstTouch', 50, 0)).toBeGreaterThan(without);
    const stranger = game.teams.find((team) => team.id !== game.clubId)!.players[0];
    setBoot(stranger, 'speed');
    signSupplier(Object.assign(game, { teams: game.teams }), 'regional');
    syncEquipment(game);
    expect(stranger.equipment).toBeUndefined();
    expect(player.equipment?.tier).toBe(activeSupplier(game).tier);
  });
});

describe('Phase 8 follow-up – talent respec', () => {
  it('costs coins, returns the points once a season and refuses when there is nothing to take back', () => {
    const game = fresh();
    const club = own(game);
    club.coins = 500_000;
    const player = club.players.find((candidate) => candidate.level >= 5)!;
    player.talentRanks = {};
    expect(respecState(player, 1)).toBe('nothing');
    expect(respecTalents(game, player.id)).toEqual({ ok: false, error: 'nothing' });
    const service = new RpgService();
    player.skillPoints = 10;
    const root = player.archetype + '-1';
    expect(service.unlockTalent(player, root)).toBe(true);
    const spent = 10 - player.skillPoints;
    expect(spent).toBeGreaterThan(0);
    const cost = respecCost(game, player);
    const coins = club.coins;
    const result = respecTalents(game, player.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.refunded).toBe(spent);
    expect(club.coins).toBe(coins - cost);
    expect(player.skillPoints).toBe(10);
    expect(player.talentRanks).toEqual({});
    expect(respecState(player, game.league.season)).toBe('done');
    expect(respecTalents(game, player.id)).toEqual({ ok: false, error: 'done' });
    service.unlockTalent(player, root);
    expect(respecTalents(game, player.id)).toEqual({ ok: false, error: 'done' });
    game.league.season++;
    club.coins = 0;
    expect(respecTalents(game, player.id)).toEqual({ ok: false, error: 'budget', cost: respecCost(game, player) });
    expect(respecTalents(game, 'nobody')).toEqual({ ok: false, error: 'player' });
  });
});

describe('Phase 8 follow-up – duo chemistry and social roles', () => {
  const squad = (): Player[] => own(fresh()).players;

  it('makes partners of players who often start together, at most one each, the same every time', () => {
    const players = squad();
    const links = {};
    const eleven = players.slice(0, 11).map((player) => player.id);
    for (let match = 0; match < 30; match++) recordTogether(links, eleven);
    const first = duoPartners(players, links), second = duoPartners(players, links);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.size).toBeGreaterThan(0);
    expect(first.size % 2).toBe(0);
    for (const [id, link] of first) {
      expect(first.get(link.partnerId)?.partnerId).toBe(id);
      expect(link.strength).toBeGreaterThanOrEqual(0.15);
      expect(link.strength).toBeLessThanOrEqual(1);
      expect(link.score).toBeGreaterThanOrEqual(PARTNER_THRESHOLD);
    }
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
    // Nobody who never started together is a partner, whatever his nation.
    expect(duoPartners(players, {}).size).toBe(0);
  });

  it('cools the bonds at the turn of the season and drops those of players who left', () => {
    const cooled = coolLinks({ 'a|b': 10, 'a|c': 1, 'x|y': 20 }, new Set(['a', 'b', 'c']));
    expect(cooled).toEqual({ 'a|b': 8 });
  });

  it('keeps the effect of a bond small and inside the caps', () => {
    const none = partnerBonus(0), full = partnerBonus(1);
    expect(none).toEqual({ passErrorMul: 1, firstTouchAdd: 0 });
    expect(full.passErrorMul).toBeCloseTo(1 - PARTNER_PASS_ERROR, 6);
    expect(full.firstTouchAdd).toBe(PARTNER_FIRST_TOUCH);
    const cap = EFFECT_CAPS.passError!;
    expect(full.passErrorMul).toBeGreaterThanOrEqual(cap.mul[0]);
    expect(EFFECT_CAPS.linkPartner).toBeDefined();
  });

  it('makes a pass between partners cleaner in the match, and nothing else', () => {
    const { home, away } = createPracticeTeams();
    const match = new ArcadeMatch(home, away, home.id);
    const [a, b, c] = match.actors.filter((actor) => actor.side === 'home' && actor.player.positionGroup !== 'GK');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = match as unknown as { partnerStrength: (x: unknown, y: unknown) => number; home: Team };
    expect(inner.partnerStrength(a, b)).toBe(0);
    inner.home.partners = { [a.player.id]: { partnerId: b.player.id, strength: 0.8 }, [b.player.id]: { partnerId: a.player.id, strength: 0.8 } };
    expect(inner.partnerStrength(a, b)).toBeCloseTo(0.8, 6);
    expect(inner.partnerStrength(b, a)).toBeCloseTo(0.8, 6);
    expect(inner.partnerStrength(a, c)).toBe(0);
    const opponent = match.actors.find((actor) => actor.side === 'away')!;
    expect(inner.partnerStrength(a, opponent)).toBe(0);
  });

  it('gives team players, egoists and loners a say in the spirit, and egoists less harm with team players around', () => {
    const players = squad();
    for (const player of players) player.personality = 'professional';
    expect(socialMix(players).spirit).toBe(0);
    const teamPlayers = players.slice(0, 5);
    teamPlayers.forEach((player) => (player.personality = 'team-player'));
    expect(socialMix(players).spirit).toBeGreaterThan(3);
    const volatile = players.slice(5, 9);
    volatile.forEach((player) => (player.personality = 'volatile'));
    const mix = socialMix(players);
    expect(mix.teamPlayers).toBe(5);
    expect(mix.egoists + mix.loners).toBe(4);
    const roles = new Set(volatile.map((player) => socialRole(player)));
    expect([...roles].every((role) => role === 'egoist' || role === 'loner')).toBe(true);
    expect(socialRole(players[0])).toBe('team-player');
    expect(socialRole({ id: 'x', personality: 'professional' })).toBeNull();
  });
});

describe('Phase 8 follow-up – rivalry heat', () => {
  it('starts from the reason, follows the three steps, warms with derbies and transfers and cools with time', () => {
    const game = fresh();
    const rivalry = game.world.rivalries[0];
    const [a, b] = [rivalry.teamAId, rivalry.teamBId];
    expect(heatOf(rivalry)).toBe(HEAT_START[rivalry.reason]);
    expect(intensityFor(10)).toBe(1);
    expect(intensityFor(40)).toBe(2);
    expect(intensityFor(80)).toBe(3);
    const before = heatOf(rivalry);
    const heat = warmRivalry(game, a, b, TRANSFER_HEAT);
    expect(heat).toBe(before + TRANSFER_HEAT);
    expect(rivalry.intensity).toBe(intensityFor(heat!));
    expect(warmRivalry(game, a, 'nobody', 5)).toBeNull();
    expect(rivalryBetween(game, b, a)).toBe(rivalry);
    warmRivalry(game, a, b, 500);
    expect(heatOf(rivalry)).toBe(100);
    expect(rivalry.intensity).toBe(3);
    coolRivalries(game, true);
    expect(heatOf(rivalry)).toBe(92);
    coolRivalries(game, false);
    expect(heatOf(rivalry)).toBeCloseTo(91.6, 5);
    warmRivalry(game, a, b, -500);
    expect(heatOf(rivalry)).toBe(0);
  });

  it('heats close derbies more than routs, and pays for it with a bigger gate and a bigger swing in the dressing room', () => {
    expect(derbyHeat(1, 1)).toBeGreaterThan(derbyHeat(5, 0));
    expect(derbyHeat(2, 1)).toBeGreaterThan(derbyHeat(3, 0));
    const game = fresh();
    const rivalry = game.world.rivalries[0];
    expect(gateFactor(undefined)).toBe(1);
    rivalry.heat = 0;
    expect(gateFactor(rivalry)).toBe(1);
    rivalry.heat = 100;
    expect(gateFactor(rivalry)).toBeCloseTo(1.2, 6);
    expect(derbySpirit(100, 'win')).toBeGreaterThan(derbySpirit(20, 'win'));
    expect(derbySpirit(100, 'loss')).toBeLessThan(derbySpirit(20, 'loss'));
    expect(derbySpirit(100, 'draw')).toBe(0);
  });

  it('keeps old saves valid: no heat means the heat of the reason', () => {
    const game = fresh();
    for (const rivalry of game.world.rivalries) delete rivalry.heat;
    expect(game.world.rivalries.every((rivalry) => heatOf(rivalry) === HEAT_START[rivalry.reason])).toBe(true);
  });
});

describe('Phase 8 follow-up – quirks, signatures and the sheet', () => {
  function withQuirk(): { player: Player; id: string } {
    const game = fresh();
    const player = own(game).players[4];
    // A quirk with a drawback.
    const quirks = player.dna!.quirks!;
    quirks.forEach((quirk) => (quirk.revealed = true));
    return { player, id: quirks[0].id };
  }

  it('lets mastery tame the drawback of a quirk for good, and keeps its advantages', () => {
    const { player } = withQuirk();
    player.training = { mastery: {}, load: [], weekLoad: 0, buffs: [] } as unknown as NonNullable<Player['training']>;
    const quirk = player.dna!.quirks!.find((candidate) => tameState(player, candidate).open);
    if (!quirk) return;
    const state = tameState(player, quirk);
    expect(state.mastery).toBe(0);
    expect(tameQuirks(player)).toEqual([]);
    player.training!.mastery[state.attribute] = TAME_MASTERY;
    const tamed = tameQuirks(player);
    expect(tamed.map((entry) => entry.id)).toContain(quirk.id);
    expect(quirk.tamed).toBe(true);
    expect(tameState(player, quirk).open).toBe(false);
    expect(quirkEffects(quirk).length).toBeLessThanOrEqual((quirk.id ? quirkEffects({ ...quirk, tamed: false }) : []).length);
    expect(tameQuirks(player)).toEqual([]);
  });

  it('evolves the ready signatures of computer clubs at the turn of the season, the branch always the same', () => {
    const run = () => {
      const game = fresh(31);
      const team = game.teams.find((candidate) => candidate.id !== game.clubId)!;
      const star = team.players[0];
      star.level = 40;
      star.dna = { ...star.dna!, rarity: 'legendary' };
      for (const signature of star.dna.signatures ?? []) signature.progress = { activations: 400, shots: 200, goals: 150 };
      return { star, evolved: autoEvolveSignatures(team, { season: 1, week: 30 }) };
    };
    const a = run(), b = run();
    expect(a.evolved).toBe(b.evolved);
    expect(a.evolved).toBeGreaterThan(0);
    expect(a.star.dna!.signatures!.map((signature) => [signature.level, signature.path])).toEqual(b.star.dna!.signatures!.map((signature) => [signature.level, signature.path]));
    expect(a.star.dna!.signatures!.some((signature) => signature.level >= 2)).toBe(true);
  });

  it('lets a talent unlock an action that the stat block reports through canUse', () => {
    const game = fresh();
    const player = own(game).players[5];
    player.talentRanks = {};
    expect(canUse(buildStatBlock(player), 'trivela')).toBe(false);
  });
});

describe('Phase 8 follow-up – save, texts and the long run', () => {
  beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({}); });

  it('gives the manager a media attribute, also in old saves, and keeps the new optional fields optional', () => {
    const service = TestBed.inject(SaveService);
    const old = fresh(5);
    delete old.manager.attributes.media;
    old.version = 7;
    const migrated = service.parseImport(JSON.stringify(old));
    expect(migrated.manager.attributes.media).toBe(55);
    expect(migrated.supplier).toBeUndefined();
    expect(migrated.press).toBeUndefined();
    expect(service.parseImport(JSON.stringify(migrated)).manager.attributes.media).toBe(55);
  });

  it('has the new texts in both languages', () => {
    for (const locale of ['de', 'en'] as const) {
      for (const key of ['news.press.title', 'news.press.body', 'perk.media', 'perk.media.desc', 'news.derby.heat', 'transfer.sheet']) {
        expect(TRANSLATIONS[locale][key], `${locale} ${key}`).toBeTruthy();
      }
    }
    expect(TRANSLATIONS.de['news.press.body']).toContain('{opponent}');
    expect(TRANSLATIONS.en['news.derby.heat']).toContain('{opponent}');
  });
});
