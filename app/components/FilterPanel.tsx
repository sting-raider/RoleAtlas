import { BriefcaseBusiness, Clock3, LocateFixed, ShieldCheck, X } from "lucide-react";
import type { Job, JobType, WorkMode } from "../jobs.ts";
import { Checkbox, SelectMenu } from "./ui.tsx";

export type Filters = {
  maxExperience: number | null;
  jobTypes: JobType[];
  workModes: WorkMode[];
  noDegree: boolean;
  visaSupport: boolean;
  minSalary: number;
  postedWithin: number;
};

export const DEFAULT_FILTERS: Filters = {
  maxExperience: null,
  jobTypes: [],
  workModes: [],
  noDegree: false,
  visaSupport: false,
  minSalary: 0,
  postedWithin: 0,
};

export function FilterPanel({
  jobs,
  filters,
  setFilters,
  onClose,
}: {
  jobs: Job[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  onClose?: () => void;
}) {
  const toggleList = <T,>(key: "jobTypes" | "workModes", value: T) => {
    const current = filters[key] as T[];
    setFilters({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  return (
    <aside className="filter-panel" aria-label="Job filters">
      <div className="filter-panel-head">
        <div>
          <span className="eyebrow">Make it yours</span>
          <h2>Filters</h2>
        </div>
        <div className="filter-actions">
          <button type="button" className="text-button" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset
          </button>
          {onClose && (
            <button type="button" className="icon-button compact" aria-label="Close filters" onClick={onClose}>
              <X size={17} />
            </button>
          )}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <Clock3 size={15} />
          <span>Experience ceiling</span>
        </div>
        <div className="segmented-control" aria-label="Maximum experience">
          {([null, 0, 1, 2, 3] as Array<number | null>).map((value) => (
            <button
              type="button"
              key={value ?? "any"}
              className={filters.maxExperience === value ? "active" : ""}
              onClick={() => setFilters({ ...filters, maxExperience: value })}
            >
              {value === null ? "Any" : value === 3 ? "3+" : value}
            </button>
          ))}
        </div>
        <p className="filter-help">Maximum years requested by the listing.</p>
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <BriefcaseBusiness size={15} />
          <span>Opportunity type</span>
        </div>
        {(["Internship", "Entry-level", "Apprenticeship", "Full-time", "Part-time", "Contract", "Unknown"] as JobType[]).map((type) => (
          <Checkbox
            key={type}
            label={type}
            count={jobs.filter((job) => job.type === type).length}
            checked={filters.jobTypes.includes(type)}
            onChange={() => toggleList("jobTypes", type)}
          />
        ))}
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <LocateFixed size={15} />
          <span>Where you’ll work</span>
        </div>
        {(["Remote", "Hybrid", "On-site"] as WorkMode[]).map((mode) => (
          <Checkbox
            key={mode}
            label={mode}
            count={jobs.filter((job) => job.workMode === mode).length}
            checked={filters.workModes.includes(mode)}
            onChange={() => toggleList("workModes", mode)}
          />
        ))}
      </div>

      <div className="filter-section">
        <div className="filter-label">
          <ShieldCheck size={15} />
          <span>Eligibility</span>
        </div>
        <Checkbox
          label="Education not required"
          count={jobs.filter((job) => !job.degreeRequired).length}
          checked={filters.noDegree}
          onChange={() => setFilters({ ...filters, noDegree: !filters.noDegree })}
        />
        <Checkbox
          label="Visa support stated"
          count={jobs.filter((job) => job.visaSupport).length}
          checked={filters.visaSupport}
          onChange={() => setFilters({ ...filters, visaSupport: !filters.visaSupport })}
        />
      </div>

      <div className="filter-section">
        <div className="filter-label filter-label-spread">
          <span>Minimum salary</span>
          <strong>{filters.minSalary === 0 ? "Any" : `$${filters.minSalary / 1000}k+`}</strong>
        </div>
        <input
          className="range-input"
          type="range"
          min="0"
          max="80000"
          step="10000"
          value={filters.minSalary}
          onChange={(event) => setFilters({ ...filters, minSalary: Number(event.target.value) })}
          aria-label="Minimum annual salary in US dollars"
        />
        <div className="range-scale"><span>Any</span><span>$80k+</span></div>
      </div>

      <div className="filter-section last-filter">
        <div className="filter-label">Posted within</div>
        <SelectMenu
          value={String(filters.postedWithin)}
          onChange={(value) => setFilters({ ...filters, postedWithin: Number(value) })}
          placeholder="Any time"
          ariaLabel="Posted within"
          options={[["0", "Any time"], ["1", "24 hours"], ["3", "3 days"], ["7", "7 days"], ["14", "14 days"], ["30", "30 days"]].map(([value, label]) => ({ value, label }))}
        />
      </div>
    </aside>
  );
}
