// How hard to shrink each feature, learned from the peer group itself
// (method-of-moments empirical Bayes).
//
// Across players, the spread of observed rates has two parts: real
// differences between players (tau^2) and luck from finite exposure. For a
// count per minute the luck part is Poisson, mean/minutes; for a success rate
// it is binomial, p(1-p)/attempts. Whatever spread luck can't explain is
// talent. The prior is then worth k = noise-per-unit / tau^2 units of
// exposure: rare, noisy stats (goals) get a big k and are shrunk hard, common
// stable ones (passes) get a small k and are left mostly alone.

export const PRIOR_BOUNDS = {
  per90: { min: 45, max: 2700 }, // minutes
  rate: { min: 5, max: 1000 }, // attempts
} as const;

/**
 * @param obs one [count, exposure] pair per player
 * @returns prior strength in exposure units (minutes or attempts)
 */
export function empiricalStrength(obs: [number, number][], kind: "per90" | "rate"): number {
  const { min, max } = PRIOR_BOUNDS[kind];
  const used = obs.filter(([, e]) => e > 0);
  const E = used.reduce((s, [, e]) => s + e, 0);
  if (used.length < 3 || !E) return max;
  const mu = used.reduce((s, [x]) => s + x, 0) / E;
  // Per-unit noise variance: Poisson for counts, binomial for rates.
  const unitNoise = kind === "per90" ? mu : mu * (1 - mu);
  if (unitNoise <= 0) return max; // nobody ever does it: nothing to learn
  const observedVar = used.reduce((s, [x, e]) => s + e * (x / e - mu) ** 2, 0) / E;
  const tau2 = observedVar - (unitNoise * used.length) / E;
  if (tau2 <= 0) return max; // all of the spread is luck
  return Math.min(max, Math.max(min, unitNoise / tau2));
}
