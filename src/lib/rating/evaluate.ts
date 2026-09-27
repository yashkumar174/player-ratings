import type { Position } from "@/lib/columns";
import { aggregate, rawFeature } from "./features";
import { computeRatings, percentiles, type ModelOptions, type PlayerInput } from "./compute";

// Tools for comparing candidate rating formulas. Used by
// scripts/evaluate-ratings.ts; the numbers end up in the README.

export interface Scored {
  playerId: number;
  ageGroup: string;
  position: Position;
  minutes: number;
  score: number;
  percentile: number;
}

export interface Candidate {
  name: string;
  run: (players: PlayerInput[]) => Scored[];
}

/**
 * Model A: a fantasy-football style box score. Fixed points per action per
 * 90, same for every position, no small-sample correction.
 */
export const BOX_SCORE_POINTS = {
  goals: 3, assists: 2, shots_on_target: 0.5, progressive_passes: 0.3,
  dribbles_completed: 0.3, tackles: 0.5, interceptions: 0.5, recoveries: 0.2,
  clearances: 0.2, fouls_committed: -0.3, yellow_cards: -1,
} as const;

export function boxScore(players: PlayerInput[]): Scored[] {
  const out: Scored[] = [];
  for (const p of players) {
    const ratedApps = p.appearances.filter((a) => a.minutes);
    const t = aggregate(ratedApps);
    const position = mostMinutes(ratedApps);
    if (!t.minutes || !position) continue;
    let score = 0;
    for (const [k, pts] of Object.entries(BOX_SCORE_POINTS))
      score += (rawFeature(t, k as keyof typeof BOX_SCORE_POINTS) ?? 0) * pts;
    const lost = p.appearances.reduce((s, a) => s + (a.minutes ? (a.stats.possession_lost ?? 0) : 0), 0);
    score -= ((lost / t.minutes) * 90) * 0.2;
    out.push({ playerId: p.playerId, ageGroup: p.ageGroup, position, minutes: t.minutes, score, percentile: 0 });
  }
  for (const [, list] of Map.groupBy(out, (r) => r.ageGroup)) {
    const pct = percentiles(list.map((r) => r.score));
    list.forEach((r, i) => (r.percentile = pct[i]));
  }
  return out;
}

function mostMinutes(apps: PlayerInput["appearances"]): Position | null {
  const m = new Map<Position, number>();
  for (const a of apps) if (a.position) m.set(a.position, (m.get(a.position) ?? 0) + (a.minutes ?? 0));
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export const model = (opts: ModelOptions) => (players: PlayerInput[]) => computeRatings(players, opts);

/** Spearman rank correlation. */
export function spearman(a: number[], b: number[]): number {
  const ra = percentiles(a), rb = percentiles(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Split-half stability: rate every player on his odd-numbered matches and
 * again on his even-numbered ones (by date), then ask whether the two halves
 * agree. A rating that measures the player, not the noise, should.
 */
export function splitHalf(players: PlayerInput[], run: Candidate["run"]): { n: number; rho: number } {
  const eligible = players.filter((p) => p.appearances.filter((a) => a.minutes).length >= 2);
  const half = (k: 0 | 1) =>
    eligible.map((p) => ({
      ...p,
      appearances: p.appearances
        .filter((a) => a.minutes)
        .sort((x, y) => x.matchDate.localeCompare(y.matchDate))
        .filter((_, i) => i % 2 === k),
    }));
  const h1 = new Map(run(half(0)).map((r) => [r.playerId, r.percentile]));
  const h2 = new Map(run(half(1)).map((r) => [r.playerId, r.percentile]));
  const ids = [...h1.keys()].filter((id) => h2.has(id));
  return { n: ids.length, rho: spearman(ids.map((id) => h1.get(id)!), ids.map((id) => h2.get(id)!)) };
}

export function topShareByPosition(scored: Scored[], topFraction = 0.2): Record<string, { top: number; all: number }> {
  const out: Record<string, { top: number; all: number }> = {};
  const cut = 100 * (1 - topFraction);
  for (const s of scored) {
    out[s.position] ??= { top: 0, all: 0 };
    out[s.position].all++;
    if (s.percentile >= cut) out[s.position].top++;
  }
  return out;
}
