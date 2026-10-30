# RPG-System: Entwurf und Referenz (Legends Reborn)

Stand: Phase 8 des Phasenplans (28.10.2026). Dieses Dokument beschreibt, wie die RPG-Schicht von Pitch Legends aufgebaut ist, welche Formeln und Budgets gelten und wo die Daten liegen. Der Fortschritt je Phase steht in `IMPLEMENTATION_2_0_LOG.md`.

## 1. Leitidee

Die acht Kernattribute (Tempo, Schuss, Passen, Dribbling, Verteidigen, Physis, Ausdauer, Torwart) bleiben die Grundlage. Alles Weitere verändert **nicht die Zahl auf der Karte, sondern wie sie im Match wirkt**, und zwar über eine einzige Effekt-Pipeline. Die Prinzipien aus dem Masterplan gelten weiter: deterministische Seeds, kein Re-Roll, Aussehen gibt keinen Vorteil, Schwierigkeit ändert keine Werte.

## 2. Effekt-Pipeline (`src/app/core/rpg/`)

| Datei | Aufgabe |
|---|---|
| `conditions.ts` | Situations-Flags als Bitmaske (`Cond.*`), `condMatches(flags, when, unless)` |
| `effects.ts` | Hooks, `EffectSpec` (`add` oder `mul`, optional `when`/`unless`), `EFFECT_CAPS`, Hook-Bits und -Ids |
| `stat-block.ts` | `buildStatBlock` (Basis + Modifier je Spieler), `resolveAttribute`, `refreshAttributes`, `refreshHooks`, `attributeSources`, `staticOverall` |
| `signatures.ts`, `quirks.ts`, `evolution.ts`, `story.ts`, `training-rules.ts`, `player-dna.ts` | die jeweiligen Systeme |

**Quellen eines Modifiers:** Trait, Talent (pro Rang), Training-Buff, Quirk, Signatur. Bedingungslose Attribut-Boni werden in die Basis eingerechnet; alles andere bleibt ein Modifier mit Bedingung.

**Basis eines Attributs:** `(Attribut + Talente + Trait-Boni + Buffs + Quirk-Boni) × Moral × Form × Positionsvertrautheit`, begrenzt auf 1–99.
- Moral: `1 + clamp((Moral − 65) / 35, −1, 1) × 0,04`
- Form: `1 + Form × 0,008` (Form −5…+5)
- Positionsvertrautheit: `0,5 + 0,5 × Familiarity` (1 / 0,92 / 0,82 / 0,6)

**Auflösung eines Modifiers:** `(Start + clamp(Σ add, cap.add)) × clamp(Π mul, cap.mul)`. Standardgrenzen für Attribute: add −15…+15, mul 0,8…1,25. Abgeleitete Hooks haben eigene Grenzen (`EFFECT_CAPS`), z. B. `shotError` mul 0,65…1,5, `passError` mul 0,55…1,5, `tackleWin` add −0,15…+0,2.

**Abgeleitete Hooks:** `shotError`, `shotPower`, `curve`, `passError`, `throughLead`, `firstTouch`, `acceleration`, `sprintBurst`, `tackleWin`, `pressTackle`, `shielding`, `aerial`, `keeperReaction`, `keeperReach`, `staminaDrain`, `staminaRecovery`, `composure`, `xpGain`, `injuryRisk`, `growthChance`. Im Match sind derzeit angeschlossen: `shotError`, `passError`, `tackleWin`, `pressTackle`, `keeperReaction`, `acceleration`, `sprintBurst`, `staminaDrain`; `injuryRisk` wirkt im Training.

**Situationen (`Cond`):** home, away, inOwnBox, inOppBox, inOppHalf, late (ab Minute 75), losing, winning, level, counter (4 s nach Ballgewinn), setPiece, penalty, lowStamina, extraTime, outOfPossession, underPressure (Ballführer mit Gegner unter 3 m), facingShot, rain, storm, derby, bigMatch, signature, signature2, night, clear.

**Engine-Anbindung (`arcade-match.ts`):** Jeder Spieler trägt einen `StatBlock`. Die aufgelösten Werte stehen in `actor.attrs`, die Hook-Faktoren in `actor.hookAdd`/`hookMul`. Beides wird je Spieler nur alle 6 Ticks (gestaffelt) neu bestimmt und nur dann neu aufgelöst, wenn sich ein Flag ändert, das ein Modifier des Spielers verwendet (`flagMask`). Standards und Elfmeter setzen ihre Flags für die Dauer des Schusses. Der Zustand der Pipeline gehört in den Match-Checkpoint (`runtime.effects`), damit ein fortgesetztes Match identisch weiterläuft.

**Abschalten für Vergleiche:** `MatchConfig.effects = false` oder `npm run balance:check -- --effects=off`.

## 3. Seltenheit (`data/rarity.ts`, `core/rpg/player-dna.ts`)

| Stufe | Anteil | Budget | Quirk-Slots | Signaturen | Aura |
|---|---|---|---|---|---|
| Common | 68 % | 2 | 1 | 1 passive | – |
| Rare | 22 % | 3 | 1–2 | 1 getriggerte | – |
| Epic | 7,5 % | 4 | 2 | 1 getriggerte, Spitzname | Ring |
| Legendary | 2,2 % | 5 | 2–3 | beide | Ring, größer |
| Mythic | 0,3 % | 6 | 3 | beide | Ring, wandernder Farbton |

- Der Wurf ist deterministisch aus der Spieler-ID (`hash32(id|dna-v1)`), ein hohes Potenzial zieht ihn um bis zu 35 % nach unten. Seltenheit gibt **keinen** Attributbonus.
- Weltregel: höchstens drei Mythic-Spieler (`enforceMythicCap`).
- Aufstieg: einmal pro Karriere um eine Stufe, höchstens bis Legendary, am Saisonende durch Torschützenkönig der Welt (ab 10 Tore), fünf Spieler-des-Spiels-Auszeichnungen in einer Saison oder 100 Einsätze.
- Sichtbarkeit: Der eigene Kader kennt die Seltenheit; fremde Spieler zeigen „?“ bis ein Scouting-Bericht vorliegt; Akademie-Talente zeigen einen Funken (schwach ab Rare, hell ab Epic).
- Legends-Karten: Die Kartenstufe legt die Seltenheit fest (Bronze Common, Silber Rare, Gold Epic, Legend Legendary).
- Marktwert: Faktor `1 / 1,05 / 1,12 / 1,22 / 1,3` plus 2 % je Evolutionsstufe über I, höchstens 1,35 (`rarityValueFactor`).

## 4. Signaturen (`data/signatures.ts`, `core/rpg/signatures.ts`)

Aufbau: Trigger (Situation oder Ereignis), Wirkung als Modifier mit Wach-Flag, Dauer und Abklingzeit. Stärke = `(0,6 + 0,1 × Budget) × Zufall(0,94…1,06)`, mal Stufenfaktor (I ×1, II ×1,15, III ×1,3).

Ereignisse: `ballWon`, `ballLost`, `passReceived`, `skillWon`, `shotAgainst`, `bigChanceAgainst`.

| Id | Archetyp | Art | Name (Variante 1) |
|---|---|---|---|
| `burst-lane` | speedster | passiv | Antritt |
| `comet` | speedster | getriggert | Komet |
| `cold-blood` | finisher | passiv | Kaltblut |
| `poacher` | finisher | getriggert | Abstauber |
| `calm-carrier` | playmaker | passiv | Ruhe am Ball |
| `thread-pass` | playmaker | getriggert | Fadenpass |
| `magic-foot` | creator | passiv | Zauberfuß |
| `final-ball` | creator | getriggert | Der letzte Ball |
| `rock-in-surf` | stopper | passiv | Fels in der Brandung |
| `iron-curtain` | stopper | getriggert | Eiserner Vorhang |
| `tempo-setter` | ball-player | passiv | Taktgeber |
| `build-up` | ball-player | getriggert | Spielauslösung |
| `endless-runner` | runner | passiv | Dauerläufer |
| `second-wind` | runner, box-to-box | getriggert | Zweite Luft |
| `hoover` | ball-winner | passiv | Staubsauger |
| `hound` | ball-winner | getriggert | Jagdhund |
| `total-mid` | box-to-box | passiv | Total Midfielder |
| `reflexes` | shot-stopper | passiv | Reflexe |
| `cat-reflex` | shot-stopper | getriggert | Katzenreflex |
| `clearance-king` | sweeper | passiv | Ausputzer |
| `libero` | sweeper | getriggert | Libero |
| `steady-hands` | distributor | passiv | Ballsicher |
| `catapult` | distributor | getriggert | Katapult |

## 5. Evolution (`data/evolutions.ts`, `core/rpg/evolution.ts`)

- Wirkungspunkte = Auslösungen + Schüsse im aktiven Fenster + 3 × Tore im aktiven Fenster, gesammelt über die Karriere.
- Stufe I→II: 40 Punkte, Spielerlevel 10. Stufe II→III: 120 Punkte, Level 18, mindestens Rare.
- Bei Stufe II wird ein Pfad gewählt (endgültig): **A** Wirkung +25 %; **B** Ereignis-Signaturen 50 % länger wach und 30 % kürzere Abklingzeit, Situations-Signaturen +10 %.

## 6. Quirks (`data/quirks.ts`, `core/rpg/quirks.ts`)

Jeder Quirk hat Vor- und Nachteil. Nachteile werden mit `unless` formuliert („sonst“). Aufdecken: ein Quirk je 3 Einsätze, ein Scouting-Bericht deckt den ersten auf. Wandel: Nervenbündel → Eisherz (5 Spieler des Spiels), Spätzünder → Routinier (40 Einsätze). Mentoring: 10 % je Junior und Gruppeneinheit.

- **Umwelt:** Regenspieler (`rain-man`), Sturmgeprüft (`storm-chaser`), Sonnenanbeter (`sun-lover`), Flutlicht-Fan (`floodlight-fan`), Nachteule (`night-owl`), Rutschfest (`wet-grip`)
- **Bühne:** Derby-Held (`derby-hero`), Spieler für große Spiele (`big-game-player`), Pokalkämpfer (`cup-fighter`), Heimkind (`home-kid`), Auswärtsfahrer (`road-warrior`)
- **Psyche:** Nervenbündel (`nervous`), Eisherz (`ice-heart`), Comeback-Typ (`comeback-kid`), Hitzkopf (`hothead`), Spätzünder (`late-bloomer`), Routinier (`veteran-calm`), Kaltschnäuzig (`clutch`), Perfektionist (`perfectionist`), Showman (`showboat`)
- **Körper:** Gummiband (`rubber-band`), Glasknochen (`glass-bones`), Schnellregenerierer (`quick-recovery`), Eiserne Lunge (`iron-lungs`), Sprinter (`sprinter`), Zweite-Halbzeit-Motor (`second-half-engine`)
- **Sozial:** Mentor (`mentor`), Einzelgänger (`loner`), Mannschaftsdienlich (`team-player`), Egoist (`greedy`)
- **Kurioses:** Standard-Tüftler (`set-piece-nerd`), Brecher (`target-man`), Strafraumwächter (`box-guardian`), Pressingmaschine (`pressing-machine`), Elfmetertöter (`penalty-saver`), Kontermeister (`counter-puncher`)

## 7. Talente (`data/talents.ts`)

Je Archetyp fünf Knoten: Wurzel (max. Rang 3, +2 Primärattribut je Rang), zwei sich ausschließende Spezialisierungen (Level 5, Rang 2) und je ein Elite-Knoten darunter (Level 10, Rang 2). Spezialisierungen und Elite-Knoten tragen Hook-Effekte je Rang (z. B. Schussfehler −3 %). `RpgService.talentStatus` liefert `owned`, `open`, `needs-points`, `needs-level`, `needs-parent` oder `excluded`.

## 8. Training (`core/services/training.service.ts`, `core/rpg/training-rules.ts`)

- 15 Programme, jedes mit Nebenattribut und einem Match-Buff (läuft nach dem Spieltag der Woche ab).
- Durchbruch: 5 % + 1 % je Trainingsgelände-Stufe (+4 % bei `driven`), +2 statt +1.
- Meisterschaft 0–100 je Attribut: 25 gibt 50 XP, 50 einen Skillpunkt, 100 den Trait des Attributs.
- Belastung: leicht 1 / normal 2 / intensiv 3,5 (Gruppe ×0,75), Verhältnis akut zu chronisch (Mittel der letzten 4 Wochen); Ampel grün bis 1,3, gelb bis 1,6, sonst rot; Verletzungsrisiko bis ×2,5.
- Mentoring: Senior (29+, Level 12+) und Junior (bis 21) in einer Gruppeneinheit: +20 % XP für den Junior.
- Wochenereignis: deterministisch aus Verein, Saison und Woche, acht Ereignisse mit zwei Optionen.
- KI-Vereine: `simulateAiTrainingWeek` (Spieler unter 27 gewinnen mit 1,5–3 % je Woche einen Punkt).

## 9. Story (`core/rpg/story.ts`, `data/story.ts`)

Chronik (höchstens 40 Zeilen) für Debüt, erstes Tor, Hattrick, Spieler des Spiels, Verletzung, Comeback, Level 5/10/…, Quirk entdeckt/gewandelt, Meisterschaft, Signatur-Stufe und Aufstieg. Die Bio wird aus Spieler-ID und Welt berechnet und nicht gespeichert.

## 10. Speicherstand und Migration

- `SAVE_VERSION = 7`. Beim Laden läuft die Kette V5 → V6 → V7 mit Backup vor jeder Migration (`migrationBackupKey`).
- V7 (`SaveService.migrateToV7`): `ensureGameDna` ergänzt DNA für alle Spieler (aus der Spieler-ID, ohne Potenzial-Einfluss, überschreibt nie), der verwaltete Verein bekommt einen geschätzten Trainingszustand (Meisterschaft aus Level und Attribut, höchstens 60), `trainingWeek.eventChoice` wird gesetzt. Der Schritt ist idempotent.
- Neue Spielerfelder sind optional (`dna`, `training`), ältere Saves bleiben lesbar.
- Lautstärken liegen in den Einstellungen des Browsers (`pitch-legends:audio-volumes:v1`), nicht mehr im Spielstand.

## 11. Performance und Balance

- Matchzeit (500 Matches, `balance:check`): Messungen siehe Log; Ziel war etwa +10 % gegenüber dem Stand vor Phase 1 (damals 440–450 ms). Das Zeitlimit im Skript steht bei 560 ms.
- Balance-Korridore: 2,2–3,4 Tore, 65–88 % Passquote, 20–32 % Remis, 42–52 % Heimsiege.
- Tests: Vitest-Specs `rpg-effects`, `training-v3`, `player-dna`, `signatures`, `quirks-story`, `evolution`, `rpg-sheet`, `save-v7` sowie der Zehn-Saisons-Test.

## 12. Nachtrag Phase 9

- **Ultimate (Mythic):** Fokus 0–100 füllt sich durch gute Aktionen; bei 100 löst Taste F / Gamepad 8 / Touch-Button die Ultimate aus (6 s, `ULTIMATE_EFFECTS`), die KI nutzt sie per Heuristik. Eingabe läuft über den `TickInputBuffer`, daher replay-sicher.
- **Elfmeterschießen:** `ShootoutSession` (`core/football/shootout.ts`) mit `kickOutcome` (Richtung, Kraft, Sprungrichtung; Signaturen und Quirks wie Eisherz wirken über den `penalty`-Zustand). Automatischer Pfad für SIM/COACH, interaktiver für PLAY.
- **Abseits und Pässe:** `lineOvershoot` (Läufe hinter die Kette), `INTERCEPT_EVERY` und seedbasierte Ballannahme.
- **Infrastruktur:** `patchSettings` (Teil-Clone), Multi-Tab-Warnung, `i18n:check` und `format:check`.
