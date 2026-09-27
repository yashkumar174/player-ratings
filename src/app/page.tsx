import Link from "next/link";
import { Suspense } from "react";
import { POSITIONS, POSITION_LABEL } from "@/lib/columns";
import { getOverview, listPlayers, SORTS, type SortKey } from "@/lib/db/queries";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { PercentileBar } from "@/components/percentile";
import { SearchBox } from "@/components/search-box";

type Search = { q?: string; age?: string; pos?: string; sort?: string; dir?: string };

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "rating:desc", label: "Rating: high to low" },
  { value: "rating:asc", label: "Rating: low to high" },
  { value: "name:asc", label: "Name: A to Z" },
  { value: "minutes:desc", label: "Minutes: most" },
  { value: "team:asc", label: "Team" },
];

const defaultDir = (key: SortKey) => (key === "name" || key === "team" ? "asc" : "desc");

export default async function PlayersPage(props: PageProps<"/">) {
  const sp = (await props.searchParams) as Search;
  // The select sends "rating:asc"; header links send sort + dir separately.
  const [sortRaw, dirFromSort] = (sp.sort ?? "rating").split(":");
  const sort: SortKey = sortRaw in SORTS ? (sortRaw as SortKey) : "rating";
  const dirRaw = sp.dir ?? dirFromSort;
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir(sort);
  const position = POSITIONS.find((p) => p === sp.pos);

  const [overview, players] = await Promise.all([
    getOverview(),
    listPlayers({ q: sp.q, ageGroup: sp.age, position, sort, dir }),
  ]);

  if (!overview.players) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">No data yet</h1>
        <p className="mt-2 text-sm text-muted">Upload a match events CSV to rate players.</p>
        <Link href="/upload" className="mt-6 inline-block rounded-lg bg-text px-4 py-2 text-sm font-medium text-bg">
          Upload CSV
        </Link>
      </div>
    );
  }

  const href = (patch: Partial<Search>) => {
    const merged = { ...sp, ...patch };
    const next = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]);
    const s = next.toString();
    return s ? `/?${s}` : "/";
  };
  const sortHref = (key: SortKey) =>
    href({ sort: key, dir: sort === key ? (dir === "asc" ? "desc" : "asc") : defaultDir(key) });
  const arrow = (key: SortKey) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");
  const currentSort = `${sort}:${dir}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
      <p className="mt-1 text-sm text-muted">
        {overview.players} players · {overview.matches} matches · rating is a percentile within the player&apos;s age group
      </p>

      <form action="/" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Suspense>
          <SearchBox />
        </Suspense>
        {sp.age && <input type="hidden" name="age" value={sp.age} />}
        <div className="flex gap-2">
          <AutoSubmitSelect
            name="pos"
            defaultValue={position ?? ""}
            aria-label="Position"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm sm:flex-none"
          >
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {POSITION_LABEL[p]}
              </option>
            ))}
          </AutoSubmitSelect>
          <AutoSubmitSelect
            name="sort"
            defaultValue={SORT_OPTIONS.some((o) => o.value === currentSort) ? currentSort : "rating:desc"}
            aria-label="Sort"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm sm:flex-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </AutoSubmitSelect>
          <noscript>
            <button className="h-10 rounded-lg border border-line bg-surface px-3 text-sm">Apply</button>
          </noscript>
        </div>
      </form>

      <div className="mt-3 flex gap-1.5 text-sm">
        {["", ...overview.ageGroups].map((g) => (
          <Link
            key={g || "all"}
            href={href({ age: g })}
            className={`rounded-full border px-3 py-1 ${
              (sp.age ?? "") === g ? "border-text bg-text text-bg" : "border-line text-muted hover:text-text"
            }`}
          >
            {g || "All ages"}
          </Link>
        ))}
      </div>

      {players.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted">No players match.</p>
      ) : (
        <>
          {/* Phone: cards */}
          <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface md:hidden">
            {players.map((p) => (
              <li key={p.id}>
                <Link href={`/players/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted">
                      {p.position ?? "–"} · {p.ageGroup} · {p.minutes ?? 0} min
                      {p.reliability !== null && p.reliability < 0.25 && <span className="text-mid"> · low sample</span>} ·{" "}
                      {p.team}
                    </div>
                  </div>
                  <PercentileBar value={p.percentile} reliability={p.reliability} />
                </Link>
              </li>
            ))}
          </ul>

          {/* Laptop: table */}
          <div className="mt-5 hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">
                    <Link href={sortHref("name")}>Player{arrow("name")}</Link>
                  </th>
                  <th className="px-4 py-2.5 font-medium">
                    <Link href={sortHref("team")}>Team{arrow("team")}</Link>
                  </th>
                  <th className="px-4 py-2.5 font-medium">Age</th>
                  <th className="px-4 py-2.5 font-medium">Pos</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    <Link href={sortHref("minutes")}>Min / apps{arrow("minutes")}</Link>
                  </th>
                  <th className="px-4 py-2.5 font-medium">
                    <Link href={sortHref("rating")}>Rating{arrow("rating")}</Link>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {players.map((p) => (
                  <tr key={p.id} className="transition hover:bg-bg/60">
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/players/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{p.team}</td>
                    <td className="px-4 py-2.5 text-muted">{p.ageGroup}</td>
                    <td className="px-4 py-2.5 text-muted">{p.position ?? "–"}</td>
                    <td className="px-4 py-2.5 text-right text-muted tabular">
                      {p.minutes ?? 0} <span className="text-faint">/ {p.apps ?? 0}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <PercentileBar value={p.percentile} reliability={p.reliability} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-faint">{players.length} shown</p>
        </>
      )}
    </div>
  );
}
