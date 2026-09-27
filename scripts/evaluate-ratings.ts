// Compares the candidate rating formulas on a CSV export.
//   npx tsx scripts/evaluate-ratings.ts path/to/match_events.csv
import { readFileSync } from "node:fs";
import { cleanCsv } from "@/lib/ingest/clean";
import { playerIdentity, toPlayerInputs } from "@/lib/ingest/to-inputs";
import { SHRINK_MINUTES } from "@/lib/rating/compute";
import { FEATURES, aggregate, evidence, type FeatureKey } from "@/lib/rating/features";
import { empiricalStrength } from "@/lib/rating/priors";
import { boxScore, model, spearman, splitHalf, topShareByPosition, type Candidate, type Scored } from "@/lib/rating/evaluate";

const file = process.argv[2] ?? "data/match_events.csv";
const { rows, issues } = cleanCsv(readFileSync(file, "utf8"));
const { inputs, names } = toPlayerInputs(rows);
console.log(`${rows.length} appearances, ${inputs.length} players, ${issues.length} issues\n`);

const fixed = { featurePriors: "fixed" } as const;
const empirical = { featurePriors: "empirical" } as const;
const candidates: Candidate[] = [
  { name: "A. Box score (fixed points /90)", run: boxScore },
  { name: "B. Position z-score, no shrinkage", run: model({ ...fixed, positionAware: true, shrinkMinutes: null }) },
  // v1 as first shipped: K derived from B's split-half (≈285) and rounded to 270.
  { name: "C. B + global minutes shrinkage (K=270, v1)", run: model({ ...fixed, positionAware: true, shrinkMinutes: 270 }) },
  { name: `C'. C with the v2 K (K=${SHRINK_MINUTES})`, run: model({ ...fixed, positionAware: true, shrinkMinutes: SHRINK_MINUTES }) },
  { name: "D. Position-blind + global shrinkage", run: model({ ...fixed, positionAware: false, shrinkMinutes: SHRINK_MINUTES }) },
  { name: "E. Position z-score + per-stat empirical priors", run: model({ ...empirical, positionAware: true, shrinkMinutes: null }) },
  { name: `F. E + global minutes shrinkage (K=${SHRINK_MINUTES})`, run: model({ ...empirical, positionAware: true, shrinkMinutes: SHRINK_MINUTES }) },
];

const fmt = (x: number) => x.toFixed(2);
for (const c of candidates) {
  const scored: Scored[] = c.run(inputs);
  const share = topShareByPosition(scored);
  const lowMin = scored.filter((s) => s.minutes < 90);
  const lowInTails = lowMin.filter((s) => s.percentile >= 90 || s.percentile <= 10).length;
  const sh = splitHalf(inputs, c.run);
  const top = [...scored].sort((a, b) => b.percentile - a.percentile || b.score - a.score).slice(0, 5);
  console.log(`## ${c.name}`);
  console.log(`  top-20% by position (top/all): ${Object.entries(share).map(([p, v]) => `${p} ${v.top}/${v.all}`).join("  ")}`);
  console.log(`  players under 90 min landing in top or bottom decile: ${lowInTails}/${lowMin.length}`);
  console.log(`  split-half rank agreement: rho=${fmt(sh.rho)} (n=${sh.n})`);
  console.log(`  top 5: ${top.map((t) => `${names.get(t.playerId)} (${t.position}, ${t.ageGroup}, ${t.minutes}')`).join("; ")}\n`);
}

// Sensitivity of the chosen model to K.
const base = new Map(model({ ...empirical, positionAware: true, shrinkMinutes: SHRINK_MINUTES })(inputs).map((r) => [r.playerId, r.percentile]));
for (const k of [180, 540]) {
  const alt = model({ ...empirical, positionAware: true, shrinkMinutes: k })(inputs);
  const diffs = alt.map((r) => Math.abs(r.percentile - base.get(r.playerId)!));
  console.log(`K=${k} vs K=${SHRINK_MINUTES}: median |Δpercentile| ${fmt(diffs.sort((a, b) => a - b)[diffs.length >> 1])}, max ${fmt(Math.max(...diffs))}`);
}

// Deriving K from the data instead of picking it. If one "half" of a player's
// matches (m minutes on average) gives ratings that agree with the other half
// at rho, then a rating built on m minutes is about rho reliable. Under the
// m/(m+K) reliability curve that means K = m(1-rho)/rho.
{
  const eligible = inputs.filter((p) => p.appearances.filter((a) => a.minutes).length >= 2);
  const halfMinutes =
    eligible.reduce((s, p) => s + p.appearances.reduce((t, a) => t + (a.minutes ?? 0), 0), 0) / eligible.length / 2;
  const { rho } = splitHalf(inputs, model({ ...empirical, positionAware: true, shrinkMinutes: null }));
  const k = (halfMinutes * (1 - rho)) / rho;
  console.log(`\nimplied K: half = ${halfMinutes.toFixed(0)} min, rho = ${fmt(rho)} -> K ≈ ${k.toFixed(0)} min`);
}

// Team effect: does the rating mostly reflect which club you play for?
{
  const rated = model({ ...empirical, positionAware: true, shrinkMinutes: SHRINK_MINUTES })(inputs);
  // Same id assignment as toPlayerInputs: first appearance order.
  const byPlayerTeam = new Map<number, string>();
  const ids = new Map<string, number>();
  for (const r of rows) {
    const key = playerIdentity(r);
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    byPlayerTeam.set(ids.get(key)!, r.team);
  }
  const gd = new Map<string, number>();
  for (const [, list] of Map.groupBy(rows, (r) => r.matchId)) {
    const r = list[0];
    const k = (t: string) => `${r.ageGroup}|${t}`;
    gd.set(k(r.homeTeam), (gd.get(k(r.homeTeam)) ?? 0) + r.homeGoals - r.awayGoals);
    gd.set(k(r.awayTeam), (gd.get(k(r.awayTeam)) ?? 0) + r.awayGoals - r.homeGoals);
  }
  console.log("\nmean percentile by team (goal difference):");
  const rowsOut: [string, number, number, number][] = [];
  for (const [key, list] of Map.groupBy(rated, (r) => `${r.ageGroup}|${byPlayerTeam.get(r.playerId)}`)) {
    rowsOut.push([key, list.reduce((s, r) => s + r.percentile, 0) / list.length, gd.get(key) ?? 0, list.length]);
  }
  rowsOut.sort((a, b) => a[0].localeCompare(b[0]) || b[1] - a[1]);
  for (const [k, m, g, n] of rowsOut) console.log(`  ${k.padEnd(24)} ${m.toFixed(0).padStart(3)}  GD ${g >= 0 ? "+" : ""}${g}  (n=${n})`);
  console.log(`  rank corr(team GD, team mean pct): ${fmt(spearman(rowsOut.map((r) => r[2]), rowsOut.map((r) => r[1])))}`);
}

// What the empirical priors learned, pooled over all players (one group).
{
  const all = inputs.map((p) => aggregate(p.appearances));
  console.log("\nlearned prior strength (all players pooled):");
  for (const f of Object.keys(FEATURES) as FeatureKey[]) {
    const obs = all.map((t) => evidence(t, f)).filter((e): e is [number, number] => e !== null);
    const unit = FEATURES[f].kind === "per90" ? "min" : "attempts";
    console.log(`  ${f.padEnd(20)} ${empiricalStrength(obs, FEATURES[f].kind).toFixed(0).padStart(5)} ${unit}`);
  }
}
