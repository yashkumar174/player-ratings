import "server-only";
import { STAT_COLUMNS, type Position, type Stats } from "@/lib/columns";
import { nameKey, type Issue } from "@/lib/ingest/clean";
import type { Component, MatchScore } from "@/lib/rating/compute";
import { getDb } from "./client";

// Read side. Every function returns plain typed objects; pages never see SQL.

export const SORTS = {
  rating: "r.percentile",
  name: "p.name",
  minutes: "r.minutes",
  team: "t.name",
} as const;
export type SortKey = keyof typeof SORTS;

export interface PlayerListItem {
  id: number;
  name: string;
  team: string;
  ageGroup: string;
  position: Position | null;
  minutes: number | null;
  apps: number | null;
  percentile: number | null;
  reliability: number | null;
}

export interface ListFilters {
  q?: string;
  ageGroup?: string;
  position?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
}

export async function listPlayers(f: ListFilters): Promise<PlayerListItem[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q?.trim()) {
    params.push(`%${nameKey(f.q)}%`);
    where.push(`p.name_key like $${params.length}`);
  }
  if (f.ageGroup) {
    params.push(f.ageGroup);
    where.push(`p.age_group = $${params.length}`);
  }
  if (f.position) {
    params.push(f.position);
    where.push(`r.position = $${params.length}`);
  }
  const sort = SORTS[f.sort ?? "rating"] ?? SORTS.rating;
  const dir = f.dir === "asc" ? "asc" : "desc";
  return db.query<PlayerListItem>(
    `select p.id, p.name, t.name as team, p.age_group as "ageGroup", r.position, r.minutes, r.apps,
            r.percentile, r.reliability
     from players p
     join teams t on t.id = p.team_id
     left join player_ratings r on r.player_id = p.id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by ${sort} ${dir} nulls last, p.name asc`,
    params,
  );
}

export interface PlayerDetail {
  id: number;
  name: string;
  team: string;
  ageGroup: string;
  rating: {
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
    modelVersion: string;
    ageGroupSize: number;
    rank: number;
  } | null;
  appearances: AppearanceRow[];
}

export interface AppearanceRow {
  matchId: string;
  matchDate: string;
  competition: string;
  opponent: string;
  venue: "home" | "away";
  goalsFor: number;
  goalsAgainst: number;
  position: Position | null;
  positionInferred: boolean;
  minutes: number | null;
  stats: Stats;
  flags: string[];
}

export async function getPlayer(id: number): Promise<PlayerDetail | null> {
  const db = await getDb();
  const [p] = await db.query<{ id: number; name: string; team: string; age_group: string }>(
    `select p.id, p.name, t.name as team, p.age_group from players p join teams t on t.id = p.team_id where p.id = $1`,
    [id],
  );
  if (!p) return null;

  const [r] = await db.query<{
    position: Position; peer_group: string; peer_count: number; minutes: number; apps: number;
    raw_score: number; reliability: number; score: number; percentile: number;
    components: Component[]; match_scores: MatchScore[];
    model_version: string; age_group_size: number; rank: number;
  }>(
    `select r.*,
            (select count(*)::int from player_ratings x where x.age_group = r.age_group) as age_group_size,
            (select count(*)::int + 1 from player_ratings x where x.age_group = r.age_group and x.score > r.score) as rank
     from player_ratings r where r.player_id = $1`,
    [id],
  );

  const apps = await db.query<Record<string, unknown>>(
    `select a.*, m.match_date::text as match_date, m.competition,
            case when a.team_id = m.home_team_id then 'home' else 'away' end as venue,
            case when a.team_id = m.home_team_id then ta.name else th.name end as opponent,
            case when a.team_id = m.home_team_id then m.home_goals else m.away_goals end as goals_for,
            case when a.team_id = m.home_team_id then m.away_goals else m.home_goals end as goals_against
     from appearances a
     join matches m on m.id = a.match_id
     join teams th on th.id = m.home_team_id
     join teams ta on ta.id = m.away_team_id
     where a.player_id = $1
     order by m.match_date asc`,
    [id],
  );

  return {
    id: p.id,
    name: p.name,
    team: p.team,
    ageGroup: p.age_group,
    rating: r
      ? {
          position: r.position,
          peerGroup: r.peer_group,
          peerCount: r.peer_count,
          minutes: r.minutes,
          apps: r.apps,
          rawScore: r.raw_score,
          reliability: r.reliability,
          score: r.score,
          percentile: r.percentile,
          components: r.components,
          matchScores: r.match_scores,
          modelVersion: r.model_version,
          ageGroupSize: r.age_group_size,
          rank: r.rank,
        }
      : null,
    appearances: apps.map((a) => ({
      matchId: a.match_id as string,
      matchDate: a.match_date as string,
      competition: a.competition as string,
      opponent: a.opponent as string,
      venue: a.venue as "home" | "away",
      goalsFor: a.goals_for as number,
      goalsAgainst: a.goals_against as number,
      position: a.position as Position | null,
      positionInferred: a.position_inferred as boolean,
      minutes: a.minutes_played as number | null,
      stats: Object.fromEntries(STAT_COLUMNS.map((c) => [c, a[c] as number | null])) as Stats,
      flags: a.flags as string[],
    })),
  };
}

export interface UploadSummary {
  id: number;
  filename: string;
  uploadedAt: string;
  totalRows: number;
  acceptedRows: number;
  skippedRows: number;
  issues: Issue[];
}

export async function listUploads(limit = 10): Promise<UploadSummary[]> {
  const db = await getDb();
  return db.query<UploadSummary>(
    `select id, filename, uploaded_at::text as "uploadedAt", total_rows as "totalRows",
            accepted_rows as "acceptedRows", skipped_rows as "skippedRows", issues
     from uploads order by id desc limit $1`,
    [limit],
  );
}

export async function getOverview(): Promise<{ players: number; matches: number; ageGroups: string[] }> {
  const db = await getDb();
  const [c] = await db.query<{ players: number; matches: number }>(
    `select (select count(*)::int from players) as players, (select count(*)::int from matches) as matches`,
  );
  const groups = await db.query<{ age_group: string }>(`select distinct age_group from players order by 1`);
  return { ...c, ageGroups: groups.map((g) => g.age_group) };
}
