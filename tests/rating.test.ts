import { describe, expect, it } from "vitest";
import { STAT_COLUMNS, type Position, type Stats } from "@/lib/columns";
import { computeRatings, percentiles, type PlayerInput } from "@/lib/rating/compute";

const zero = () => Object.fromEntries(STAT_COLUMNS.map((c) => [c, 0])) as Stats;
let nextId = 1;
function player(position: Position, minutes: number[], stats: Partial<Stats> = {}, ageGroup = "U15"): PlayerInput {
  return {
    playerId: nextId++,
    ageGroup,
    appearances: minutes.map((m, i) => ({
      matchId: `M-${i}`, matchDate: `2026-03-${10 + i}`, minutes: m, position,
      stats: { ...zero(), touches: 40, passes_attempted: 30, passes_completed: 24, ...stats }, teamGoalsAgainst: 1,
    })),
  };
}

describe("percentiles", () => {
  it("spans 0..100 and shares ties", () => {
    expect(percentiles([1, 2, 3])).toEqual([0, 50, 100]);
    expect(percentiles([5, 5, 1])).toEqual([75, 75, 0]);
    expect(percentiles([7])).toEqual([50]);
  });
});

describe("computeRatings", () => {
  const peers = () => Array.from({ length: 9 }, () => player("ST", [90, 90]));

  it("ranks a scoring striker above goalless peers", () => {
    const star = player("ST", [90, 90, 90], { goals: 2, shots_on_target: 3 });
    const r = computeRatings([star, ...peers()]);
    expect(r.find((x) => x.playerId === star.playerId)!.percentile).toBe(100);
  });

  it("shrinks a short cameo below a sustained performer with the same per-90", () => {
    const cameo = player("ST", [10], { goals: 1, shots_on_target: 1 });
    const regular = player("ST", [90, 90, 90], { goals: 1, shots_on_target: 1 }); // lower per-90, more evidence
    const r = computeRatings([cameo, regular, ...peers()]);
    const get = (p: PlayerInput) => r.find((x) => x.playerId === p.playerId)!;
    expect(get(cameo).reliability).toBeLessThan(0.05);
    expect(get(regular).score).toBeGreaterThan(get(cameo).score);
  });

  it("leaves players with no recorded minutes unrated", () => {
    const ghost = player("CM", [0]);
    expect(computeRatings([ghost, ...peers()]).some((x) => x.playerId === ghost.playerId)).toBe(false);
  });

  it("ranks age groups separately", () => {
    const u17 = Array.from({ length: 3 }, () => player("ST", [90], {}, "U17"));
    const r = computeRatings([...peers(), ...u17]).filter((x) => x.ageGroup === "U17");
    expect(r.map((x) => x.percentile).sort()).toEqual([50, 50, 50]);
  });

  it("components add up to the raw score", () => {
    const r = computeRatings([player("CM", [90], { progressive_passes: 6 }), ...Array.from({ length: 8 }, () => player("CM", [90]))]);
    for (const x of r) expect(x.components.reduce((s, c) => s + c.contribution, 0)).toBeCloseTo(x.rawScore, 10);
  });
});
