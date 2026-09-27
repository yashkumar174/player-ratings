import type { Metadata } from "next";
import { POSITIONS, POSITION_LABEL } from "@/lib/columns";
import { FEATURES, WEIGHTS, type FeatureKey } from "@/lib/rating/features";
import { LOW_SAMPLE_MINUTES, MIN_PEERS, SHRINK_MINUTES } from "@/lib/rating/compute";

export const metadata: Metadata = { title: "Method" };

const COMPARISON = [
  { name: "A. Box score", what: "Fixed points per action per 90, same for everyone", top: "all five are 18–25 min cameos", tails: "28", rho: "0.34", verdict: "Rewards tiny samples." },
  { name: "B. Position z-score", what: "Compare to same-position peers, role weights", top: "mixed positions, but all 18–66 min", tails: "24", rho: "0.23", verdict: "Fair across roles, fooled by small samples." },
  { name: "C. B + minutes shrink (v1)", what: "B, pulled toward average by minutes (K=270)", top: "four regulars, one 58-min winger at 99th", tails: "6", rho: "0.18", verdict: "First version shipped." },
  { name: "D. Position-blind + shrink", what: "One weight set for all outfielders", top: "20 of 46 CMs in top 20%, 0 of 22 STs", tails: "1", rho: "0.35", verdict: "Stable because it measures role." },
  { name: "E. B + per-stat priors only", what: "Each stat shrunk by its own noise, no whole-score shrink", top: "58-min W and 58-min ST in the top 3", tails: "11", rho: "0.17", verdict: "Not enough on its own." },
  { name: "F. Per-stat priors + minutes shrink (v2)", what: "Both: each stat by its noise, then the composite by minutes (K=450)", top: "five regulars, 200–270 min", tails: "1", rho: "0.16", verdict: "Chosen." },
  { name: "G. F scaled by talent spread", what: "z against estimated true-talent SD instead of the estimates' SD", top: "regulars, but 2 of 22 STs in top 20%", tails: "2", rho: "0.10", verdict: "Textbook-cleaner, worse. Reverted." },
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
          Counts are converted to per-90-minute rates; success ratios are pass %, duel %, aerial %, and possession lost
          per touch. Each stat is then pulled toward the group average by an amount learned from the data: the spread
          between players is split into what luck alone would produce and what is left over, which is real difference.
          Goals (rare, noisy) are shrunk as if the player had 195 extra average minutes; crosses (common, stable) only 45;
          fouls committed, which turn out to be almost all luck, 749. A 58-minute winger&apos;s 3.10 goals/90 becomes an
          estimate of 0.79. Each player is then compared with players in his main position (most minutes) and age group, as a z-score: how many standard
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
          Step 1 handles noise in each stat. The composite of ten noisy stats is noisy too, so the weighted sum is also
          multiplied by <code className="text-text">minutes / (minutes + {SHRINK_MINUTES})</code>. The {SHRINK_MINUTES}{" "}
          is not arbitrary: rating each player on half his matches and comparing with the other half gave a rank
          agreement of 0.17 over about 84 minutes, which implies a half-trust point near 415 minutes. Five full matches
          is the round number next to it. Anyone under {LOW_SAMPLE_MINUTES} minutes is labelled low sample.
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
                Top 5: {c.top} · sub-90-min players in top/bottom 10%: {c.tails} of 53 · split-half ρ: {c.rho}
              </p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Split-half agreement looks like it should pick the winner, but it rewards anything stable, and role is very
          stable: a centre-mid touches the ball a lot every week. A and D score well on it by ranking roles. Honest
          note on F vs C: most of the gain came from the stronger whole-score shrink. C with K=450 already gets cameos
          in the tails down to 3. The per-stat priors take it to 1 and shrink each stat for its own reason. F has the
          lowest agreement of the sensible models, which is the real headline: on 2–3 matches per player, most of the
          difference between two players is noise.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What is wrong with it</h2>
        <ul className="list-disc space-y-2 pl-5 text-muted">
          <li>
            <span className="text-text">Too little data.</span> 183 players, mostly 1–3 matches. Two halves of the same
            player&apos;s games agree at ρ≈0.16. The percentile is a ranking of short samples, not of players.
          </li>
          <li>
            <span className="text-text">Cameos are damped, not solved.</span> Roque Moliner (58 min, 2 goals, 1 assist)
            went from 99th in v1 to 93rd. With 58 minutes of evidence that may still be too confident.
          </li>
          <li>
            <span className="text-text">Keepers are barely rated.</span> No saves or shots faced, so 40% of a keeper&apos;s
            rating is his team&apos;s goals conceded. The top-rated U15 player is Real Madrid&apos;s keeper, mostly because his
            team conceded once in three matches.
          </li>
          <li>
            <span className="text-text">It may be rating teams, not players.</span> Rank the 12 squads by average
            player percentile and by goal difference: the two orders agree at ρ = 0.96. Real Madrid U15 (+12 GD) averages
            the 79th percentile; Getafe U15 (−10) the 29th. Either the better clubs have the better players, or a good
            team inflates everyone&apos;s per-90s. This file can&apos;t tell those apart, and there is no opponent
            adjustment: Real Madrid beat Getafe 9–0 and every per-90 from that match counts the same as any other.
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
