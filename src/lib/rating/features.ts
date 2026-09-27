import type { Position, StatColumn, Stats } from "@/lib/columns";

// Features are what the rating actually compares. Two kinds:
//  - per90: a counting stat divided by minutes, so a 30-minute sub and a
//    90-minute starter are on the same footing.
//  - rate: a success ratio (pass %, duel %), shrunk toward the peer-group
//    average so 1/1 aerials doesn't read as "100% aerial winner".

export interface AppearanceInput {
  matchId: string;
  matchDate: string;
  minutes: number | null;
  stats: Stats;
  /** Goals the player's team conceded in the match (used for goalkeepers only). */
  teamGoalsAgainst: number;
}

export type FeatureKey =
  | "goals"
  | "assists"
  | "shots_on_target"
  | "progressive_passes"
  | "dribbles_completed"
  | "crosses"
  | "fouls_won"
  | "tackles"
  | "interceptions"
  | "recoveries"
  | "clearances"
  | "fouls_committed"
  | "yellow_cards"
  | "conceded"
  | "pass_pct"
  | "duel_pct"
  | "aerial_pct"
  | "loss_rate";

interface Per90Def {
  kind: "per90";
  label: string;
  stat: StatColumn | "conceded";
}
interface RateDef {
  kind: "rate";
  label: string;
  /** Returns [successes, attempts] for one appearance, or null if a count is missing. */
  pair: (s: Stats) => [number, number] | null;
  /** Pseudo-attempts at the peer rate added before dividing. */
  prior: number;
}

export const FEATURES: Record<FeatureKey, Per90Def | RateDef> = {
  goals: { kind: "per90", label: "Goals /90", stat: "goals" },
  assists: { kind: "per90", label: "Assists /90", stat: "assists" },
  shots_on_target: { kind: "per90", label: "Shots on target /90", stat: "shots_on_target" },
  progressive_passes: { kind: "per90", label: "Progressive passes /90", stat: "progressive_passes" },
  dribbles_completed: { kind: "per90", label: "Dribbles won /90", stat: "dribbles_completed" },
  crosses: { kind: "per90", label: "Crosses /90", stat: "crosses" },
  fouls_won: { kind: "per90", label: "Fouls won /90", stat: "fouls_won" },
  tackles: { kind: "per90", label: "Tackles /90", stat: "tackles" },
  interceptions: { kind: "per90", label: "Interceptions /90", stat: "interceptions" },
  recoveries: { kind: "per90", label: "Recoveries /90", stat: "recoveries" },
  clearances: { kind: "per90", label: "Clearances /90", stat: "clearances" },
  fouls_committed: { kind: "per90", label: "Fouls committed /90", stat: "fouls_committed" },
  yellow_cards: { kind: "per90", label: "Yellow cards /90", stat: "yellow_cards" },
  conceded: { kind: "per90", label: "Team goals conceded /90", stat: "conceded" },
  pass_pct: {
    kind: "rate",
    label: "Pass completion",
    // The file has one row with completed > attempted; cap it rather than
    // letting it produce a >100% rate.
    pair: (s) =>
      s.passes_completed === null || s.passes_attempted === null
        ? null
        : [Math.min(s.passes_completed, s.passes_attempted), s.passes_attempted],
    prior: 20,
  },
  duel_pct: {
    kind: "rate",
    label: "Ground duels won",
    pair: (s) =>
      s.duels_won === null || s.duels_lost === null ? null : [s.duels_won, s.duels_won + s.duels_lost],
    prior: 8,
  },
  aerial_pct: {
    kind: "rate",
    label: "Aerial duels won",
    pair: (s) =>
      s.aerial_duels_won === null || s.aerial_duels_lost === null
        ? null
        : [s.aerial_duels_won, s.aerial_duels_won + s.aerial_duels_lost],
    prior: 6,
  },
  loss_rate: {
    kind: "rate",
    label: "Possession lost per touch",
    // Per touch, not per 90: a midfielder with 130 touches will lose the ball
    // more often in absolute terms without being careless.
    pair: (s) =>
      s.possession_lost === null || s.touches === null || s.touches === 0
        ? null
        : [Math.min(s.possession_lost, s.touches), s.touches],
    prior: 30,
  },
};

/**
 * Position weights. Negative weight = more of it is worse. These are my
 * judgement of what each role is asked to do, not fitted to anything; the
 * README says so. Each row's absolute weights sum to 1.
 */
export const WEIGHTS: Record<Position, Partial<Record<FeatureKey, number>>> = {
  ST: {
    goals: 0.3, shots_on_target: 0.12, assists: 0.12, dribbles_completed: 0.08,
    duel_pct: 0.06, aerial_pct: 0.06, pass_pct: 0.06, progressive_passes: 0.04,
    fouls_won: 0.05, recoveries: 0.04, loss_rate: -0.07,
  },
  W: {
    goals: 0.18, assists: 0.16, dribbles_completed: 0.14, progressive_passes: 0.1,
    shots_on_target: 0.08, crosses: 0.06, pass_pct: 0.06, duel_pct: 0.05,
    recoveries: 0.04, fouls_won: 0.03, loss_rate: -0.1,
  },
  CM: {
    progressive_passes: 0.18, pass_pct: 0.14, recoveries: 0.1, interceptions: 0.08,
    tackles: 0.08, duel_pct: 0.08, assists: 0.08, goals: 0.06, dribbles_completed: 0.05,
    loss_rate: -0.1, fouls_committed: -0.05,
  },
  FB: {
    tackles: 0.14, interceptions: 0.11, duel_pct: 0.1, progressive_passes: 0.1,
    recoveries: 0.09, assists: 0.08, pass_pct: 0.08, crosses: 0.07, aerial_pct: 0.05,
    dribbles_completed: 0.04, loss_rate: -0.08, fouls_committed: -0.05,
  },
  CB: {
    aerial_pct: 0.14, clearances: 0.12, interceptions: 0.12, duel_pct: 0.12, tackles: 0.1,
    pass_pct: 0.1, recoveries: 0.08, progressive_passes: 0.06, loss_rate: -0.06,
    fouls_committed: -0.05, yellow_cards: -0.05,
  },
  // No saves, shots faced or xG in the export, so a goalkeeper rating is
  // mostly team defence plus distribution. Flagged in the UI.
  GK: {
    conceded: -0.4, pass_pct: 0.2, clearances: 0.1, aerial_pct: 0.1, recoveries: 0.1,
    loss_rate: -0.1,
  },
};

export interface Totals {
  minutes: number;
  apps: number;
  per90Sum: Partial<Record<Per90Def["stat"], number>>;
  per90Mins: Partial<Record<Per90Def["stat"], number>>;
  rate: Partial<Record<FeatureKey, [number, number]>>;
}

/** Sums the rated appearances (minutes known and > 0). */
export function aggregate(apps: AppearanceInput[]): Totals {
  const t: Totals = { minutes: 0, apps: 0, per90Sum: {}, per90Mins: {}, rate: {} };
  for (const a of apps) {
    if (!a.minutes) continue;
    t.minutes += a.minutes;
    t.apps += 1;
    for (const [key, def] of Object.entries(FEATURES) as [FeatureKey, Per90Def | RateDef][]) {
      if (def.kind === "per90") {
        // Conceded is scaled by time on the pitch: a 30-minute keeper didn't
        // concede the whole match's goals.
        const v = def.stat === "conceded" ? (a.teamGoalsAgainst * a.minutes) / 90 : a.stats[def.stat];
        if (v === null) continue; // missing, not zero: don't count these minutes either
        t.per90Sum[def.stat] = (t.per90Sum[def.stat] ?? 0) + v;
        t.per90Mins[def.stat] = (t.per90Mins[def.stat] ?? 0) + a.minutes;
      } else {
        const p = def.pair(a.stats);
        if (!p) continue;
        const prev = t.rate[key] ?? [0, 0];
        t.rate[key] = [prev[0] + p[0], prev[1] + p[1]];
      }
    }
  }
  return t;
}

/** Raw (un-smoothed) feature value, or null when there is nothing to measure. */
export function rawFeature(t: Totals, key: FeatureKey): number | null {
  const def = FEATURES[key];
  if (def.kind === "per90") {
    const m = t.per90Mins[def.stat];
    return m ? ((t.per90Sum[def.stat] ?? 0) / m) * 90 : null;
  }
  const p = t.rate[key];
  return p && p[1] > 0 ? p[0] / p[1] : null;
}

/** Feature value with rate features pulled toward the peer rate. */
export function smoothedFeature(t: Totals, key: FeatureKey, peerRate: number): number | null {
  const def = FEATURES[key];
  if (def.kind === "per90") return rawFeature(t, key);
  const [s, n] = t.rate[key] ?? [0, 0];
  return (s + def.prior * peerRate) / (n + def.prior);
}
