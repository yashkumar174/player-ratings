import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_HEADERS } from "@/lib/columns";
import { cleanCsv, parseDate } from "@/lib/ingest/clean";

const header = REQUIRED_HEADERS.join(",");
function row(over: Record<string, string | number> = {}) {
  const base: Record<string, string | number> = Object.fromEntries(REQUIRED_HEADERS.map((h) => [h, 1]));
  Object.assign(base, {
    match_id: "M-1", match_date: "2026-03-14", competition: "Liga", age_group: "U15",
    home_team: "Real Madrid", away_team: "Getafe CF", team: "Real Madrid", opponent: "Getafe CF",
    venue: "home", goals_for: 1, goals_against: 0, player_name: "Ana Lopez", position: "CM",
    minutes_played: 90, passes_attempted: 10, passes_completed: 8, goals: 0, shots_on_target: 1,
  }, over);
  return REQUIRED_HEADERS.map((h) => base[h]).join(",");
}
const csv = (...rows: string[]) => [header, ...rows].join("\n");

describe("parseDate", () => {
  it("reads ISO and day-first dates", () => {
    expect(parseDate("2026-03-14")?.iso).toBe("2026-03-14");
    expect(parseDate("05/04/2026")).toEqual({ iso: "2026-04-05", format: "dmy" });
  });
  it("rejects impossible dates", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
});

describe("cleanCsv", () => {
  it("rejects a file missing columns", () => {
    const r = cleanCsv("match_id,player_name\nM-1,Ana");
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0].code).toBe("missing_headers");
  });

  it("collapses name and team spelling variants", () => {
    const r = cleanCsv(csv(
      row({ player_name: "Ana  Lopez" }),
      row({ match_id: "M-2", player_name: "ana lopez ", team: "real madrid " }),
    ));
    expect(new Set(r.rows.map((x) => x.playerName))).toEqual(new Set(["Ana Lopez"]));
    expect(new Set(r.rows.map((x) => x.team))).toEqual(new Set(["Real Madrid"]));
  });

  it("drops exact duplicates and keeps the later of conflicting ones", () => {
    const r = cleanCsv(csv(row(), row(), row({ touches: 99 })));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].stats.touches).toBe(99);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["exact_duplicate", "conflicting_duplicate"]));
  });

  it("keeps blanks as null, not zero", () => {
    const r = cleanCsv(csv(row({ touches: "" })));
    expect(r.rows[0].stats.touches).toBeNull();
    expect(r.rows[0].flags).toContain("missing_value");
  });

  it("infers a blank position from the player's other matches", () => {
    const r = cleanCsv(csv(row(), row({ match_id: "M-2", position: "" })));
    const inferred = r.rows.find((x) => x.matchId === "M-2")!;
    expect(inferred.position).toBe("CM");
    expect(inferred.positionInferred).toBe(true);
  });

  it("skips rows whose team is not in the fixture", () => {
    const r = cleanCsv(csv(row({ team: "Girona FC" })));
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0].code).toBe("team_not_in_fixture");
  });

  it("flags impossible stat combinations without changing them", () => {
    const r = cleanCsv(csv(row({ passes_completed: 12, passes_attempted: 10 })));
    expect(r.rows[0].stats.passes_completed).toBe(12);
    expect(r.rows[0].flags).toContain("completed_gt_attempted");
  });

  // The assignment CSV isn't committed (it's the company's data); drop it in data/ to run this.
  it.skipIf(!existsSync("data/match_events.csv"))("handles the provided export", () => {
    const r = cleanCsv(readFileSync("data/match_events.csv", "utf8"));
    expect(r.totalRows).toBe(365);
    expect(r.rows).toHaveLength(364); // one exact duplicate
    expect(new Set(r.rows.map((x) => `${x.playerKey}|${x.ageGroup}|${x.teamKey}`)).size).toBe(183); // 184 raw spellings, 2 collapse, Pablo Ruiz splits into 2
    expect(r.rows.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.matchDate))).toBe(true);
  });
});
