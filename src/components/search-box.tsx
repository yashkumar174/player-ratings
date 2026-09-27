"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Filters as you type by updating ?q=; the surrounding <form> still works without JS. */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      startTransition(() => router.replace(`/?${next}`, { scroll: false }));
    }, 200);
    return () => clearTimeout(t);
    // Only typing should trigger a navigation, not the params it produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative flex-1">
      <input
        name="q"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search players"
        autoComplete="off"
        className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-muted"
      />
      {pending && (
        <span className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-line border-t-muted" />
      )}
    </div>
  );
}
