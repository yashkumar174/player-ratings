# Player Ratings

Upload a youth-football match events CSV, get every player rated as a percentile against his age group.

- **Live:** https://player-ratings-kappa.vercel.app
- **Repo:** https://github.com/yashkumar174/player-ratings
- **Stack:** Next.js 16 (App Router, server components, server actions) · Postgres (Supabase) · TypeScript · Tailwind
- **Pages:** `/` players (search, filter by age/position, sort) · `/players/[id]` rating breakdown, matches, raw numbers · `/upload` CSV upload with a cleaning report · `/method` the reasoning and its limits

```bash
npm install
npm run dev          # http://localhost:3100, uses an embedded Postgres (PGlite) in .pglite/
npm test             # cleaning + rating unit tests
npm run evaluate     # compares the rating formulas on data/match_events.csv
```

Set `DATABASE_URL` (Supabase → Connect → Transaction pooler) to use a real Postgres. The schema creates itself on first connection.

---

## Schema

```
uploads        id, filename, sha256, row counts, issues (jsonb)
teams          id, name, name_key UNIQUE
matches        id (provider match_id) PK, match_date, competition, age_group,
               home_team_id → teams, away_team_id → teams, home_goals, away_goals
               CHECK home ≠ away, goals ≥ 0
players        id, name, name_key, age_group, team_id → teams
               UNIQUE (name_key, age_group, team_id)
appearances    id, match_id → matches, player_id → players, team_id → teams,
               position CHECK in (GK CB FB CM W ST), position_inferred,
               minutes_played CHECK 0–130, 24 stat columns CHECK ≥ 0 (nullable),
               flags (jsonb), source_line, upload_id
               UNIQUE (match_id, player_id)
player_ratings player_id PK → players, percentile CHECK 0–100, score, raw_score,
               reliability, components (jsonb), match_scores (jsonb), model_version
```

Why this shape:

- **The CSV is one table; the domain is three.** A row mixes fixture facts (date, teams, score) with player facts. Storing them together means the score of M-1502 lives in 28 places and can disagree with itself. `matches` holds it once; `appearances` holds only what belongs to a player in a match.
- **`UNIQUE (match_id, player_id)` makes upload idempotent.** Re-uploading the same file, or next week's file that overlaps it, updates rows instead of duplicating them (verified: second upload of the sample = 0 new / 364 updated).
- **A player is (name, age group, club).** The export has no player ID. Name alone would merge the two "Pablo Ruiz"s (Getafe U15 FB, Girona U17 W). The cost is that a real transfer would split one player in two. I think that's the safer mistake, and it's the first thing I'd fix with a provider ID.
- **Stats are nullable, never defaulted to 0.** Three rows have a blank stat. Zero would be a claim ("he made no recoveries"); null is the truth ("we don't know"). The rating then leaves those minutes out of that stat's per-90.
- **Constraints that hold vs checks that flag.** Impossible values (negative counts, 200 minutes, unknown positions) are rejected by the database. Suspicious but real-looking values (4 goals from 2 shots on target) are stored as-is and flagged, because the file is the source and I can't know which number is wrong.
- **Ratings are a derived table, recomputed on every upload.** A percentile is relative, so one new match changes every player in that age group. `player_ratings` is rebuilt from all stored appearances inside the same transaction as the upload, stamped with `model_version`.
- **`uploads` keeps the audit trail**: what came in, what was dropped and why.

The layers: `src/lib/ingest` (pure CSV cleaning), `src/lib/rating` (pure rating maths), `src/lib/db` (SQL only), `src/app` (UI only). The cleaning and rating code never touches the database, which is why it's unit-testable and why the evaluation script can run the same code offline.

---

## How the rating is computed

1. **Per 90 and per role.** Counting stats become per-90 rates; ratios are pass %, ground duel %, aerial %, and possession lost *per touch* (so a 130-touch midfielder isn't punished for being involved).
2. **Shrink each stat by how noisy it is.** Before comparing, every stat is pulled toward the peer average: `(count + k·peer rate) / (minutes + k)`. The strength *k* is learned per stat from the data (method-of-moments empirical Bayes). The spread between players is split into what Poisson/binomial luck would produce and what's left over, which is real difference. Goals come out at k ≈ 195 minutes, assists 181, fouls committed 749 (almost all luck), crosses 45 and clearances 51 (very stable). A 58-minute winger's 3.10 goals/90 becomes an estimate of 0.79.
3. **Compare to position peers.** Main position = most minutes. Each stat becomes a z-score against the minutes-weighted mean and SD of the same position in the same age group. Groups under 8 players (keepers: 6 per age group) pool both age groups. z is clipped to ±3.
4. **Weight by role.** Hand-set weights per position: goals dominate for ST, progression and pass % for CM, aerials, clearances and interceptions for CB (full table on `/method`). The weighted sum is the raw score.
5. **Discount the whole score for small samples.** `score = raw × minutes / (minutes + 450)`. Step 2 handles noise in each stat; this handles the composite, which is ten noisy numbers added together.
6. **Percentile within age group.** Ranked 0–100, ties share.

**Where 450 comes from.** I rated every player with 2+ matches twice, on alternate matches (~84 minutes per half), and compared the two rankings: ρ = 0.17 with step 2 on. If a score built on *m* minutes has reliability *m/(m+K)*, then 0.17 at 84 minutes implies K ≈ 415. 450 is five full matches. Percentiles barely move between K = 180 and 540 (median change ≤ 1 point).

### What I tried

`npm run evaluate` runs all of these on the file. "Cameos in the tails" = players under 90 minutes landing in the top or bottom 10%, out of 53. Split-half ρ = agreement between ratings built on alternate matches.

| Model | Idea | Top 5 | Cameos in tails | Split-half ρ |
|---|---|---|---|---|
| A. Box score | Fixed points per action /90 for everyone | all five are 18–25 min cameos | 28 | 0.34 |
| B. Position z-score | Role-specific peers and weights | mixed positions, all 18–66 min | 24 | 0.23 |
| C. B + minutes shrink, K=270 (v1) | What I shipped first | four regulars, one 58 min | 6 | 0.18 |
| C′. C with K=450 | Isolates the effect of K | five regulars | 3 | 0.18 |
| D. Position-blind + shrink | One weight set for all outfielders | regulars | 1 | 0.35 |
| E. B + per-stat priors only | Step 2 without step 5 | 58-min W and 58-min ST in top 3 | 11 | 0.17 |
| **F. per-stat priors + minutes shrink (v2)** | **Chosen** | **five regulars, 200–270 min** | **1** | 0.16 |
| G. F, but z against estimated talent spread | Theoretically cleaner scaling | regulars | 2 | 0.10 |

- **A lost** because per-90 on 18 minutes is noise. One goal in a cameo is 5 goals/90, and it wins.
- **B fixed the role problem, not the sample problem.**
- **C (v1)** still had Roque Moliner (58 min, 2 goals, 1 assist) at the 99th percentile. The fix was v2.
- **D looks best on stability and is the worst model.** It puts 20 of 46 centre-mids in the top 20% and 0 of 22 strikers. It's stable because *role* is stable. Split-half agreement rewards anything consistent, including the wrong thing, so I never used it alone to choose a model.
- **E alone doesn't fix cameos.** After shrinking, Roque Moliner's goal rate is still honestly the highest among U15 wingers.
- **Being honest about F vs C′:** most of the improvement from v1 to v2 comes from the stronger whole-score shrink (C′ already gets cameos down to 3). The per-stat priors take it to 1 and, more importantly, shrink each stat for its own reason instead of pretending goals and passes are equally noisy.
- **G lost.** Dividing by the estimated talent spread τ, instead of the spread of the shrunk estimates, is what the textbook says. But stats where talent differences are barely detectable get a tiny τ, so small deviations blow up: stability fell to 0.10 and strikers dropped to 2 of 22 in the top 20%.
- F has the lowest split-half agreement of the sensible models. I think that's the honest result, not a defect: on 2–3 matches per player, most of the gap between two players is noise.

---

## What I noticed about the data

365 rows, 13 matches (6 U15, 7 U17), 6 clubs, 183 players after cleaning. Every item below is caught by the cleaner and shown in the upload report:

| Finding | Handling |
|---|---|
| Line 229 is an exact duplicate of line 135 (Aitor Cordero, M-1703): Girona have 15 rows in that match | dropped |
| 14 rows have team `atletico madrid`, 14 have `Real Madrid ` (trailing space) | normalised to the spelling used in home/away columns |
| `Samuel  Alonso` (double space), `cesar herrera ` (lowercase + space) | same player as the clean spelling |
| M-1504 and M-1705 dated `05/04/2026`, `11/04/2026`; all others ISO | read day-first. Evidence: fixtures are weekly per age group, and 5 Apr / 11 Apr fit the gaps (29 Mar → 12 Apr, 4 Apr → 18 Apr); 4 May / 4 Nov don't. |
| Blank `minutes_played` (Hugo Andrade, M-1506) | kept, excluded from rating (no per-90 without minutes) |
| `minutes_played = 0` with 7 touches and 7 passes (Nil Andrade, M-1701) | kept, excluded from rating. Probably a sub whose minutes weren't recorded. |
| Blank `touches`, `recoveries`, `duels_won` (one each) | null, not zero |
| Blank `position` (Mateo Otero, M-1707) | inferred: CM, from his other match |
| `passes_completed 69 > passes_attempted 65` (line 178) | flagged, capped for pass % |
| `goals > shots_on_target` twice (4 goals from 2 on target, line 201) | flagged; a goal is by definition on target, so one of the numbers is wrong |
| `progressive_passes 6 > passes_completed 5` (line 224) | flagged |
| "Pablo Ruiz" plays for Getafe U15 and Girona U17 | two players |
| `red_cards` is 0 in every row | kept; contributes nothing |
| No goalkeeper-specific stats at all (saves, shots faced, claims) | see keepers below |
| Team minutes don't sum to 990 (range 933–1110) | not flagged. Youth football allows rolling subs, so this is expected. |

---

## What is wrong with the rating

This is the part I'd most want to talk through.

1. **There isn't enough data to rate individuals.** Most players have 1–3 matches. Two halves of the same player's games agree at ρ ≈ 0.16. The percentile is an honest ranking of short samples and weak evidence about the player. Anyone under 90 minutes is marked "low sample".
2. **Cameos are damped, not solved.** Roque Moliner (58 minutes, 2 goals, 1 assist) went from 99th (v1) to 93rd (v2). He's the one sub-90-minute player still in the top 10%. With 58 minutes of evidence, 93rd may be too confident.
3. **It may be rating teams, not players.** Rank the 12 squads by average player percentile and by goal difference: ρ = 0.96. Real Madrid U15 (+12 GD) averages the 79th percentile and fills 8 of the U15 top 10; Getafe U15 (−10 GD) averages the 29th. Either better clubs have better players, which is plausible for academies, or a dominant team inflates everyone's per-90s. This file can't separate the two. There's also no opponent adjustment: stats from a 9–0 count the same as from a 1–1.
4. **Keepers are barely rated.** With no saves or shots faced, 40% of a keeper's rating is his team's goals conceded while he was on. The top-rated U15 player is Real Madrid's keeper, largely because Real Madrid conceded 1 goal in 3 matches.
5. **The weights are opinions.** Nothing in the file says what a good player is (no selection decisions, coach grades, or later outcomes), so nothing validates them.
6. **The shrinkage is two-stage and approximate.** Per-stat priors assume Poisson/binomial noise. Real match-to-match variation is bigger (overdispersed), so the priors are probably too weak, and the whole-score K partly compensates. One hierarchical model would do both jobs properly.
7. **Counts are volume, not quality.** Crosses and progressive passes have no completion or danger information; duels have no pitch location.
8. **Mixed-position percentiles.** The list ranks a CB at the 80th next to a ST at the 80th as if the scales matched. Each is good *for his role*; comparing across roles is a stretch the list quietly makes.

## With a week

- **One hierarchical model** (player effects within position, overdispersed counts) instead of two-stage shrinkage, with a **posterior interval** on each percentile ("between 55th and 90th") instead of a single number.
- **Opponent and team adjustment**: team and opponent effects in the same model, so a player's rating is what's left after his team's strength. That's the direct fix for the ρ = 0.96 problem.
- **Validate the weights** against anything external: coach ratings, selection, minutes next season. Or fit them rather than guess.
- **A real player ID** (or fuzzy matching with human confirmation in the upload flow) instead of name + club.
- **An upload preview**: show the cleaning report *before* committing, with accept/reject per issue. Plus upload auth, which there is none of now; anyone with the URL can upload.
- **Versioned ratings**: keep history per `model_version` so a formula change doesn't silently rewrite yesterday's numbers.
- **Position-filtered percentiles** as the default view, and a keeper model that waits for goalkeeper data.

---

## Approach note

**Data first.** The brief said the file was "as-is", so before building anything I profiled it: duplicates, name and team spelling variants, two date formats, blanks, and numbers that can't be true (more goals than shots on target). Every one of those became a rule in the cleaner and a line in the upload report, and several became unit tests.

**Rating.** I wanted something I could defend line by line, not a clever formula. Per-90 and comparing players within their position were the easy calls. The hard part was small samples: most players have 1–3 matches. So I wrote a script that runs every candidate formula on the file and compares them, and it changed my mind a few times:
- The simple points system put five 18–25 minute substitutes at the top. Discarded.
- The formula that looked most *consistent* (ignoring position) was only consistent because it ranks roles: centre-mids first, strikers last. So I stopped using consistency to pick a winner and used it to *measure* how noisy the data is instead. That measurement set how hard low-minute players get pulled toward average.
- My first version still had a 58-minute winger at the 99th percentile. I added per-stat shrinkage (goals are noisier than passes, so they're pulled harder). He dropped to 93rd. The script showed most of that gain came from the stronger overall pull, not the per-stat part. I kept both and said so.
- A more "textbook" version made the results worse, so I reverted it.

**What I'd flag first:** team goal difference predicts a squad's average rating almost perfectly (ρ = 0.96). I measured it but couldn't fix it in the time. The honest reading is that the rating may be partly rating the team.

**Where I got stuck.**
- *Player identity with no player ID.* I settled on name + age group + club and documented what that gets wrong.
- *Whether to trust the dd/mm dates.* I checked them against the weekly fixture pattern.
- *Production.* Most of my time went here. The app worked locally but broke three times on Vercel + Supabase:
  1. The Postgres driver double-encoded JSON, so player pages crashed.
  2. My own load test used up every database connection.
  3. After I cut to one connection per server, queries sent back-to-back through Supabase's pooler hung forever. The first fix for that hit a bug in the driver itself.

  Each one was found from logs and `pg_stat_activity`, and they're written up in the commit history. The lesson: test against the real database, not only a local stand-in.

**AI tools.** I built this with Claude Code (Anthropic's Claude), and it did most of the work: the code, the SQL, the tests, and a lot of the statistical reasoning. My part was steering it and checking it:
- deciding what to build and in what order
- choosing which weakness to fix before submitting
- reading the comparison numbers and pushing back when a result looked wrong
- setting up and deploying Supabase and Vercel
- running the database queries and pulling the logs that found the production bugs

Every number in this README comes from running `npm run evaluate` on the file, not from the model's say-so. I can walk through any of it on the call.
