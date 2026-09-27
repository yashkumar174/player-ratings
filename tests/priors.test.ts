import { describe, expect, it } from "vitest";
import { empiricalStrength, PRIOR_BOUNDS } from "@/lib/rating/priors";

describe("empiricalStrength", () => {
  it("gives the maximum when all the spread is luck", () => {
    // Everyone has exactly the same underlying rate: identical observations.
    expect(empiricalStrength(Array.from({ length: 20 }, () => [1, 90] as [number, number]), "per90")).toBe(PRIOR_BOUNDS.per90.max);
  });

  it("shrinks a rare stat harder than a common one with the same relative spread", () => {
    // Same 2x talent gap between halves of the group, but 20x fewer events.
    const make = (lo: number, hi: number) =>
      Array.from({ length: 40 }, (_, i) => [i % 2 ? hi : lo, 180] as [number, number]);
    const rare = empiricalStrength(make(1, 2), "per90");
    const common = empiricalStrength(make(20, 40), "per90");
    expect(rare).toBeGreaterThan(common);
  });

  it("stays within bounds for rates", () => {
    const k = empiricalStrength(Array.from({ length: 30 }, (_, i) => [i % 3, 3] as [number, number]), "rate");
    expect(k).toBeGreaterThanOrEqual(PRIOR_BOUNDS.rate.min);
    expect(k).toBeLessThanOrEqual(PRIOR_BOUNDS.rate.max);
  });
});
