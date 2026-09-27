import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { POSITION_LABEL, STAT_COLUMNS, STAT_LABEL } from "@/lib/columns";
import { getPlayer } from "@/lib/db/queries";
import type { Component } from "@/lib/rating/compute";
import { LOW_SAMPLE_MINUTES, MIN_MATCH_MINUTES, SHRINK_MINUTES } from "@/lib/rating/compute";
import { ordinal, pctTone } from "@/components/percentile";

const FLAG_LABEL: Record<string, string> = {
  position_inferred: "position filled in",
  position_missing: "no position",
  minutes_missing: "minutes missing",
  missing_value: "blank stat",
  invalid_value: "invalid stat",
  zero_minutes_with_actions: "0 min but touches",
  completed_gt_attempted: "completed > attempted",
  goals_gt_on_target: "goals > on target",
  on_target_gt_shots: "on target > shots",
  progressive_gt_completed: "progressive > completed",
  name_normalised: "name cleaned",
  team_normalised: "team cleaned",
};
// Cosmetic clean-ups are not worth a badge next to the match.
const HIDDEN_FLAGS = new Set(["name_normalised", "team_normalised"]);

async function load(props: PageProps<"/players/[id]">) {
  const { id } = await props.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const player = await getPlayer(n);
  if (!player) notFound();
  return player;
}

export async function generateMetadata(props: PageProps<"/players/[id]">): Promise<Metadata> {
  const p = await load(props);
  return { title: p.name };
}

function showFeature(c: Component): string {
  const pct = c.feature.endsWith("_pct") || c.feature === "loss_rate";
  const f = (v: number) => (pct ? `${(v * 100).toFixed(0)}%` : v.toFixed(2));
  const shrunk = f(c.raw) === f(c.value) ? f(c.value) : `${f(c.raw)} → ${f(c.value)}`;
  return `${shrunk} vs ${f(c.peerMean)}`;
}

function fmt(v: number, digits = 2) {
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

export default async function PlayerPage(props: PageProps<"/players/[id]">) {
  const p = await load(props);
  const r = p.rating;
  const scoreByMatch = new Map(r?.matchScores.map((m) => [m.matchId, m.score]) ?? []);
  const components = [...(r?.components ?? [])].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const maxContribution = Math.max(0.05, ...components.map((c) => Math.abs(c.contribution)));
  const ratedMinutes = p.appearances.reduce((s, a) => s + (a.minutes ?? 0), 0);

  return (
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-text">
          ← Players
        </Link>
        <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{p.name}</h1>
            <p className="mt-1.5 text-sm text-muted">
              {p.team} · {p.ageGroup}
              {r && <> · {POSITION_LABEL[r.position]}</>} · {p.appearances.length} matches · {ratedMinutes} min
            </p>
          </div>
          {r ? (
            <div className="sm:text-right">
              <div className="text-5xl font-semibold tracking-tight tabular" style={{ color: pctTone(r.percentile) }}>
                {ordinal(r.percentile)}
              </div>
              <div className="mt-1 text-sm text-muted">
                percentile in {p.ageGroup} · #{r.rank} of {r.ageGroupSize}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted">Not rated: no appearance with recorded minutes.</div>
          )}
        </div>
      </div>

      {r && (
        <section>
          <h2 className="text-sm font-medium text-muted">How the rating is built</h2>
          <div className="mt-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
            <p className="text-sm leading-relaxed text-muted">
              Compared with {r.peerCount} {r.position}s{" "}
              {r.peerGroup.startsWith("ALL|") ? "across both age groups (too few in one)" : `in ${p.ageGroup}`}. Each
              measure is first pulled toward the group average, harder for rare, noisy stats like goals. Each bar is how
              far above or below the group he then is, times the weight the role gives it. They add up
              to a raw score of <span className="text-text tabular">{fmt(r.rawScore)}</span>. With {r.minutes} minutes the
              rating keeps <span className="text-text tabular">{Math.round(r.reliability * 100)}%</span> of that and
              pulls the rest toward average (half-trust point: {SHRINK_MINUTES} min), giving{" "}
              <span className="text-text tabular">{fmt(r.score)}</span>, which is then ranked against everyone in{" "}
              {p.ageGroup}.
            </p>
            {r.position === "GK" && (
              <p className="mt-3 rounded-lg border border-line px-3 py-2 text-xs text-mid">
                Goalkeeper ratings are weak: the export has no saves or shots faced, so this is mostly team goals
                conceded and distribution.
              </p>
            )}
            {r.minutes < LOW_SAMPLE_MINUTES && (
              <p className="mt-3 rounded-lg border border-line px-3 py-2 text-xs text-mid">
                Under {LOW_SAMPLE_MINUTES} minutes played. Treat this rating as close to &ldquo;unknown&rdquo;.
              </p>
            )}
            <ul className="mt-5 space-y-2.5">
              {components.map((c) => {
                const width = (Math.abs(c.contribution) / maxContribution) * 50;
                const good = c.contribution >= 0;
                return (
                  <li key={c.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{c.label}</div>
                      <div className="text-xs text-faint tabular">
                        {showFeature(c)}
                        {c.weight < 0 && " · lower is better"}
                      </div>
                    </div>
                    <div className="relative h-5">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                      <div
                        className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm"
                        style={{
                          width: `${width}%`,
                          left: good ? "50%" : `${50 - width}%`,
                          background: good ? "var(--good)" : "var(--bad)",
                          opacity: 0.85,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-faint">
              Left of the line pulls the rating down, right pushes it up. Figures: his raw number → his estimate
              after shrinking, vs the minutes-weighted group average.
            </p>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-muted">Matches behind it</h2>
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
          {p.appearances.map((a) => {
            const score = scoreByMatch.get(a.matchId);
            const result = a.goalsFor > a.goalsAgainst ? "W" : a.goalsFor < a.goalsAgainst ? "L" : "D";
            const flags = a.flags.filter((f) => !HIDDEN_FLAGS.has(f));
            return (
              <li key={a.matchId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">
                    {a.venue === "home" ? "vs" : "@"} {a.opponent}{" "}
                    <span className="text-muted tabular">
                      {result} {a.goalsFor}–{a.goalsAgainst}
                    </span>
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(a.matchDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}{" "}
                    · {a.matchId} · {a.position ?? "–"}
                    {a.positionInferred && "*"} · {a.minutes ?? "?"} min · {a.stats.goals ?? 0}G {a.stats.assists ?? 0}A
                  </div>
                  {flags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <span key={f} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-mid">
                          {FLAG_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right text-xs text-muted">
                  {score === null || score === undefined ? (
                    <span className="text-faint">
                      {a.minutes === null ? "not rated" : `under ${MIN_MATCH_MINUTES} min`}
                    </span>
                  ) : (
                    <>
                      match score{" "}
                      <span className="text-sm font-medium tabular" style={{ color: score >= 0 ? "var(--good)" : "var(--bad)" }}>
                        {score >= 0 ? "+" : ""}
                        {score.toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-faint">
          Match score is the same formula on one match alone, before the minutes adjustment. The rating pools minutes
          across matches rather than averaging these. * position was blank in the file and filled in from his other
          matches.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Raw numbers</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[480px] text-sm tabular">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="sticky left-0 bg-surface px-4 py-2.5 text-left font-medium">Stat</th>
                {p.appearances.map((a) => (
                  <th key={a.matchId} className="px-3 py-2.5 text-right font-medium">
                    {a.matchId}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium text-text">Total</th>
                <th className="px-4 py-2.5 text-right font-medium">Per 90</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="sticky left-0 bg-surface px-4 py-2 text-muted">Minutes</td>
                {p.appearances.map((a) => (
                  <td key={a.matchId} className="px-3 py-2 text-right">
                    {a.minutes ?? <span className="text-bad">–</span>}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-medium">{ratedMinutes}</td>
                <td className="px-4 py-2 text-right text-faint">–</td>
              </tr>
              {STAT_COLUMNS.map((c) => {
                const vals = p.appearances.map((a) => a.stats[c]);
                const total = vals.reduce<number>((s, v) => s + (v ?? 0), 0);
                const mins = p.appearances.reduce((s, a) => s + (a.stats[c] !== null && a.minutes ? a.minutes : 0), 0);
                return (
                  <tr key={c}>
                    <td className="sticky left-0 bg-surface px-4 py-2 text-muted">{STAT_LABEL[c]}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right">
                        {v ?? <span className="text-bad" title="Blank in the file">–</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-medium">{total}</td>
                    <td className="px-4 py-2 text-right text-muted">{mins ? ((total / mins) * 90).toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-faint">A dash means the value was blank in the file. It is not counted as zero.</p>
      </section>
    </div>
  );
}
