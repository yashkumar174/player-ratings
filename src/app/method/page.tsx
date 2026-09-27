import type { Metadata } from "next";
import { POSITIONS, POSITION_LABEL } from "@/lib/columns";
import { FEATURES, WEIGHTS, type FeatureKey } from "@/lib/rating/features";
import { MIN_PEERS, SHRINK_MINUTES } from "@/lib/rating/compute";

export const metadata: Metadata = { title: "Method" };

const COMPARISON = [
  { name: "A. Box score", what: "Fixed points per action per 90, same for everyone", top: "all five are 18–25 min cameos", tails: "28 / 53", rho: "0.34", verdict: "Rewards tiny samples. No striker-vs-keeper sense." },
  { name: "B. Position z-score", what: "Compare to same-position peers, role weights", top: "mixed positions, but all 18–66 min", tails: "24 / 53", rho: "0.23", verdict: "Fair across roles, still fooled by small samples." },
  { name: "C. B + minutes shrinkage", what: "B, pulled toward average by minutes played", top: "four 245–270 min regulars, one 58 min", tails: "6 / 53", rho: "0.18", verdict: "Chosen." },
  { name: "D. Position-blind + shrinkage", what: "One weight set for all outfielders", top: "20 of 46 CMs in top 20%, 0 of 22 STs", tails: "1 / 53", rho: "0.34", verdict: "Stable because it measures role, not quality." },
];

export default function MethodPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-10 text-[15px] leading-relaxed">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">How the rating works</h1>
        <p className="mt-2 text-muted">
          And, more usefully, where it breaks. The short version: it is a fair way to rank players against their
          position peers, built on too little data to be trusted for any single player.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. Per 90, per role</h2>
        <p className="text-muted">
          Counts are converted to per-90-minute rates, and success ratios (pass %, duel %, aerial %, possession lost per
          touch) are pulled toward the group average until there are enough attempts to trust them. Each player is then
          compared with players in his main position (most minutes) and age group, as a z-score: how many standard
          deviations above or below the minutes-weighted group average. Groups under {MIN_PEERS} players (keepers:
          six per age group) pool both age groups. z-scores are clipped at ±3 so one freak match can&apos;t carry a
          player.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">2. Weighted by what the role asks</h2>
        <p className="text-muted">
          Each position has its own weights. They are my judgement, not fitted to anything, because there is no outcome
          in the file to fit them to.
        </p>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Measure</th>
                {POSITIONS.map((p) => (
                  <th key={p} className="px-2 py-2 text-right font-medium" title={POSITION_LABEL[p]}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {(Object.keys(FEATURES) as FeatureKey[]).map((f) => (
                <tr key={f}>
                  <td className="px-3 py-1.5 text-muted">{FEATURES[f].label}</td>
                  {POSITIONS.map((p) => {
                    const w = WEIGHTS[p][f];
                    return (
                      <td key={p} className="px-2 py-1.5 text-right" style={{ color: w ? (w > 0 ? "var(--good)" : "var(--bad)") : "var(--faint)" }}>
                        {w ? `${w > 0 ? "" : "−"}${Math.round(Math.abs(w) * 100)}` : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">3. Discounted for small samples</h2>
        <p className="text-muted">
          The weighted sum is multiplied by <code className="text-text">minutes / (minutes + {SHRINK_MINUTES})</code>. A
          player with {SHRINK_MINUTES} minutes keeps half his distance from average; one with 20 minutes keeps 7%. The{" "}
          {SHRINK_MINUTES} is not arbitrary: rating each player on half his matches and comparing with the other half
          gave a rank agreement of 0.23 over about 84 minutes, which implies a half-trust point near 285 minutes.
          Three full matches is the round number next to it.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">4. Percentile within age group</h2>
        <p className="text-muted">
          Final scores are ranked within U15 or U17: 100 is the best, 0 the worst, ties share. The percentile says
          nothing about the gap: 60th and 70th may be almost identical players.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What else I tried</h2>
        <div className="space-y-2">
          {COMPARISON.map((c) => (
            <div key={c.name} className="rounded-xl border border-line bg-surface p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className={c.verdict === "Chosen." ? "text-good" : "text-muted"}>{c.verdict}</span>
              </div>
              <p className="mt-1 text-muted">{c.what}</p>
              <p className="mt-2 text-xs text-faint tabular">
                Top 5: {c.top} · sub-90-min players in top/bottom decile: {c.tails} · split-half ρ: {c.rho}
              </p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Split-half agreement looks like it should pick the winner, but it rewards anything stable, and role is very
          stable: a centre-mid touches the ball a lot every week. A and D score well on it by ranking roles. C has the
          lowest agreement of all, which is the honest headline: on 2–3 matches per player, most of the difference
          between two players is noise.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What is wrong with it</h2>
        <ul className="list-disc space-y-2 pl-5 text-muted">
          <li>
            <span className="text-text">Too little data.</span> 183 players, mostly 1–3 matches. Two halves of the same
            player&apos;s games agree at ρ≈0.2. The percentile is a ranking of short samples, not of players.
          </li>
          <li>
            <span className="text-text">Keepers are barely rated.</span> No saves or shots faced, so 40% of a keeper&apos;s
            rating is his team&apos;s goals conceded. The U15 keeper at the top of the table is there mostly because his
            defence is good.
          </li>
          <li>
            <span className="text-text">No opponent strength.</span> Real Madrid U15 beat Getafe 9–0. Everyone on the
            pitch that day gets a flattering or brutal per-90.
          </li>
          <li>
            <span className="text-text">Volume, not quality.</span> Crosses and progressive passes are counts with no
            completion or danger measure; duels won says nothing about where on the pitch.
          </li>
          <li>
            <span className="text-text">Weights are opinions.</span> Nothing validates them. With outcomes (selection,
            coach grades, next-season minutes) they could be fitted instead.
          </li>
          <li>
            <span className="text-text">Identity is a name.</span> There is no player ID. Two &ldquo;Pablo Ruiz&rdquo;
            rows (Getafe U15, Girona U17) are kept as two players; a real transfer would wrongly split one.
          </li>
          <li>
            <span className="text-text">Cross-position percentiles.</span> A CB at the 80th and a ST at the 80th are each
            good relative to their role; the list mixes them as if the scales were the same.
          </li>
        </ul>
      </section>
    </article>
  );
}
