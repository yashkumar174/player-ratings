"use server";

import { revalidatePath } from "next/cache";
import { ingestCsv, type IngestReport } from "@/lib/db/ingest";

export type UploadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; report: IngestReport };

const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadCsv(_prev: UploadState, form: FormData): Promise<UploadState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a CSV file first." };
  if (file.size > MAX_BYTES) return { status: "error", message: "File is over 5 MB." };
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv")
    return { status: "error", message: "That doesn't look like a CSV file." };

  try {
    const report = await ingestCsv(await file.text(), file.name);
    revalidatePath("/", "layout");
    return { status: "done", report };
  } catch (err) {
    console.error("upload failed", err);
    return { status: "error", message: "Saving failed; nothing was written. Check the server log." };
  }
}
