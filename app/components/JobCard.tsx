import {
  Bookmark,
  BookmarkCheck,
  CircleAlert,
  FileText,
  MapPin,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ApplicationStage, Job } from "../jobs.ts";
import type { FeedbackReason } from "../dailyProduct.ts";
import { formatSalary } from "../jobData";
import {
  cx,
  eligibilityLabel,
  MatchRing,
  postedLabel,
  verifiedLabel,
} from "./ui.tsx";

export function JobCard({
  job,
  hasResume,
  hasProfile,
  saved,
  stage,
  onSave,
  onOpen,
  onApply,
  onResume,
  onFeedback,
}: {
  job: Job;
  hasResume: boolean;
  hasProfile: boolean;
  saved: boolean;
  stage?: ApplicationStage;
  onSave: () => void;
  onOpen: () => void;
  onApply: () => void;
  onResume: () => void;
  onFeedback: (reason: FeedbackReason) => void;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const disqualified = job.eligibilityStatus === "excluded" || job.eligibilityStatus === "timezone_mismatch";
  const feedbackOptions: Array<[FeedbackReason, string]> = [["not_relevant", "Not relevant"], ["wrong_role", "Wrong role"], ["wrong_seniority", "Wrong seniority"], ["wrong_location", "Wrong location"], ["not_eligible", "Not eligible"], ["compensation_too_low", "Compensation too low"], ["not_interested_in_company", "Not interested in company"], ["duplicate", "Duplicate"], ["already_applied", "Already applied"], ["closed", "Closed"], ["show_fewer_like_this", "Show fewer like this"]];
  return (
    <article className={cx("job-card", disqualified && "hard-disqualified", job.lifecycleStatus === "closed" && "closed-job")}>
      <div className="job-card-main">
        <div className="company-mark">{job.initials}</div>
        <div className="job-copy">
          <div className="job-title-row">
            <div>
              <div className="company-line">
                <span>{job.company}</span>
                {job.recordKind === "canonical" && job.verified && <span className="verified"><ShieldCheck size={12} /> Verified source</span>}
                {job.recordKind === "feed" && <span className="feed-badge" title="Syndicated aggregator copy — not employer-verified and excluded from saved-search sessions">Aggregator feed · unverified</span>}
              </div>
              <h3>{job.title}</h3>
            </div>
            <button
              type="button"
              className={cx("save-button", saved && "saved")}
              aria-label={saved ? `Remove ${job.title} from saved roles` : `Save ${job.title}`}
              onClick={onSave}
            >
              {saved ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
            </button>
          </div>

          <div className="job-meta">
            <span><MapPin size={13} />{job.location}</span>
            <span>{formatSalary(job)}</span>
            <span>{postedLabel(job.postedDays)}</span>
          </div>

          <div className="tag-row">
            <span>{job.type}</span>
            <span>{job.experienceLabel}</span>
            <span>{job.workMode}</span>
            {job.degreeRequired !== true && <span>{job.degreeRequired === false ? "No degree required" : "Degree not stated"}</span>}
            {job.visaSupport && <span>Visa support</span>}
            {job.eligibilityStatus && <span className={`eligibility-${job.eligibilityStatus}`}>{eligibilityLabel(job.eligibilityStatus)}</span>}
            {stage && <span>Application: {stage}</span>}
            {job.lifecycleStatus === "possibly_closed" && <span>Source is rechecking availability</span>}
            {job.lifecycleStatus === "closed" && <span className="closed-label">Closed listing</span>}
          </div>

          <div className="why-fit">
            <div className="why-icon"><Sparkles size={14} /></div>
            <div>
              <span>{job.eligibilityStatus ? "Why this is in your search" : hasResume ? "Why this matches your résumé" : "Preliminary eligibility signal"}</span>
              <p>{job.reasons[0]}</p>
              {(job.eligibilityEvidence?.[0] ?? job.reasons[1]) && <p>{job.eligibilityEvidence?.[0] ?? job.reasons[1]}</p>}
            </div>
          </div>

          <div className="card-uncertainty"><CircleAlert size={13} /><span><strong>Important uncertainty:</strong> {job.gap || "The listing does not state every requirement clearly."}</span></div>

          <div className="job-footer">
            <span className="source-label">{job.recordKind === "feed" ? `${job.source} · syndicated copy · never employer-verified` : `${job.source} · verified ${verifiedLabel(job.lastVerifiedAt)}`}</span>
            <div className="card-actions">
              <button type="button" className="secondary-button small" onClick={() => onFeedback("relevant")}>Relevant</button>
              <div className="feedback-menu-wrap"><button type="button" className="secondary-button small" aria-expanded={feedbackOpen} onClick={() => setFeedbackOpen((open) => !open)}>Dismiss</button>{feedbackOpen && <div className="feedback-menu" role="menu">{feedbackOptions.map(([reason, label]) => <button type="button" role="menuitem" key={reason} onClick={() => { onFeedback(reason); setFeedbackOpen(false); }}>{label}</button>)}</div>}</div>
              <button type="button" className="secondary-button small" onClick={onOpen}>Open</button>
              <button type="button" className="primary-button small" onClick={onApply}>
                Prepare<Sparkles size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="job-score">
        {disqualified ? <div className="disqualified-score"><X size={20} /><strong>Not eligible</strong><span>Hard constraint</span></div> : hasResume ? <><MatchRing score={job.score} /><span className="score-label">Résumé match</span><span className="confidence">{job.scoreKind === "ai" ? "AI + evidence" : "Keyword evidence"}</span></> : hasProfile && job.scoreKind === "search" ? <><MatchRing score={job.score} /><span className="score-label">Strategy match</span><span className="confidence">Deterministic evidence</span></> : <button type="button" className="resume-score-cta" onClick={onResume}><FileText size={19} /><strong>Match me</strong><span>Upload résumé</span></button>}
      </div>
    </article>
  );
}
