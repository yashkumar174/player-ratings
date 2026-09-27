import type { PlayerInput } from "@/lib/rating/compute";
import type { CleanAppearance } from "./clean";

/** A player is a name within one squad: (name, age group, club). */
export function playerIdentity(r: Pick<CleanAppearance, "playerKey" | "ageGroup" | "teamKey">): string {
  return `${r.playerKey}|${r.ageGroup}|${r.teamKey}`;
}

/** Groups cleaned CSV rows into rating inputs, without touching the DB. */
export function toPlayerInputs(rows: CleanAppearance[]): { inputs: PlayerInput[]; names: Map<number, string> } {
  const ids = new Map<string, number>();
  const names = new Map<number, string>();
  const inputs = new Map<number, PlayerInput>();
  for (const r of rows) {
    const key = playerIdentity(r);
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    const playerId = ids.get(key)!;
    names.set(playerId, r.playerName);
    const input = inputs.get(playerId) ?? { playerId, ageGroup: r.ageGroup, appearances: [] };
    input.appearances.push({
      matchId: r.matchId,
      matchDate: r.matchDate,
      minutes: r.minutes,
      position: r.position,
      stats: r.stats,
      teamGoalsAgainst: r.team === r.homeTeam ? r.awayGoals : r.homeGoals,
    });
    inputs.set(playerId, input);
  }
  return { inputs: [...inputs.values()], names };
}
