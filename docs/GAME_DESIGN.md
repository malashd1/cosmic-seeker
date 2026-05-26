# Game Design

## Pillars

1. **One screen, one stick, one button** — the controls fit on any device.
2. **Read-and-react** — formations move in patterns players learn; randomness is in timing, not in projectile origin.
3. **Practice is the only path** — equipment helps but does not replace skill.
4. **The economy rewards finishing what you started** — earn comes from clearing levels, not from staking or idle play.

## Enemy count progression (deterministic)

Galaxian pacing — each level opens with a **large swarm wave** (≈ 60% of the level's enemies arrive at once), then follow-up waves trickle in as the swarm thins. Wave count steps up by one every 20 levels.

Per `targetEnemiesForLevel()` + `wavesForLevel()` in [`src/game/difficulty.ts`](../src/game/difficulty.ts):

| Level | Total enemies | Waves | Swarm size |
|---:|---:|---:|---:|
| 1   | 50  | 2 | ~35 |
| 5   | 55  | 2 | ~38 |
| 10  | boss intro 12 + Carrier | — | — |
| 15  | 69  | 2 | ~48 |
| 20  | boss intro + Hive | — | — |
| 21  | 79  | **3** | ~44 |
| 30  | boss intro + Warden | — | — |
| 40  | boss intro + Inquisitor | — | — |
| 41  | 121 | **4** | ~55 |
| 50  | boss intro + Leviathan | — | — |
| 60  | boss intro + Architect | — | — |
| 61  | 168 | **5** | ~67 |
| 70  | boss intro + Devourer | — | — |
| 80  | boss intro + Echo | — | — |
| 81  | 215 | **6** | ~78 |
| 90  | boss intro + Cataclysm | — | — |
| 99  | 234 | 6 | ~85 |
| 100 | The Sovereign + intro | — | — |

Curve formula: `50 + 1.2·(L-1) + 0.008·(L-1)²` enemies for non-boss levels. Boss levels share a fixed 12-enemy intro wave before the boss spawns.

Per-wave split uses front-loaded weights (`waveWeights()` in `difficulty.ts`) — first wave gets the largest share (`weight 1.8`), every subsequent wave decays hyperbolically. On the boss levels there's exactly one intro wave so the boss can dominate the screen.

Enemy stat scaling (HP, fire rate, bullet speed) is layered on top via `modsFor(level)` — at L100 enemies have **4.5× the HP** of L1 and fire 2.4× faster.

## Difficulty curve (100 levels)

| Tier | Levels | Description |
|---|---|---|
| Tutorial | 1–10 | Two enemy types max. Easy formations. Boss "Carrier" at 10. |
| Normal   | 11–30 | Snipers/Bombers introduced. Boss "Hive" at 20, "Warden" at 30. |
| Hard     | 31–50 | Splitter, Phantom, Swarmer, Turret. Bosses "Inquisitor" / "Leviathan". |
| Expert   | 51–70 | Reaper joins. Boss "Architect" at 60, "Devourer" at 70. |
| Master   | 71–90 | Mirror + Voidling. Bullet hell phases. Bosses "Echo" / "Cataclysm". |
| Legendary| 91–100 | All enemies, max scaling. Final boss "The Sovereign" at 100. |

The smoothstep curve means difficulty climbs gently 1–20, accelerates 30–70, and plateaus near the end where item builds matter more than raw mechanics.

## Enemy roster (12 types — minimum requirement: 10)

See [WHITEPAPER §3.3](../WHITEPAPER.md). Implementation in `src/game/enemies.ts`.

| # | Name | Intro lvl | Key trait |
|---:|---|---:|---|
| 1 | Grunt | 1 | Baseline straight shooter |
| 2 | Drone | 1 | Dives toward player periodically |
| 3 | Scout | 5 | Fast horizontal weave |
| 4 | Sniper | 11 | Aimed shots from stationary |
| 5 | Bomber | 16 | Slow AoE bombs |
| 6 | Splitter | 21 | Splits into 2 Grunts on death |
| 7 | Phantom | 26 | Phases in/out of visibility |
| 8 | Swarmer | 31 | Kamikaze in packs of 6 |
| 9 | Turret | 36 | Heavy armor, 360° fire |
| 10 | Reaper | 51 | Tracking homing projectile |
| 11 | Mirror | 61 | Double-bullet shots |
| 12 | Voidling | 76 | Teleports near player, melee dash |

## Boss design

Bosses have 4–5 phases. Each phase introduces a new attack pattern OR adds. Phase transitions trigger at 75/50/25/10% HP. The final boss "Sovereign" cycles through abbreviated versions of all prior boss patterns.

## Scoring

| Action | Score |
|---|---:|
| Enemy kill | base reward × (1 + 0.05 × combo) × difficulty mod |
| Boss kill | fixed (1k–100k) |
| No-hit completion | +25% bonus |
| Speed completion (<60s) | +15% bonus |
| Perfect run (no damage) | +50% bonus |
| First-clear of level | ×2 multiplier |

Combo resets after 2.5s without a kill.

## Equipment effect on gameplay

- **Weapons** change projectile pattern, damage, fire rate. Slot in 1–2 weapon slots per ship.
- **Shields** absorb 1–3 hits, recharge over time. Only Titan ship has a shield slot.
- **Utilities** are passive or one-shot effects: extra bombs, slow-mo on damage, score multiplier pickup magnet.
- **Cosmetics** do not affect stats.

A Scout with a Single Cannon can complete level 100. It is harder, but possible.

## Controls

| Input | Action |
|---|---|
| ← →, A D | Move horizontal |
| ↑ ↓, W S | Move vertical |
| Space, Z | Fire |
| Shift, X | Bomb (consumable) |
| Pointer / Touch | Move toward pointer; tap = fire |

## Daily tournament

Each day at UTC midnight a new tournament opens. All players see the **same 7 levels** in the same order, picked deterministically from the daily seed:

- 2 levels from 1–30 (warm-up)
- 2 levels from 31–60 (escalation)
- 2 levels from 61–90 (skill check)
- 1 level from 91–100 (finale)
- 1 of the 7 is replaced with a boss-tier level (multiple of 10) within the same tier

A run is **a single attempt across all 7 levels with shared lives**. Total score = sum of per-level scores. Death anywhere ends the entry. Top 100 split a 25k $SKR prize pool on a geometric curve (1st ≈ 7%, 2nd ≈ 6.5%, …, 100th ≈ 0.05%). One entry per wallet per tournament; the highest score is kept.

Backend endpoints: `GET /api/tournament/today`, `POST /api/tournament/submit`, `GET /api/tournament/leaderboard?id=…`.

## Game session shape

1. Player connects wallet (optional).
2. Selects ship + weapon from inventory (or default Scout + Single).
3. Picks next unlocked level.
4. Plays. On clear: backend signs claim → on-chain `$SKR` reward.
5. Optional: spend `$SKR` in shop.

Daily missions and weekly leaderboard run in parallel, gated by signed score attestations.
