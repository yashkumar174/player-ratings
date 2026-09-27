import type { Metadata } from "next";
import { connection } from "next/server";
import { listUploads } from "@/lib/db/queries";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage() {
  await connection(); // read the DB per request, never at build time
  const uploads = await listUploads();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Upload match data</h1>
      <p className="mt-1 text-sm text-muted">
        One row per player per match. The file is cleaned, stored, and every rating is recomputed from all stored
        matches.
      </p>
      <div className="mt-6">
        <UploadForm />
      </div>

      {uploads.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium text-muted">Previous uploads</h2>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                <span className="font-medium">{u.filename}</span>
                <span className="text-muted tabular">
                  {u.acceptedRows}/{u.totalRows} rows · {u.issues.length} notes ·{" "}
                  {new Date(u.uploadedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
