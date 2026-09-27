import "server-only";
import { createHash } from "node:crypto";
import { STAT_COLUMNS, type Position, type Stats } from "@/lib/columns";
import { cleanCsv, nameKey, type CleanResult, type Issue } from "@/lib/ingest/clean";
import { computeRatings, MODEL_VERSION, type PlayerInput } from "@/lib/rating/compute";
import { getDb, type Db } from "./client";

export interface IngestReport {
  uploadId: number | null;
  filename: string;
  totalRows: number;
  acceptedRows: number;
  skippedRows: number;
  newAppearances: number;
  updatedAppearances: number;
  playersRated: number;
  issues: Issue[];
}

/** Multi-row INSERT with positional params, chunked under Postgres' 65k param limit. */
async function insertMany<T>(
  db: Db,
  table: string,
  columns: string[],
  rows: unknown[][],
  suffix: string,
  casts: Record<string, string> = {},
): Promise<T[]> {
  const out: T[] = [];
  const perChunk = Math.floor(60000 / columns.length);
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const params: unknown[] = [];
    const values = chunk.map(
      (row) =>
        `(${row
          .map((v, j) => {
            params.push(v);
            return `$${params.length}${casts[columns[j]] ?? ""}`;
          })
          .join(", ")})`,
    );
    out.push(...(await db.query<T>(`insert into ${table} (${columns.join(", ")}) values ${values.join(", ")} ${suffix}`, params)));
  }
  return out;
}

export async function ingestCsv(text: string, filename: string): Promise<IngestReport> {
  const cleaned: CleanResult = cleanCsv(text);
  const base = {
    filename,
    totalRows: cleaned.totalRows,
    acceptedRows: cleaned.rows.length,
    skippedRows: cleaned.skippedRows,
    issues: cleaned.issues,
  };
  if (!cleaned.rows.length) {
    return { ...base, uploadId: null, newAppearances: 0, updatedAppearances: 0, playersRated: 0 };
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [{ id: uploadId }] = await tx.query<{ id: number }>(
      `insert into uploads (filename, file_sha256, total_rows, accepted_rows, skipped_rows, issues)
       values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
      [
        filename,
        createHash("sha256").update(text).digest("hex"),
        cleaned.totalRows,
        cleaned.rows.length,
        cleaned.skippedRows,
        JSON.stringify(cleaned.issues),
      ],
    );

    // Teams, keyed on the normalised name so "atletico madrid" can't create a second club.
    const teamNames = new Map<string, string>();
    for (const r of cleaned.rows) {
      teamNames.set(r.teamKey, r.team);
      for (const t of [r.homeTeam, r.awayTeam]) teamNames.set(nameKey(t), t);
    }
    const teams = await insertMany<{ id: number; name_key: string }>(
      tx, "teams", ["name", "name_key"], [...teamNames].map(([k, name]) => [name, k]),
      "on conflict (name_key) do update set name = excluded.name returning id, name_key",
    );
    const teamId = new Map(teams.map((t) => [t.name_key, t.id]));

    // Matches: one row per fixture, later uploads overwrite.
    const matches = new Map(cleaned.rows.map((r) => [r.matchId, r]));
    await insertMany(
      tx, "matches",
      ["id", "match_date", "competition", "age_group", "home_team_id", "away_team_id", "home_goals", "away_goals", "upload_id"],
      [...matches.values()].map((m) => [
        m.matchId, m.matchDate, m.competition, m.ageGroup,
        teamId.get(nameKey(m.homeTeam)), teamId.get(nameKey(m.awayTeam)),
        m.homeGoals, m.awayGoals, uploadId,
      ]),
      `on conflict (id) do update set match_date = excluded.match_date, competition = excluded.competition,
         age_group = excluded.age_group, home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id,
         home_goals = excluded.home_goals, away_goals = excluded.away_goals, upload_id = excluded.upload_id`,
      { match_date: "::date" },
    );

    // Players: identity is (name, age group, club).
    const playerRows = new Map<string, unknown[]>();
    for (const r of cleaned.rows)
      playerRows.set(`${r.playerKey}|${r.ageGroup}|${r.teamKey}`, [r.playerName, r.playerKey, r.ageGroup, teamId.get(r.teamKey)]);
    const players = await insertMany<{ id: number; name_key: string; age_group: string; team_id: number }>(
      tx, "players", ["name", "name_key", "age_group", "team_id"], [...playerRows.values()],
      "on conflict (name_key, age_group, team_id) do update set name = excluded.name returning id, name_key, age_group, team_id",
    );
    const playerId = new Map(players.map((p) => [`${p.name_key}|${p.age_group}|${p.team_id}`, p.id]));

    const cols = ["match_id", "player_id", "team_id", "position", "position_inferred", "minutes_played", ...STAT_COLUMNS, "flags", "source_line", "upload_id"];
    const written = await insertMany<{ inserted: boolean }>(
      tx, "appearances", cols,
      cleaned.rows.map((r) => {
        const tId = teamId.get(r.teamKey);
        return [
          r.matchId, playerId.get(`${r.playerKey}|${r.ageGroup}|${tId}`), tId, r.position, r.positionInferred,
          r.minutes, ...STAT_COLUMNS.map((c) => r.stats[c]), JSON.stringify(r.flags), r.line, uploadId,
        ];
      }),
      `on conflict (match_id, player_id) do update set ${cols
        .filter((c) => c !== "match_id" && c !== "player_id")
        .map((c) => `${c} = excluded.${c}`)
        .join(", ")}
       returning (xmax = 0) as inserted`,
      { flags: "::jsonb" },
    );
    const inserted = written.filter((w) => w.inserted).length;

    const playersRated = await recomputeRatings(tx);
    return {
      ...base,
      uploadId,
      newAppearances: inserted,
      updatedAppearances: written.length - inserted,
      playersRated,
    };
  });
}

/**
 * Ratings are percentiles, so one new match moves everyone in the age group.
 * They are recomputed from every stored appearance, not just the new file.
 */
export async function recomputeRatings(db: Db): Promise<number> {
  const rows = await db.query<
    { player_id: number; age_group: string; match_id: string; match_date: string; position: Position | null;
      minutes_played: number | null; team_goals_against: number } & Stats
  >(`
    select a.*, p.age_group, m.match_date::text as match_date,
           case when a.team_id = m.home_team_id then m.away_goals else m.home_goals end as team_goals_against
    from appearances a
    join players p on p.id = a.player_id
    join matches m on m.id = a.match_id`);

  const inputs = new Map<number, PlayerInput>();
  for (const r of rows) {
    const input = inputs.get(r.player_id) ?? { playerId: r.player_id, ageGroup: r.age_group, appearances: [] };
    input.appearances.push({
      matchId: r.match_id,
      matchDate: r.match_date,
      minutes: r.minutes_played,
      position: r.position,
      stats: Object.fromEntries(STAT_COLUMNS.map((c) => [c, r[c]])) as Stats,
      teamGoalsAgainst: r.team_goals_against,
    });
    inputs.set(r.player_id, input);
  }

  const ratings = computeRatings([...inputs.values()]);
  await db.query("delete from player_ratings");
  await insertMany(
    db, "player_ratings",
    ["player_id", "age_group", "position", "peer_group", "peer_count", "minutes", "apps", "raw_score",
     "reliability", "score", "percentile", "components", "match_scores", "model_version"],
    ratings.map((r) => [
      r.playerId, r.ageGroup, r.position, r.peerGroup, r.peerCount, r.minutes, r.apps, r.rawScore,
      r.reliability, r.score, r.percentile, JSON.stringify(r.components), JSON.stringify(r.matchScores), MODEL_VERSION,
    ]),
    "",
    { components: "::jsonb", match_scores: "::jsonb" },
  );
  return ratings.length;
}
