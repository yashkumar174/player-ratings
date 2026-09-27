import Papa from "papaparse";
import {
  POSITIONS,
  REQUIRED_HEADERS,
  STAT_COLUMNS,
  type Position,
  type Stats,
} from "@/lib/columns";

// Turns the raw export into validated, normalised appearance rows plus a
// report of everything that was changed or looked wrong. Pure: no DB access,
// so the whole cleaning policy is unit-testable.

export type Severity = "error" | "warning" | "info";

export interface Issue {
  /** 1-based line number in the file (header is line 1), null for file/match-level issues. */
  line: number | null;
  severity: Severity;
  code: IssueCode;
  message: string;
}

export type IssueCode =
  | "missing_headers"
  | "missing_required"
  | "bad_date"
  | "ambiguous_date_format"
  | "team_not_in_fixture"
  | "match_inconsistent"
  | "name_normalised"
  | "team_normalised"
  | "exact_duplicate"
  | "conflicting_duplicate"
  | "missing_value"
  | "invalid_value"
  | "position_inferred"
  | "position_missing"
  | "minutes_missing"
  | "zero_minutes_with_actions"
  | "completed_gt_attempted"
  | "goals_gt_on_target"
  | "on_target_gt_shots"
  | "progressive_gt_completed"
  | "goals_sum_mismatch"
  | "same_name_multiple_squads";

export interface CleanAppearance {
  line: number;
  matchId: string;
  matchDate: string; // ISO yyyy-mm-dd
  competition: string;
  ageGroup: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  team: string;
  teamKey: string;
  playerName: string;
  playerKey: string; // name key only; identity is (playerKey, ageGroup, teamKey)
  position: Position | null;
  positionInferred: boolean;
  minutes: number | null;
  stats: Stats;
  /** Issue codes attached to this row, stored with the appearance. */
  flags: IssueCode[];
}

export interface CleanResult {
  rows: CleanAppearance[];
  issues: Issue[];
  totalRows: number;
  skippedRows: number;
}

const MAX_MINUTES = 130; // 90 + extra time + stoppage; anything above is a typo

export function nameKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
  return s.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
}

/** Accepts ISO dates and day-first dd/mm/yyyy (the source is Spanish). */
export function parseDate(raw: string): { iso: string; format: "iso" | "dmy" } | null {
  const s = raw.trim();
  let y: number, m: number, d: number, format: "iso" | "dmy";
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    [y, m, d] = [+match[1], +match[2], +match[3]];
    format = "iso";
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    [d, m, y] = [+match[1], +match[2], +match[3]];
    format = "dmy";
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { iso: dt.toISOString().slice(0, 10), format };
}

function parseCount(raw: string | undefined): { value: number | null; problem?: "missing" | "invalid" } {
  const s = (raw ?? "").trim();
  if (s === "" || /^(na|n\/a|null|nan|-)$/i.test(s)) return { value: null, problem: "missing" };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { value: null, problem: "invalid" };
  return { value: n };
}

/** Most frequent value; ties broken by the first callback preference. */
function pickCanonical(variants: string[], prefer: (s: string) => number = () => 0): string {
  const counts = new Map<string, number>();
  for (const v of variants) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => prefer(b[0]) - prefer(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0][0];
}

export function cleanCsv(text: string): CleanResult {
  const issues: Issue[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headers = parsed.meta.fields ?? [];
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    issues.push({
      line: 1,
      severity: "error",
      code: "missing_headers",
      message: `Missing columns: ${missing.join(", ")}`,
    });
    return { rows: [], issues, totalRows: parsed.data.length, skippedRows: parsed.data.length };
  }

  const raw = parsed.data.map((r, i) => ({ r, line: i + 2 }));

  // Pass 1: canonical display names for teams and players, from every
  // spelling in the file. "atletico madrid" and "Real Madrid " collapse onto
  // the spelling used in the home_team/away_team columns.
  const teamVariants = new Map<string, string[]>();
  const nameVariants = new Map<string, string[]>();
  for (const { r } of raw) {
    for (const t of [r.home_team, r.away_team, r.team, r.opponent]) {
      if (!t?.trim()) continue;
      const k = nameKey(t);
      teamVariants.set(k, [...(teamVariants.get(k) ?? []), tidy(t)]);
    }
    if (r.player_name?.trim()) {
      const k = nameKey(r.player_name);
      nameVariants.set(k, [...(nameVariants.get(k) ?? []), tidy(r.player_name)]);
    }
  }
  const properCase = (s: string) => (s !== s.toLowerCase() ? 1 : 0);
  const teamName = new Map([...teamVariants].map(([k, v]) => [k, pickCanonical(v, properCase)]));
  const playerName = new Map(
    [...nameVariants].map(([k, v]) => {
      const best = pickCanonical(v, properCase);
      return [k, best === best.toLowerCase() ? titleCase(best) : best];
    }),
  );

  // Pass 2: row-level validation.
  const rows: CleanAppearance[] = [];
  let skipped = 0;
  let dmyDates = 0;
  for (const { r, line } of raw) {
    const flags: IssueCode[] = [];
    const warn = (code: IssueCode, message: string, severity: Severity = "warning") => {
      issues.push({ line, severity, code, message });
      if (!flags.includes(code)) flags.push(code);
    };

    const req = ["match_id", "age_group", "home_team", "away_team", "team", "player_name"] as const;
    const empty = req.filter((c) => !r[c]?.trim());
    if (empty.length) {
      issues.push({ line, severity: "error", code: "missing_required", message: `Row skipped: empty ${empty.join(", ")}` });
      skipped++;
      continue;
    }

    const date = parseDate(r.match_date ?? "");
    if (!date) {
      issues.push({ line, severity: "error", code: "bad_date", message: `Row skipped: unreadable date "${r.match_date}"` });
      skipped++;
      continue;
    }
    if (date.format === "dmy") dmyDates++;

    const homeKey = nameKey(r.home_team);
    const awayKey = nameKey(r.away_team);
    const tKey = nameKey(r.team);
    if (tKey !== homeKey && tKey !== awayKey) {
      issues.push({
        line,
        severity: "error",
        code: "team_not_in_fixture",
        message: `Row skipped: team "${r.team}" is neither ${r.home_team} nor ${r.away_team}`,
      });
      skipped++;
      continue;
    }

    const team = teamName.get(tKey)!;
    if (tidy(r.team) !== team) warn("team_normalised", `Team "${r.team}" read as "${team}"`, "info");
    const pKey = nameKey(r.player_name);
    const pName = playerName.get(pKey)!;
    if (r.player_name !== pName) warn("name_normalised", `Player "${r.player_name}" read as "${pName}"`, "info");

    const gf = parseCount(r.goals_for).value;
    const ga = parseCount(r.goals_against).value;
    const isHome = tKey === homeKey;

    const pos = r.position?.trim().toUpperCase();
    const position = (POSITIONS as readonly string[]).includes(pos) ? (pos as Position) : null;
    if (pos && !position) warn("invalid_value", `Unknown position "${r.position}"`);

    const mins = parseCount(r.minutes_played);
    let minutes = mins.value;
    if (minutes !== null && minutes > MAX_MINUTES) {
      warn("invalid_value", `minutes_played ${minutes} is above ${MAX_MINUTES}; treated as missing`);
      minutes = null;
    } else if (mins.problem) {
      warn("minutes_missing", `minutes_played is ${mins.problem}; appearance kept but excluded from the rating`);
    }

    const stats = {} as Stats;
    for (const c of STAT_COLUMNS) {
      const v = parseCount(r[c]);
      stats[c] = v.value;
      if (v.problem === "missing") warn("missing_value", `${c} is blank; left empty (not zero)`);
      if (v.problem === "invalid") warn("invalid_value", `${c} "${r[c]}" is not a count; left empty`);
    }

    const gt = (a: number | null, b: number | null) => a !== null && b !== null && a > b;
    if (gt(stats.passes_completed, stats.passes_attempted))
      warn("completed_gt_attempted", `passes_completed ${stats.passes_completed} > passes_attempted ${stats.passes_attempted}`);
    if (gt(stats.dribbles_completed, stats.dribbles_attempted))
      warn("completed_gt_attempted", `dribbles_completed ${stats.dribbles_completed} > dribbles_attempted ${stats.dribbles_attempted}`);
    if (gt(stats.shots_on_target, stats.shots))
      warn("on_target_gt_shots", `shots_on_target ${stats.shots_on_target} > shots ${stats.shots}`);
    if (gt(stats.goals, stats.shots_on_target))
      warn("goals_gt_on_target", `goals ${stats.goals} > shots_on_target ${stats.shots_on_target}`);
    if (gt(stats.progressive_passes, stats.passes_completed))
      warn("progressive_gt_completed", `progressive_passes ${stats.progressive_passes} > passes_completed ${stats.passes_completed}`);
    if (minutes === 0 && (stats.touches ?? 0) > 0)
      warn("zero_minutes_with_actions", `0 minutes but ${stats.touches} touches; excluded from the rating`);

    rows.push({
      line,
      matchId: r.match_id.trim(),
      matchDate: date.iso,
      competition: tidy(r.competition ?? ""),
      ageGroup: r.age_group.trim().toUpperCase(),
      homeTeam: teamName.get(homeKey)!,
      awayTeam: teamName.get(awayKey)!,
      homeGoals: (isHome ? gf : ga) ?? 0,
      awayGoals: (isHome ? ga : gf) ?? 0,
      team,
      teamKey: tKey,
      playerName: pName,
      playerKey: pKey,
      position,
      positionInferred: false,
      minutes,
      stats,
      flags,
    });
  }

  if (dmyDates) {
    issues.push({
      line: null,
      severity: "warning",
      code: "ambiguous_date_format",
      message: `${dmyDates} rows use dd/mm/yyyy instead of ISO. Read day-first; this fits the weekly fixture sequence (e.g. 05/04 sits between 29 Mar and 12 Apr).`,
    });
  }

  const deduped = dedupe(rows, issues);
  inferPositions(deduped, issues);
  checkMatches(deduped, issues);
  checkSharedNames(deduped, issues);

  return {
    rows: deduped,
    issues,
    totalRows: raw.length,
    skippedRows: skipped + (rows.length - deduped.length),
  };
}

function dedupe(rows: CleanAppearance[], issues: Issue[]): CleanAppearance[] {
  const byKey = new Map<string, CleanAppearance>();
  for (const row of rows) {
    const key = `${row.matchId}|${row.playerKey}|${row.teamKey}`;
    const prev = byKey.get(key);
    if (prev) {
      const same =
        prev.minutes === row.minutes &&
        prev.position === row.position &&
        STAT_COLUMNS.every((c) => prev.stats[c] === row.stats[c]);
      issues.push({
        line: row.line,
        severity: "warning",
        code: same ? "exact_duplicate" : "conflicting_duplicate",
        message: same
          ? `Exact duplicate of line ${prev.line} (${row.playerName}, ${row.matchId}); dropped`
          : `Conflicts with line ${prev.line} for ${row.playerName} in ${row.matchId}; the later line wins`,
      });
    }
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.line - b.line);
}

function inferPositions(rows: CleanAppearance[], issues: Issue[]) {
  const known = new Map<string, Position[]>();
  for (const r of rows) {
    if (!r.position) continue;
    const k = `${r.playerKey}|${r.ageGroup}|${r.teamKey}`;
    known.set(k, [...(known.get(k) ?? []), r.position]);
  }
  for (const r of rows) {
    if (r.position) continue;
    const seen = known.get(`${r.playerKey}|${r.ageGroup}|${r.teamKey}`);
    if (seen?.length) {
      r.position = pickCanonical(seen) as Position;
      r.positionInferred = true;
      r.flags.push("position_inferred");
      issues.push({
        line: r.line,
        severity: "warning",
        code: "position_inferred",
        message: `Position blank for ${r.playerName} in ${r.matchId}; used ${r.position} from his other matches`,
      });
    } else {
      r.flags.push("position_missing");
      issues.push({
        line: r.line,
        severity: "warning",
        code: "position_missing",
        message: `Position blank for ${r.playerName} in ${r.matchId} and no other match to infer it from`,
      });
    }
  }
}

function checkMatches(rows: CleanAppearance[], issues: Issue[]) {
  const byMatch = Map.groupBy(rows, (r) => r.matchId);
  for (const [matchId, list] of byMatch) {
    const first = list[0];
    const fields = ["matchDate", "competition", "ageGroup", "homeTeam", "awayTeam", "homeGoals", "awayGoals"] as const;
    for (const f of fields) {
      const values = new Set(list.map((r) => r[f]));
      if (values.size > 1) {
        issues.push({
          line: null,
          severity: "warning",
          code: "match_inconsistent",
          message: `${matchId}: rows disagree on ${f} (${[...values].join(" / ")}); using the first row's value`,
        });
        for (const r of list) (r[f] as unknown) = first[f];
      }
    }
    for (const side of ["home", "away"] as const) {
      const teamKey = nameKey(side === "home" ? first.homeTeam : first.awayTeam);
      const scored = list
        .filter((r) => r.teamKey === teamKey)
        .reduce((s, r) => s + (r.stats.goals ?? 0), 0);
      const official = side === "home" ? first.homeGoals : first.awayGoals;
      if (scored > official) {
        issues.push({
          line: null,
          severity: "warning",
          code: "goals_sum_mismatch",
          message: `${matchId}: ${side} players are credited with ${scored} goals but the score says ${official}`,
        });
      }
    }
  }
}

function checkSharedNames(rows: CleanAppearance[], issues: Issue[]) {
  const squads = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = squads.get(r.playerKey) ?? new Set<string>();
    s.add(`${r.team} ${r.ageGroup}`);
    squads.set(r.playerKey, s);
  }
  for (const [key, s] of squads) {
    if (s.size > 1) {
      const name = rows.find((r) => r.playerKey === key)!.playerName;
      issues.push({
        line: null,
        severity: "info",
        code: "same_name_multiple_squads",
        message: `"${name}" appears for ${[...s].join(" and ")}; treated as different players (no player ID in the export)`,
      });
    }
  }
}
