import { LOW_SAMPLE_MINUTES } from "@/lib/rating/compute";

// Percentile display shared by the list and the detail page.

export function pctTone(p: number): string {
  if (p >= 67) return "var(--good)";
  if (p >= 34) return "var(--mid)";
  return "var(--bad)";
}

export function ordinal(n: number): string {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[r % 10] ?? "th";
  return `${r}${s}`;
}

export function PercentileBar({ value, minutes }: { value: number | null; minutes?: number | null }) {
  if (value === null) return <span className="text-xs text-faint">unrated</span>;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 text-right text-sm font-medium tabular" style={{ color: pctTone(value) }}>
        {Math.round(value)}
      </span>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-track sm:w-28" aria-hidden>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.max(2, value)}%`, background: pctTone(value) }}
        />
      </div>
      {minutes !== undefined && minutes !== null && minutes < LOW_SAMPLE_MINUTES && (
        <span title={`Under ${LOW_SAMPLE_MINUTES} minutes: treat as close to unknown`} className="hidden text-[10px] uppercase tracking-wide text-faint md:inline">
          low sample
        </span>
      )}
    </div>
  );
}
