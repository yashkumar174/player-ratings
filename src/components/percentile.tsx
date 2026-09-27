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

export function PercentileBar({ value, reliability }: { value: number | null; reliability?: number | null }) {
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
      {reliability !== undefined && reliability !== null && reliability < 0.25 && (
        <span title="Under ~90 minutes: rating is mostly the age-group average" className="hidden text-[10px] uppercase tracking-wide text-faint md:inline">
          low sample
        </span>
      )}
    </div>
  );
}
