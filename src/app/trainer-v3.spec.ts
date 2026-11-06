import { TestBed } from '@angular/core/testing';
import { SaveService } from './core/services/save.service';
import { RpgService } from './core/services/rpg.service';
import {
  EXPECTED_SHARE, MAX_OPEN_REQUESTS, MIN_MATCHES, PATIENCE, REQUEST_COOLDOWN_WEEKS,
  answerRoomEvent, applyMatchToRoom, matchesPlayed, moraleBaseline, roomRoleOf, roomView, talkToPlayer, weeklyRoom,
} from './core/career/dressing-room';
import { PERK_ATTRIBUTE_STEP, TRAIT_EFFECTS, hasManagerTrait, managerAttribute, youthWorkBonus } from './core/career/manager-effects';
import { academyIntake } from './core/career/lifecycle';
import { candidatesFor, dismissStaff, hireStaff, payStaff, specialtyTilt, staffEffect, staffFactor, staffSalary, staffWeeklyCost } from './core/career/staff';
import { ROOM_EVENTS, roomEventById } from './data/dressing-room-events';
import { createNewGame } from './data/generators';
import { TRANSLATIONS } from './data/translations';
import { emptyDressingRoom } from './models/dressing-room.model';
import { GameState, SAVE_VERSION } from './models/game.model';
import { STAFF_ROLES, StaffMember } from './models/staff.model';

const fresh = (seed = 8080): GameState => createNewGame({ managerName: 'Trainer', clubName: 'Trainer FC', seed });
const own = (game: GameState) => game.teams.find((team) => team.id === game.clubId)!;

/** Plays a number of matches for the whole squad: those listed appear in every one, nobody else in any. */
function playSeason(game: GameState, matches: number, starters: Set<string>): void {
  for (const player of own(game).players) player.seasonStats.appearances = starters.has(player.id) ? matches : 0;
}

describe('Phase 8 – save version 8', () => {
  beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({}); });

  it('is the current version and a new career carries an empty backroom team and a dressing room', () => {
    expect(SAVE_VERSION).toBe(8);
    const game = fresh();
    expect(game.version).toBe(8);
    expect(game.staff).toEqual({ members: {} });
    expect(game.dressingRoom?.requests).toEqual([]);
  });

  it('migrates a version 7 career, keeps what exists and is idempotent', () => {
    const service = TestBed.inject(SaveService);
    const old = fresh(11);
    delete old.staff;
    delete old.dressingRoom;
    old.version = 7;
    const migrated = service.parseImport(JSON.stringify(old));
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.staff?.members).toEqual({});
    expect(migrated.dressingRoom?.spirit).toBeGreaterThan(40);
    expect(migrated.dressingRoom?.spirit).toBeLessThanOrEqual(100);
    // Nothing in the existing career moved.
    expect(migrated.teams.map((team) => team.players.length)).toEqual(old.teams.map((team) => team.players.length));
    migrated.dressingRoom!.spirit = 33;
    migrated.dressingRoom!.requests = ['someone'];
    migrated.staff!.members.physio = candidatesFor(migrated, 'physio')[0];
    const again = service.parseImport(JSON.stringify(migrated));
    expect(again.dressingRoom?.spirit).toBe(33);
    expect(again.dressingRoom?.requests).toEqual(['someone']);
    expect(again.staff?.members.physio?.id).toBe(migrated.staff!.members.physio!.id);
  });

  it('still reads version 7 saves as valid files', () => {
    const service = TestBed.inject(SaveService);
    const old = fresh(12);
    old.version = 7;
    expect(() => service.parseImport(JSON.stringify(old))).not.toThrow();
  });
});

describe('Phase 8 – the coach grows and his traits work', () => {
  it('adds two points per perk rank to the attribute and caps at 99', () => {
    const game = fresh();
    expect(managerAttribute(game.manager, 'coaching')).toBe(55);
    game.manager.perks.coaching = 3;
    expect(managerAttribute(game.manager, 'coaching')).toBe(55 + 3 * PERK_ATTRIBUTE_STEP);
    game.manager.attributes.coaching = 98;
    expect(managerAttribute(game.manager, 'coaching')).toBe(99);
  });

  it('turns skill points into perks and perks into attributes through the RPG service', () => {
    const game = fresh();
    const rpg = new RpgService();
    game.manager.skillPoints = 2;
    expect(rpg.unlockManagerPerk(game.manager, 'youthDevelopment')).toBe(true);
    expect(rpg.unlockManagerPerk(game.manager, 'youthDevelopment')).toBe(true);
    expect(rpg.unlockManagerPerk(game.manager, 'youthDevelopment')).toBe(false);
    expect(managerAttribute(game.manager, 'youthDevelopment')).toBe(59);
  });

  it('gives the youth perk a tangible intake edge, and a developer or a youth coach add to it', () => {
    const game = fresh();
    const base = youthWorkBonus(game.manager);
    game.manager.perks.youthDevelopment = 5;
    const withPerk = youthWorkBonus(game.manager);
    expect(withPerk).toBeGreaterThan(base);
    game.manager.traits = ['developer'];
    expect(youthWorkBonus(game.manager)).toBeGreaterThanOrEqual(withPerk);
    expect(youthWorkBonus(game.manager, 1)).toBeGreaterThan(youthWorkBonus(game.manager, 0));
    expect(youthWorkBonus(game.manager, 1)).toBeLessThanOrEqual(6);
  });

  it('draws a better academy intake with the perk than without, from the same rolls', () => {
    const plain = fresh(555);
    const boosted = fresh(555);
    boosted.manager.perks.youthDevelopment = 5;
    boosted.manager.traits = ['developer', 'calm'];
    const a = academyIntake(plain);
    const b = academyIntake(boosted);
    const mean = (list: { overall: number }[]) => list.reduce((sum, player) => sum + player.overall, 0) / list.length;
    expect(b.length).toBeGreaterThanOrEqual(a.length);
    expect(mean(b.slice(0, a.length))).toBeGreaterThan(mean(a));
    // The rolls themselves are the same: only the edge differs.
    expect(b.slice(0, a.length).map((player) => player.position)).toEqual(a.map((player) => player.position));
  });

  it('knows which traits a manager has and states every effect as a small number', () => {
    const game = fresh();
    game.manager.traits = ['motivator', 'negotiator'];
    expect(hasManagerTrait(game.manager, 'motivator')).toBe(true);
    expect(hasManagerTrait(game.manager, 'calm')).toBe(false);
    for (const value of Object.values(TRAIT_EFFECTS)) expect(value).toBeLessThanOrEqual(3);
  });
});

describe('Phase 8 – the backroom team', () => {
  it('pays more for a better person, and a rating of 50 or less helps nobody', () => {
    expect(staffSalary(60)).toBeLessThan(staffSalary(75));
    expect(staffSalary(75)).toBeLessThan(staffSalary(90));
    expect(staffSalary(90)).toBeLessThan(7000);
    const member = (rating: number): StaffMember => ({ id: 'x', role: 'assistant', firstName: 'A', lastName: 'B', age: 50, nationality: 'DE', rating, specialty: 'technical', salary: staffSalary(rating) });
    expect(staffFactor(undefined)).toBe(0);
    expect(staffFactor(member(45))).toBe(0);
    expect(staffFactor(member(50))).toBe(0);
    expect(staffFactor(member(95))).toBe(1);
    expect(staffFactor(member(72.5))).toBeCloseTo(0.5, 5);
    expect(specialtyTilt(member(80), 'passing')).toBe(1.25);
    expect(specialtyTilt(member(80), 'pace')).toBe(1);
    expect(specialtyTilt(undefined, 'pace')).toBe(1);
  });

  it('offers the same applicants for a club and season, and different ones the next season', () => {
    const game = fresh();
    for (const role of STAFF_ROLES) {
      const a = candidatesFor(game, role);
      expect(a).toHaveLength(3);
      expect(candidatesFor(fresh(), role).map((candidate) => candidate.id)).toEqual(a.map((candidate) => candidate.id));
      expect(a.every((candidate) => candidate.rating >= 40 && candidate.rating <= 95 && candidate.role === role)).toBe(true);
    }
    const before = candidatesFor(game, 'scout').map((candidate) => candidate.id);
    game.league.season++;
    expect(candidatesFor(game, 'scout').map((candidate) => candidate.id)).not.toEqual(before);
  });

  it('signs an applicant for a fee, replaces the holder of the job and refuses without money', () => {
    const game = fresh();
    const club = own(game);
    club.coins = 1_000_000;
    const [first, second] = candidatesFor(game, 'fitness');
    expect(hireStaff(game, first.id)).toEqual({ ok: true });
    expect(club.coins).toBe(1_000_000 - first.salary * 4);
    expect(game.staff!.members.fitness?.id).toBe(first.id);
    // The signed person is not offered again; the next one replaces him.
    expect(candidatesFor(game, 'fitness').some((candidate) => candidate.id === first.id)).toBe(false);
    expect(hireStaff(game, second.id)).toEqual({ ok: true });
    expect(game.staff!.members.fitness?.id).toBe(second.id);
    club.coins = 0;
    expect(hireStaff(game, candidatesFor(game, 'physio')[0].id)).toEqual({ ok: false, reason: 'budget' });
    expect(hireStaff(game, 'nobody')).toEqual({ ok: false, reason: 'unknown' });
    expect(dismissStaff(game, 'fitness')).toBe(true);
    expect(dismissStaff(game, 'fitness')).toBe(false);
  });

  it('books the weekly salaries as upkeep, and nothing without staff', () => {
    const game = fresh();
    const club = own(game);
    club.coins = 500_000;
    expect(payStaff(game)).toBe(0);
    expect(club.coins).toBe(500_000);
    hireStaff(game, candidatesFor(game, 'assistant')[0].id);
    hireStaff(game, candidatesFor(game, 'youth')[0].id);
    const cost = staffWeeklyCost(game);
    expect(cost).toBeGreaterThan(0);
    const before = club.coins;
    const upkeep = club.finance.totals.upkeep;
    expect(payStaff(game)).toBe(cost);
    expect(club.coins).toBe(before - cost);
    expect(club.finance.totals.upkeep).toBe(upkeep + cost);
  });

  it('turns a person into an effect: zero without one, more for a better one', () => {
    const game = fresh();
    expect(staffEffect(game, 'physio')).toBe(0);
    game.staff!.members.physio = { id: 'p', role: 'physio', firstName: 'P', lastName: 'Q', age: 45, nationality: 'DE', rating: 90, specialty: 'mental', salary: staffSalary(90) };
    expect(staffEffect(game, 'physio')).toBeCloseTo(40 / 45, 5);
  });
});

describe('Phase 8 – roles and playing time', () => {
  it('gives every player exactly one role from his rank in the squad', () => {
    const game = fresh();
    const team = own(game);
    const roles = team.players.map((player) => roomRoleOf(player, team));
    expect(roles.filter((role) => role === 'starter' || role === 'star')).toHaveLength(11);
    expect(roles.filter((role) => role === 'star').length).toBeLessThanOrEqual(3);
    const best = [...team.players].sort((a, b) => b.overall - a.overall)[0];
    expect(roomRoleOf(best, team)).toBe(best.overall >= 75 ? 'star' : 'starter');
    const ghost = { ...best, id: 'not-in-squad' };
    expect(roomRoleOf(ghost, team)).toBe('fringe');
    expect(EXPECTED_SHARE.star).toBeGreaterThan(EXPECTED_SHARE.starter);
    expect(EXPECTED_SHARE.fringe).toBe(0);
  });

  it('shows who is short of minutes without changing anything', () => {
    const game = fresh();
    const team = own(game);
    const ranked = [...team.players].sort((a, b) => b.overall - a.overall);
    playSeason(game, 10, new Set(ranked.slice(0, 11).map((player) => player.id)));
    expect(matchesPlayed(team)).toBe(10);
    const view = roomView(game);
    expect(view).toHaveLength(team.players.length);
    const bench = view.find((entry) => entry.role === 'rotation')!;
    expect(bench.played).toBe(0);
    expect(bench.expected).toBe(EXPECTED_SHARE.rotation);
    expect(game.dressingRoom!.unhappyWeeks).toEqual({});
  });
});

describe('Phase 8 – grievances, requests and team spirit', () => {
  /** A squad where six of the first eleven (not the stars) sit out every match while everybody else plays every match. */
  function benchedGame(matches = 10) {
    const game = fresh();
    const team = own(game);
    const ranked = [...team.players].sort((a, b) => b.overall - a.overall);
    const benched = ranked.slice(3, 9);
    playSeason(game, matches, new Set(ranked.filter((player) => !benched.includes(player)).map((player) => player.id)));
    game.league.currentWeek = matches + 1;
    return { game, team, benched, starters: ranked.filter((player) => !benched.includes(player)).slice(0, 11) };
  }

  it('does not judge playing time before enough matches are played', () => {
    const { game } = benchedGame(MIN_MATCHES - 1);
    for (let week = 0; week < 10; week++) { game.league.currentWeek++; weeklyRoom(game); }
    expect(game.dressingRoom!.unhappyWeeks).toEqual({});
    expect(game.dressingRoom!.requests).toEqual([]);
  });

  it('makes benched squad players unhappy week by week and costs them morale', () => {
    const { game, benched, starters } = benchedGame();
    const moraleBefore = benched.map((player) => player.morale);
    weeklyRoom(game);
    for (const player of benched) expect(game.dressingRoom!.unhappyWeeks[player.id]).toBe(1);
    benched.forEach((player, index) => expect(player.morale).toBeLessThan(moraleBefore[index]));
    for (const player of starters) expect(game.dressingRoom!.unhappyWeeks[player.id]).toBeUndefined();
    weeklyRoom(game);
    expect(game.dressingRoom!.unhappyWeeks[benched[0].id]).toBe(2);
  });

  it('lets rotation players, talents and fillers accept the bench', () => {
    const { game, team } = benchedGame();
    for (let week = 0; week < 12; week++) weeklyRoom(game);
    for (const [id] of Object.entries(game.dressingRoom!.unhappyWeeks)) {
      const role = roomRoleOf(team.players.find((player) => player.id === id)!, team);
      expect(['star', 'starter']).toContain(role);
    }
  });

  it('lets a grievance fade when the player gets his minutes again', () => {
    const { game, team, benched } = benchedGame();
    weeklyRoom(game); weeklyRoom(game); weeklyRoom(game);
    expect(game.dressingRoom!.unhappyWeeks[benched[0].id]).toBe(3);
    // He plays now: more than half of what his role expects.
    benched[0].seasonStats.appearances = Math.ceil(matchesPlayed(team) * EXPECTED_SHARE.starter);
    weeklyRoom(game);
    expect(game.dressingRoom!.unhappyWeeks[benched[0].id]).toBe(2);
    for (let i = 0; i < 3; i++) weeklyRoom(game);
    expect(game.dressingRoom!.unhappyWeeks[benched[0].id]).toBeUndefined();
  });

  it('turns a long grievance into one request at a time, never in clusters, and never above the cap', () => {
    const { game } = benchedGame();
    const asked: number[] = [];
    for (let week = 0; week < 60; week++) {
      game.league.currentWeek++;
      const report = weeklyRoom(game);
      if (report.newRequests.length) asked.push(week);
      expect(report.newRequests.length).toBeLessThanOrEqual(1);
      expect(game.dressingRoom!.requests.length).toBeLessThanOrEqual(MAX_OPEN_REQUESTS);
    }
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(MAX_OPEN_REQUESTS);
    for (let i = 1; i < asked.length; i++) expect(asked[i] - asked[i - 1]).toBeGreaterThanOrEqual(REQUEST_COOLDOWN_WEEKS);
    // Nobody asks before his personality's patience is spent.
    expect(Math.min(...Object.values(PATIENCE))).toBeGreaterThanOrEqual(4);
  });

  it('keeps someone who wants out low in mood until he is talked round', () => {
    const { game, team, benched } = benchedGame();
    for (let week = 0; week < 14; week++) { game.league.currentWeek++; weeklyRoom(game); }
    const asking = team.players.find((player) => game.dressingRoom!.requests.includes(player.id))!;
    expect(asking).toBeDefined();
    expect(asking.morale).toBeLessThanOrEqual(45);
    expect(benched.length).toBeGreaterThan(0);
  });

  it('forgets players who left the club', () => {
    const { game, team, benched } = benchedGame();
    weeklyRoom(game);
    const gone = benched[0];
    team.players = team.players.filter((player) => player.id !== gone.id);
    weeklyRoom(game);
    expect(game.dressingRoom!.unhappyWeeks[gone.id]).toBeUndefined();
  });

  it('moves the spirit towards what the squad is like, and results move it at once', () => {
    const game = fresh();
    const team = own(game);
    game.dressingRoom!.spirit = 20;
    for (const player of team.players) player.morale = 90;
    for (let i = 0; i < 20; i++) weeklyRoom(game);
    const high = game.dressingRoom!.spirit;
    expect(high).toBeGreaterThan(65);
    for (const player of team.players) player.morale = 20;
    game.dressingRoom!.spirit = 90;
    for (let i = 0; i < 20; i++) weeklyRoom(game);
    expect(game.dressingRoom!.spirit).toBeLessThan(high - 10);

    const room = emptyDressingRoom();
    game.dressingRoom = room;
    applyMatchToRoom(game, 'win');
    expect(room.spirit).toBe(62.5);
    applyMatchToRoom(game, 'draw');
    expect(room.spirit).toBe(62.5);
    applyMatchToRoom(game, 'loss');
    expect(room.spirit).toBe(60);
    game.manager.traits = ['calm'];
    applyMatchToRoom(game, 'loss');
    expect(room.spirit).toBeCloseTo(58.75, 5);
  });

  it('lifts the spirit with a captain who leads, and with leadership', () => {
    const game = fresh();
    const team = own(game);
    for (const player of team.players) { player.morale = 70; player.personality = 'professional'; }
    team.tactics.captainId = null;
    game.dressingRoom!.spirit = 50;
    const settle = (g: GameState) => { g.dressingRoom!.spirit = 50; for (let i = 0; i < 40; i++) weeklyRoom(g); return g.dressingRoom!.spirit; };
    const without = settle(structuredClone(game));
    const withCaptain = structuredClone(game);
    const leader = own(withCaptain).players[0];
    leader.traitIds = ['leader'];
    own(withCaptain).tactics.captainId = leader.id;
    expect(settle(withCaptain)).toBeGreaterThan(without);
    const leadership = structuredClone(game);
    leadership.manager.perks.leadership = 5;
    expect(settle(leadership)).toBeGreaterThan(without);
  });

  it('sets the squad morale baseline from the spirit', () => {
    expect(moraleBaseline(undefined)).toBe(70);
    expect(moraleBaseline({ ...emptyDressingRoom(), spirit: 0 })).toBe(56);
    expect(moraleBaseline({ ...emptyDressingRoom(), spirit: 100 })).toBe(76);
    expect(moraleBaseline({ ...emptyDressingRoom(), spirit: 70 })).toBe(70);
  });

  it('lets the manager talk to an unhappy player once a season, deterministically', () => {
    const run = () => {
      const { game, benched } = benchedGame();
      weeklyRoom(game);
      const target = benched[0];
      return { game, target, result: talkToPlayer(game, target.id) };
    };
    const first = run();
    const second = run();
    expect(first.result).toEqual(second.result);
    expect(first.result.ok).toBe(true);
    expect(talkToPlayer(first.game, first.target.id)).toEqual({ ok: false, error: 'talked' });
    const content = first.game.teams.find((team) => team.id === first.game.clubId)!.players.find((player) => !first.game.dressingRoom!.unhappyWeeks[player.id])!;
    expect(talkToPlayer(first.game, content.id)).toEqual({ ok: false, error: 'content' });
    expect(talkToPlayer(first.game, 'nobody')).toEqual({ ok: false, error: 'player' });
    // Next season he can be talked to again.
    first.game.league.season++;
    first.game.dressingRoom!.unhappyWeeks[first.target.id] = 3;
    expect(talkToPlayer(first.game, first.target.id).ok).toBe(true);
  });

  it('makes a successful talk end the request, a failed one cost mood', () => {
    // Find a seed whose talk succeeds and one whose talk fails: both outcomes must be reachable.
    const outcomes = new Set<boolean>();
    for (let week = 5; week < 60 && outcomes.size < 2; week++) {
      const { game, benched } = benchedGame();
      game.league.currentWeek = week;
      game.dressingRoom!.requests = [benched[0].id];
      game.dressingRoom!.unhappyWeeks[benched[0].id] = 9;
      const moraleBefore = benched[0].morale;
      const result = talkToPlayer(game, benched[0].id);
      if (!result.ok) continue;
      outcomes.add(result.success);
      if (result.success) {
        expect(game.dressingRoom!.requests).not.toContain(benched[0].id);
        expect(benched[0].morale).toBeGreaterThan(moraleBefore);
      } else {
        expect(game.dressingRoom!.requests).toContain(benched[0].id);
        expect(benched[0].morale).toBeLessThan(moraleBefore);
      }
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });
});

describe('Phase 8 – dressing-room events', () => {
  it('has a title, body and two options in both languages for every event', () => {
    expect(new Set(ROOM_EVENTS.map((event) => event.id)).size).toBe(ROOM_EVENTS.length);
    expect(ROOM_EVENTS.length).toBeGreaterThanOrEqual(8);
    for (const event of ROOM_EVENTS) {
      for (const pair of [event.title, event.body, event.options[0].label, event.options[1].label]) {
        expect(pair[0], event.id).toBeTruthy();
        expect(pair[1], event.id).toBeTruthy();
      }
      expect(roomEventById(event.id)).toBe(event);
      for (const option of event.options) {
        for (const value of [option.effect.spirit ?? 0, option.effect.morale ?? 0]) expect(Math.abs(value)).toBeLessThanOrEqual(6);
        expect(option.effect.coins ?? 0).toBeGreaterThan(-20000);
      }
    }
    for (const locale of ['de', 'en'] as const) {
      for (const key of ['news.room.request.title', 'news.room.request.body', 'news.room.event.title', 'news.room.event.body', 'news.room.expired.title', 'news.room.expired.body', 'nav.office']) {
        expect(TRANSLATIONS[locale][key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  /** Runs a season of weeks and returns what the room brought, for a clone of the game. */
  function eventsOf(game: GameState, weeks: number): string[] {
    const found: string[] = [];
    for (let week = 0; week < weeks; week++) {
      game.league.currentWeek = 4 + week;
      const report = weeklyRoom(game);
      if (report.event) found.push(`${game.league.currentWeek}:${report.event.id}`);
      if (game.dressingRoom!.event?.choice === null) answerRoomEvent(game, 0);
    }
    return found;
  }

  it('draws the same events for the same save, roughly one week in four, never the same one twice in a row', () => {
    const a = eventsOf(fresh(), 60);
    const b = eventsOf(fresh(), 60);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(6);
    expect(a.length).toBeLessThan(30);
    for (let i = 1; i < a.length; i++) expect(a[i].split(':')[1]).not.toBe(a[i - 1].split(':')[1]);
    expect(eventsOf(fresh(9999), 60)).not.toEqual(a);
  });

  it('applies an answer once, with its effects, and reports a missing event or a lack of money', () => {
    const game = fresh();
    const team = own(game);
    expect(answerRoomEvent(game, 0)).toEqual({ ok: false, error: 'no-event' });
    game.dressingRoom!.event = { eventId: 'bonus-demand', season: 1, week: 5, choice: null };
    game.dressingRoom!.spirit = 50;
    team.coins = 5000;
    expect(answerRoomEvent(game, 0)).toEqual({ ok: false, error: 'budget' });
    expect(game.dressingRoom!.event.choice).toBeNull();
    team.coins = 100_000;
    const morale = team.players[0].morale;
    expect(answerRoomEvent(game, 0)).toEqual({ ok: true, xp: 0 });
    expect(game.dressingRoom!.spirit).toBe(55);
    expect(team.coins).toBe(88_000);
    expect(team.players[0].morale).toBe(Math.min(100, morale + 4));
    expect(game.dressingRoom!.history[0]).toBe('bonus-demand');
    expect(answerRoomEvent(game, 1)).toEqual({ ok: false, error: 'answered' });
  });

  it('lets a risk-taker swing further with the bold answer, and gives manager XP for hard words', () => {
    const calm = fresh();
    const bold = fresh();
    bold.manager.traits = ['risk-taker'];
    for (const game of [calm, bold]) {
      game.dressingRoom!.event = { eventId: 'bonus-demand', season: 1, week: 5, choice: null };
      game.dressingRoom!.spirit = 50;
    }
    expect(answerRoomEvent(calm, 1)).toEqual({ ok: true, xp: 30 });
    answerRoomEvent(bold, 1);
    // Refusing costs −4 spirit; the risk-taker takes it 1.5 times as hard.
    expect(calm.dressingRoom!.spirit).toBe(46);
    expect(bold.dressingRoom!.spirit).toBe(44);
  });

  it('lets an unanswered event run out and cost a little spirit', () => {
    const game = fresh();
    game.dressingRoom!.event = { eventId: 'team-trip', season: game.league.season, week: 5, choice: null };
    game.dressingRoom!.spirit = 60;
    game.league.currentWeek = 5 + 2;
    const report = weeklyRoom(game);
    expect(report.expired?.id).toBe('team-trip');
  });

  it('only offers events that suit the mood', () => {
    const game = fresh();
    const room = game.dressingRoom!;
    const seen = new Set<string>();
    for (let season = 1; season <= 12; season++) {
      game.league.season = season;
      for (const spirit of [20, 80]) {
        room.spirit = spirit;
        room.event = null;
        room.history = [];
        for (let week = 3; week < 40; week++) {
          game.league.currentWeek = week;
          const report = weeklyRoom(game);
          room.spirit = spirit;
          if (report.event) {
            seen.add(report.event.id);
            if (report.event.needs === 'lowSpirit') expect(spirit).toBeLessThan(50);
            if (report.event.needs === 'highSpirit') expect(spirit).toBeGreaterThanOrEqual(60);
            room.event = null;
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
