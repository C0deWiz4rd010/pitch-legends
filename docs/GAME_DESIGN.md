> Historisches Dokument. Der aktuelle verbindliche Plan ist [Pitch Legends 2.0](PITCH_LEGENDS_2_0_MASTERPLAN.md).

# Pitch Legends — Game Design

## Player attributes (0-99)

`pace · shooting · passing · dribbling · defending · physical · stamina · goalkeeping`

Overall is a position-weighted blend of these (e.g. a GK is dominated by goalkeeping, a
striker by shooting/pace/dribbling). Each player also has: potential (growth cap), level,
XP, skill points, traits, morale, form, fitness, injury status, market value, salary and
contract length, plus season stats.

## Progression loop

1. Play matches and run training drills to earn **XP**.
2. Level up to earn **skill points**.
3. Spend skill points in the **Player Detail** modal to raise attributes (cost scales with
   the attribute value) or unlock **traits** (level-gated).
4. Higher-rated, well-drilled and in-form players perform better on match day.

### Traits

| Trait | Effect | Unlock |
|-------|--------|--------|
| Clinical Finisher | +6 shooting | Lv 3 |
| Engine | +6 stamina, +3 pace | Lv 3 |
| Speedster | +7 pace | Lv 3 |
| Playmaker | +7 passing | Lv 4 |
| The Wall | +6 defending | Lv 4 |
| Powerhouse | +6 physical | Lv 4 |
| Safe Hands | +7 goalkeeping | Lv 4 |
| Dribbling Maestro | +7 dribbling | Lv 5 |
| Ice in the Veins | +8 penalty shooting | Lv 5 |
| Set-Piece Specialist | +8 passing / +4 shooting | Lv 5 |
| Born Leader | team boost | Lv 6 |
| Wonderkid | +25% XP gain | Lv 2 |

## Tactics → match engine mapping

- **Mentality** shifts the attack/defence balance (±8 either way).
- **Pressing** raises defensive pressure & counter chances but drains stamina.
- **Tempo** scales chance frequency.
- **Defensive line / offside trap** trade attacking territory for defensive risk.
- **Counter-attack** boosts transition attack.
- **Roles** reweight each player's effective rating in their zone.
- **Home advantage** adds a small bonus to all home team zones.

Possession is decided by the midfield battle; chances are created from attack-vs-defence
balance and finished based on shooter rating vs goalkeeper rating.

## Economy

- **Matchday income:** home gate scales with Stadium level, plus a result bonus
  (win/draw/loss).
- **Transfers:** buy at market value, sell for ~90%. Squad limited to 26 (min 14).
- **Facilities (Lv 1-5):** Training Ground (XP), Medical Centre (recovery/injury),
  Stadium (income), Youth Academy (scouting quality). Upgrade cost scales with level.

## Season structure

Double round-robin across 12 clubs. Standings by points → goal difference → goals scored.
When all fixtures are played the season can be rolled over: fixtures reset, players age a
year, season stats clear, and a new campaign begins.

## Save format

Single JSON object (`GameState`) versioned by `SAVE_VERSION`, stored under
`pitch-legends:save:v1` in `localStorage`, exportable/importable as a `.json` file.
