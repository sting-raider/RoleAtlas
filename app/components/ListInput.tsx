"use client";

import { useState } from "react";
import { joinList, rawMatchesList, splitList } from "../listText.ts";

type ListInputProps = {
  /** Parsed list from the owning form state. */
  values: string[];
  /** Commit the newly parsed list upward on every change. */
  onChange: (values: string[]) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
  ariaLabel?: string;
  multiline?: boolean;
};

/**
 * Text entry for comma/newline-separated lists that does not fight typing.
 *
 * The input holds the RAW text locally; `values` is parsed and pushed upward
 * so validation and previews stay live. The displayed text is re-derived
 * from props only when the incoming list is NOT a case/whitespace/delimiter
 * match of what this buffer already reflects — i.e. a genuine external
 * update such as a résumé import or strategy regeneration. Ordinary
 * keystrokes ("data, " with the trailing space still in the box) are never
 * rewritten underneath the user.
 */
export function ListInput({ values, onChange, placeholder, rows = 2, id, ariaLabel, multiline = false }: ListInputProps) {
  const [raw, setRaw] = useState(() => joinList(values));
  const [seen, setSeen] = useState(values);

  // Render-time adjustment (react.dev/learn/you-might-not-need-an-effect):
  // when props move and the raw buffer cannot account for the difference,
  // the change came from outside this component and replaces the buffer.
  // Buffer-produced changes (same list up to case/whitespace/delimiter
  // noise) leave keystrokes untouched.
  if (values !== seen && !sameList(values, seen)) {
    setSeen(values);
    if (!rawMatchesList(raw, values)) setRaw(joinList(values));
  }

  const handleInput = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = event.target.value;
    setRaw(next);
    const parsed = splitList(next);
    setSeen(parsed);
    onChange(parsed);
  };

  const shared = {
    id,
    value: raw,
    onChange: handleInput,
    placeholder,
    "aria-label": ariaLabel,
  };

  return multiline ? <textarea rows={rows} {...shared} /> : <input type="text" {...shared} />;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
