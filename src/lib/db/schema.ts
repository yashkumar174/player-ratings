import { POSITIONS, STAT_COLUMNS } from "@/lib/columns";

// Idempotent DDL, applied on first connection. Kept as plain SQL (no ORM) so
// the constraints are visible in one place.

const positionList = POSITIONS.map((p) => `'${p}'`).join(", ");
const statColumns = STAT_COLUMNS.map((c) => `  ${c} integer check (${c} >= 0)`).join(",\n");

export const SCHEMA_SQL = `
create table if not exists uploads (
  id integer generated always as identity primary key,
  filename text not null,
  file_sha256 text not null,
  uploaded_at timestamptz not null default now(),
  total_rows integer not null,
  accepted_rows integer not null,
  skipped_rows integer not null,
  issues jsonb not null default '[]'
);

create table if not exists teams (
  id integer generated always as identity primary key,
  name text not null,
  name_key text not null unique
);

create table if not exists matches (
  id text primary key,
  match_date date not null,
  competition text not null,
  age_group text not null,
  home_team_id integer not null references teams(id),
  away_team_id integer not null references teams(id),
  home_goals integer not null check (home_goals >= 0),
  away_goals integer not null check (away_goals >= 0),
  upload_id integer references uploads(id) on delete set null,
  check (home_team_id <> away_team_id)
);
create index if not exists matches_age_group_idx on matches (age_group, match_date);

create table if not exists players (
  id integer generated always as identity primary key,
  name text not null,
  name_key text not null,
  age_group text not null,
  team_id integer not null references teams(id),
  unique (name_key, age_group, team_id)
);
create index if not exists players_name_idx on players (name_key);

create table if not exists appearances (
  id integer generated always as identity primary key,
  match_id text not null references matches(id) on delete cascade,
  player_id integer not null references players(id) on delete cascade,
  team_id integer not null references teams(id),
  position text check (position in (${positionList})),
  position_inferred boolean not null default false,
  minutes_played integer check (minutes_played between 0 and 130),
${statColumns},
  flags jsonb not null default '[]',
  source_line integer,
  upload_id integer references uploads(id) on delete set null,
  unique (match_id, player_id)
);
create index if not exists appearances_player_idx on appearances (player_id);

create table if not exists player_ratings (
  player_id integer primary key references players(id) on delete cascade,
  age_group text not null,
  position text not null check (position in (${positionList})),
  peer_group text not null,
  peer_count integer not null,
  minutes integer not null check (minutes > 0),
  apps integer not null check (apps > 0),
  raw_score double precision not null,
  reliability double precision not null check (reliability > 0 and reliability <= 1),
  score double precision not null,
  percentile double precision not null check (percentile between 0 and 100),
  components jsonb not null,
  match_scores jsonb not null,
  model_version text not null,
  computed_at timestamptz not null default now()
);
create index if not exists player_ratings_rank_idx on player_ratings (age_group, percentile desc);

-- Repair for rows written before the double-encoding fix (see ingest.ts):
-- a JSON value stored as a JSON string is unwrapped. No-op once clean.
update uploads set issues = (issues #>> '{}')::jsonb where jsonb_typeof(issues) = 'string';
update appearances set flags = (flags #>> '{}')::jsonb where jsonb_typeof(flags) = 'string';
update player_ratings set components = (components #>> '{}')::jsonb, match_scores = (match_scores #>> '{}')::jsonb
  where jsonb_typeof(components) = 'string' or jsonb_typeof(match_scores) = 'string';
`;
