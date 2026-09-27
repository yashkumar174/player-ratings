"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Issue } from "@/lib/ingest/clean";
import { uploadCsv, type UploadState } from "./actions";

const SEVERITY_TONE: Record<Issue["severity"], string> = {
  error: "text-bad",
  warning: "text-mid",
  info: "text-muted",
};

export function UploadForm() {
  const [name, setName] = useState<string | null>(null);
  const [state, action, pending] = useActionState<UploadState, FormData>(async (prev, form) => {
    const next = await uploadCsv(prev, form);
    setName(null); // React resets the form (and its file input) after the action
    return next;
  }, { status: "idle" });

  return (
    <div className="space-y-6">
      <form action={action} className="rounded-xl border border-dashed border-line bg-surface p-6 text-center">
        <label className="block cursor-pointer">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => setName(e.target.files?.[0]?.name ?? null)}
          />
          <span className="inline-block rounded-lg border border-line px-4 py-2 text-sm hover:bg-bg">
            {name ?? "Choose match_events.csv"}
          </span>
        </label>
        <button
          disabled={pending || !name}
          className="mt-4 w-full rounded-lg bg-text px-4 py-2.5 text-sm font-medium text-bg transition disabled:opacity-40 sm:w-auto"
        >
          {pending ? "Cleaning, saving and re-rating…" : "Upload and rate"}
        </button>
        <p className="mt-3 text-xs text-faint">
          Re-uploading is safe: rows are matched on match + player and updated, not duplicated.
        </p>
      </form>

      {state.status === "error" && <p className="text-sm text-bad">{state.message}</p>}
      {state.status === "done" && <Report report={state.report} />}
    </div>
  );
}

function Report({ report }: { report: Extract<UploadState, { status: "done" }>["report"] }) {
  // Plain reduce rather than Map.groupBy: older iOS Safari lacks it.
  const grouped = new Map<string, Issue[]>();
  for (const i of report.issues) grouped.set(i.code, [...(grouped.get(i.code) ?? []), i]);
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{report.filename}</h2>
        {report.uploadId && (
          <Link href="/" className="text-sm text-accent hover:underline">
            View {report.playersRated} rated players →
          </Link>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Rows in file", report.totalRows],
          ["Kept", report.acceptedRows],
          ["Dropped", report.skippedRows],
          ["New / updated", `${report.newAppearances} / ${report.updatedAppearances}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-bg px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 font-medium tabular">{v}</dd>
          </div>
        ))}
      </dl>
      {report.issues.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-medium">What the cleaner found ({report.issues.length})</h3>
          <ul className="mt-2 space-y-3 text-sm">
            {[...grouped].map(([code, list]) => (
              <li key={code}>
                <div className={`text-xs font-medium uppercase tracking-wide ${SEVERITY_TONE[list[0].severity]}`}>
                  {code.replaceAll("_", " ")} · {list.length}
                </div>
                <ul className="mt-1 space-y-0.5 text-muted">
                  {list.slice(0, 6).map((i, k) => (
                    <li key={k}>
                      {i.line && <span className="text-faint tabular">line {i.line}: </span>}
                      {i.message}
                    </li>
                  ))}
                  {list.length > 6 && <li className="text-faint">…and {list.length - 6} more</li>}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
