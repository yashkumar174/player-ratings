// Single source of truth for the CSV shape. The schema, the parser and the
// UI all read from these lists so a new stat column is a one-line change.

export const POSITIONS = ["GK", "CB", "FB", "CM", "W", "ST"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABEL: Record<Position, string> = {
  GK: "Goalkeeper",
  CB: "Centre-back",
  FB: "Full-back",
  CM: "Central midfield",
  W: "Winger",
  ST: "Striker",
};

/** Per-match counting stats, stored as nullable non-negative integers. */
export const STAT_COLUMNS = [
  "touches",
  "passes_attempted",
  "passes_completed",
  "progressive_passes",
  "crosses",
  "dribbles_attempted",
  "dribbles_completed",
  "shots",
  "shots_on_target",
  "goals",
  "assists",
  "duels_won",
  "duels_lost",
  "aerial_duels_won",
  "aerial_duels_lost",
  "tackles",
  "interceptions",
  "recoveries",
  "clearances",
  "fouls_committed",
  "fouls_won",
  "yellow_cards",
  "red_cards",
  "possession_lost",
] as const;
export type StatColumn = (typeof STAT_COLUMNS)[number];
export type Stats = Record<StatColumn, number | null>;

export const STAT_LABEL: Record<StatColumn, string> = {
  touches: "Touches",
  passes_attempted: "Passes att.",
  passes_completed: "Passes cmp.",
  progressive_passes: "Progressive passes",
  crosses: "Crosses",
  dribbles_attempted: "Dribbles att.",
  dribbles_completed: "Dribbles won",
  shots: "Shots",
  shots_on_target: "On target",
  goals: "Goals",
  assists: "Assists",
  duels_won: "Duels won",
  duels_lost: "Duels lost",
  aerial_duels_won: "Aerials won",
  aerial_duels_lost: "Aerials lost",
  tackles: "Tackles",
  interceptions: "Interceptions",
  recoveries: "Recoveries",
  clearances: "Clearances",
  fouls_committed: "Fouls committed",
  fouls_won: "Fouls won",
  yellow_cards: "Yellow cards",
  red_cards: "Red cards",
  possession_lost: "Possession lost",
};

export const REQUIRED_HEADERS = [
  "match_id",
  "match_date",
  "competition",
  "age_group",
  "home_team",
  "away_team",
  "team",
  "opponent",
  "venue",
  "goals_for",
  "goals_against",
  "player_name",
  "position",
  "minutes_played",
  ...STAT_COLUMNS,
] as const;
