"use client";

import type { ComponentProps } from "react";

/** A <select> that submits its form on change; with JS off the Apply button does it. */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
