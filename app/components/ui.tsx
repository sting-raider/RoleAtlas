import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { EligibilityStatus } from "../jobs.ts";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type SelectOption = { value: string; label: string };

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  searchable = false,
  disabled = false,
  compact = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  searchable?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const visible = options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={root} className={cx("select-menu", open && "open", compact && "compact") }>
      <button type="button" className="select-trigger" role="combobox" aria-controls={listboxId} aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => { setOpen((current) => !current); setSearch(""); }}>
        <span>{selected?.label ?? placeholder}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div id={listboxId} className="select-popover" role="listbox">
          {searchable && <div className="select-search"><Search size={14} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search places…" /></div>}
          <div className="select-options">
            {visible.map((option) => (
              <button type="button" key={option.value || "all"} role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); setSearch(""); }}>
                <span>{option.label}</span>{option.value === value && <Check size={14} />}
              </button>
            ))}
            {visible.length === 0 && <p>No matching places</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function postedLabel(days: number | null) {
  if (days === null) return "Date not stated";
  if (days === 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days} days ago`;
}

export function Checkbox({
  checked,
  label,
  count,
  onChange,
}: {
  checked: boolean;
  label: string;
  count?: number;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="filter-check"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
    >
      <span className={cx("check-box", checked && "checked")}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>{label}</span>
      {typeof count === "number" && <span className="filter-count">{count}</span>}
    </button>
  );
}

export function MatchRing({ score }: { score: number }) {
  return (
    <div className="match-ring" style={{ "--score": score } as React.CSSProperties} aria-label={`${score}% suitability`}>
      <div><strong>{score}%</strong><span>match</span></div>
    </div>
  );
}

export function eligibilityLabel(status: EligibilityStatus) {
  return ({
    confirmed: "Eligible location",
    likely: "Likely location fit",
    unclear: "Location eligibility unclear",
    excluded: "Location excluded",
    requires_sponsorship: "Sponsorship required",
    requires_relocation: "Relocation required",
    requires_office_attendance: "Office attendance required",
    timezone_mismatch: "Timezone mismatch",
  } satisfies Record<EligibilityStatus, string>)[status];
}

export function verifiedLabel(value?: string | null) {
  if (!value) return "time unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "time unknown" : parsed.toISOString().slice(0, 10);
}
