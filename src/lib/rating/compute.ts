import type { Position } from "@/lib/columns";
import {
  FEATURES,
  WEIGHTS,
  aggregate,
  evidence,
  rawFeature,
  smoothedFeature,
  type AppearanceInput,
  type FeatureKey,
  type Prior,
  type Totals,
} from "./features";
import { empiricalStrength } from "./priors";

export const MODEL_VERSION = "pz-eb-shrink-v2";

/**
 * Minutes at which the composite score is trusted halfway (reliability 0.5).
 * Derived from split-half agreement on the sample file with per-stat priors
 * on (implied K ≈ 415, see scripts/evaluate-ratings.ts), rounded to five full
 * matches. Percentiles barely move between 270 and 540.
 */
export const SHRINK_MINUTES = 450;
/** Under this many minutes the UI labels a rating "low sample". */
export const LOW_SAMPLE_MINUTES = 90;
/** Below this many players, a position's peer group pools both age groups. */
export const MIN_PEERS = 8;
/** z-scores are clipped so one freak per-90 can't dominate a composite. */
const Z_CLIP = 3;
/** Single-match scores under this many minutes are shown as "too short". */
export const MIN_MATCH_MINUTES = 20;

export interface PlayerInput {
  playerId: number;
  ageGroup: string;
  appearances: (AppearanceInput & { position: Position | null })[];
}

export interface Component {
  feature: FeatureKey;
  label: string;
  /** Unsmoothed per-90 or rate, as the raw numbers show it. */
  raw: number;
  /** After shrinking toward the peer average; this is what gets compared. */
  value: number;
  peerMean: number;
  z: number;
  weight: number;
  /** weight * z / sum|weights| — these add up to rawScore. */
  contribution: number;
}

export interface MatchScore {
  matchId: string;
  minutes: number;
  /** Raw composite for this match alone; null when too few minutes to mean anything. */
  score: number | null;
}

export interface PlayerRating {
  playerId: number;
  ageGroup: string;
  position: Position;
  peerGroup: string;
  peerCount: number;
  minutes: number;
  apps: number;
  rawScore: number;
  reliability: number;
  score: number;
  percentile: number;
  components: Component[];
  matchScores: MatchScore[];
}

export interface ModelOptions {
  /** Compare within position (true) or against every outfield player (false). */
  positionAware: boolean;
  /** Shrink the whole score toward average by minutes; null disables. */
  shrinkMinutes: number | null;
  /**
   * How each feature is smoothed before comparing: "fixed" pseudo-counts on
   * rates only, or "empirical" per-feature priors learned from the peers.
   */
  featurePriors: "fixed" | "empirical";
}

export const PRODUCTION_MODEL: ModelOptions = {
  positionAware: true,
  shrinkMinutes: SHRINK_MINUTES,
  featurePriors: "empirical",
};

interface Prepared {
  input: PlayerInput;
  position: Position;
  totals: Totals;
  group: string;
}

interface GroupStats {
  count: number;
  prior: Partial<Record<FeatureKey, Prior>>;
  mean: Partial<Record<FeatureKey, number>>;
  sd: Partial<Record<FeatureKey, number>>;
}

/** The position he played most minutes in. */
export function primaryPosition(apps: PlayerInput["appearances"]): Position | null {
  const mins = new Map<Position, number>();
  for (const a of apps) if (a.position) mins.set(a.position, (mins.get(a.position) ?? 0) + (a.minutes ?? 0));
  let best: Position | null = null;
  for (const [p, m] of mins) if (best === null || m > mins.get(best)!) best = p;
  return best;
}

function weightedMeanSd(values: { v: number; w: number }[]): { mean: number; sd: number } {
  const W = values.reduce((s, x) => s + x.w, 0);
  if (!W) return { mean: 0, sd: 0 };
  const mean = values.reduce((s, x) => s + x.v * x.w, 0) / W;
  const variance = values.reduce((s, x) => s + x.w * (x.v - mean) ** 2, 0) / W;
  return { mean, sd: Math.sqrt(variance) };
}

function groupStats(members: Prepared[], features: FeatureKey[], priors: ModelOptions["featurePriors"]): GroupStats {
  const gs: GroupStats = { count: members.length, prior: {}, mean: {}, sd: {} };
  for (const f of features) {
    const def = FEATURES[f];
    const obs = members.map((m) => evidence(m.totals, f)).filter((e): e is [number, number] => e !== null);
    const exposure = obs.reduce((s, [, e]) => s + e, 0);
    const rate = exposure ? obs.reduce((s, [x]) => s + x, 0) / exposure : 0;
    const strength =
      priors === "empirical" ? empiricalStrength(obs, def.kind) : def.kind === "rate" ? def.prior : 0;
    gs.prior[f] = { mean: rate, strength };
    // Minutes-weighted, so a 4-minute cameo's extreme per-90 barely moves the
    // baseline everyone else is measured against. (Tried: dividing by the
    // estimated talent spread instead. It lost: see README, model G.)
    const { mean, sd } = weightedMeanSd(
      members
        .map((m) => ({ v: smoothedFeature(m.totals, f, gs.prior[f]!), w: m.totals.minutes }))
        .filter((x): x is { v: number; w: number } => x.v !== null),
    );
    gs.mean[f] = mean;
    gs.sd[f] = sd;
  }
  return gs;
}

type Weights = Partial<Record<FeatureKey, number>>;

function scoreTotals(t: Totals, weights: Weights, gs: GroupStats): { raw: number; components: Component[] } {
  const components: Component[] = [];
  let totalAbs = 0;
  for (const [f, w] of Object.entries(weights) as [FeatureKey, number][]) {
    const value = smoothedFeature(t, f, gs.prior[f]!);
    if (value === null) continue; // not measured: drop the weight rather than guess
    const sd = gs.sd[f] ?? 0;
    const mean = gs.mean[f] ?? 0;
    const z = sd > 1e-9 ? Math.max(-Z_CLIP, Math.min(Z_CLIP, (value - mean) / sd)) : 0;
    const raw = rawFeature(t, f) ?? value;
    components.push({ feature: f, label: FEATURES[f].label, raw, value, peerMean: mean, z, weight: w, contribution: w * z });
    totalAbs += Math.abs(w);
  }
  if (!totalAbs) return { raw: 0, components };
  for (const c of components) c.contribution /= totalAbs;
  return { raw: components.reduce((s, c) => s + c.contribution, 0), components };
}

/** Average-rank percentile in [0, 100]: worst = 0, best = 100, ties share. */
export function percentiles(scores: number[]): number[] {
  const n = scores.length;
  if (n === 1) return [50];
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
  const out = new Array<number>(n);
  for (let k = 0; k < n; ) {
    let j = k;
    while (j + 1 < n && order[j + 1].s === order[k].s) j++;
    const avgRank = (k + j) / 2;
    for (let x = k; x <= j; x++) out[order[x].i] = (avgRank / (n - 1)) * 100;
    k = j + 1;
  }
  return out;
}

export function computeRatings(players: PlayerInput[], opts: ModelOptions = PRODUCTION_MODEL): PlayerRating[] {
  const prepared: Prepared[] = [];
  for (const input of players) {
    const position = primaryPosition(input.appearances);
    const totals = aggregate(input.appearances);
    if (!position || totals.minutes <= 0) continue; // unrated: nothing to measure
    prepared.push({ input, position, totals, group: "" });
  }

  // Outfield "position-blind" mode still keeps keepers apart: rating a
  // keeper on striker stats is not a model, it's a bug.
  const bucket = (p: Prepared) => (opts.positionAware || p.position === "GK" ? p.position : "OUTFIELD");
  const exactSize = new Map<string, number>();
  for (const p of prepared) {
    const k = `${p.input.ageGroup}|${bucket(p)}`;
    exactSize.set(k, (exactSize.get(k) ?? 0) + 1);
  }
  for (const p of prepared) {
    const exact = `${p.input.ageGroup}|${bucket(p)}`;
    p.group = exactSize.get(exact)! >= MIN_PEERS ? exact : `ALL|${bucket(p)}`;
  }

  const allFeatures = Object.keys(FEATURES) as FeatureKey[];
  const groups = new Map<string, GroupStats>();
  for (const [g, members] of Map.groupBy(prepared, (p) => p.group)) groups.set(g, groupStats(members, allFeatures, opts.featurePriors));

  // Position-blind mode uses one generic weight set, the average of the
  // outfield roles. That's the point of the comparison.
  const blended = blendOutfield();

  const rated = prepared.map((p) => {
    const gs = groups.get(p.group)!;
    const weights = opts.positionAware || p.position === "GK" ? WEIGHTS[p.position] : blended;
    const { raw, components } = scoreTotals(p.totals, weights, gs);
    const reliability = opts.shrinkMinutes ? p.totals.minutes / (p.totals.minutes + opts.shrinkMinutes) : 1;
    const matchScores = p.input.appearances.map((a): MatchScore => {
      const minutes = a.minutes ?? 0;
      if (minutes < MIN_MATCH_MINUTES) return { matchId: a.matchId, minutes, score: null };
      return { matchId: a.matchId, minutes, score: scoreTotals(aggregate([a]), weights, gs).raw };
    });
    return {
      playerId: p.input.playerId,
      ageGroup: p.input.ageGroup,
      position: p.position,
      peerGroup: p.group,
      peerCount: gs.count,
      minutes: p.totals.minutes,
      apps: p.totals.apps,
      rawScore: raw,
      reliability,
      score: raw * reliability,
      percentile: 0,
      components,
      matchScores,
    } satisfies PlayerRating;
  });

  for (const [, list] of Map.groupBy(rated, (r) => r.ageGroup)) {
    const pct = percentiles(list.map((r) => r.score));
    list.forEach((r, i) => (r.percentile = pct[i]));
  }
  return rated;
}

function blendOutfield(): Weights {
  const outfield: Position[] = ["CB", "FB", "CM", "W", "ST"];
  const out: Weights = {};
  for (const pos of outfield)
    for (const [f, w] of Object.entries(WEIGHTS[pos]) as [FeatureKey, number][])
      out[f] = (out[f] ?? 0) + w / outfield.length;
  return out;
}
