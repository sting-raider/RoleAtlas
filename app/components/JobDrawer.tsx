"use client";

import { useState } from "react";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Check,
  ClipboardCheck,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import type { CareerDossier } from "../careerOps.ts";
import type { ApplicationStage, Job } from "../jobs.ts";
import { formatSalary } from "../jobData.ts";
import { aiRequestPreview, type AiRequestPreview } from "../dailyProduct.ts";
import { providerIsConfigured, type AiActivity, type ProviderConfig } from "../aiProvider.ts";
import { recordAiActivity } from "../accountStorage.ts";
import type { ResumeProfile } from "./ResumeModal";
import { useDialogFocus } from "../useDialogFocus";
import { cx, eligibilityLabel, MatchRing, SelectMenu, verifiedLabel } from "./ui";

type DossierTab = "evaluation" | "resume" | "letter" | "interview";

export function JobDrawer({
  userId,
  job,
  hasResume,
  hasProfile,
  resume,
  providerConfig,
  saved,
  stage,
  onClose,
  onSave,
  dossier,
  onDossier,
  onStageChange,
  onOpenProvider,
  onResume,
  onConfirmAi,
  similarJobs,
  onOpenSimilar,
}: {
  userId: string;
  job: Job;
  hasResume: boolean;
  hasProfile: boolean;
  resume: ResumeProfile | null;
  providerConfig: ProviderConfig;
  saved: boolean;
  stage?: ApplicationStage;
  onClose: () => void;
  onSave: () => void;
  dossier?: CareerDossier;
  onDossier: (dossier: CareerDossier) => void;
  onStageChange: (stage: ApplicationStage) => void;
  onOpenProvider: () => void;
  onResume: () => void;
  onConfirmAi: (preview: AiRequestPreview, action: () => Promise<void>) => void;
  similarJobs: Job[];
  onOpenSimilar: (job: Job) => void;
}) {
  const [activeTab, setActiveTab] = useState<DossierTab>("evaluation");
  const [prepareState, setPrepareState] = useState<"idle" | "loading" | "error">("idle");
  const [prepareError, setPrepareError] = useState("");
  const [copied, setCopied] = useState("");
  const canPrepare = Boolean(providerIsConfigured(providerConfig) && resume);
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const prepare = async () => {
    if (!resume) { onResume(); return; }
    if (!canPrepare) { onOpenProvider(); return; }
    setPrepareState("loading");
    setPrepareError("");
    try {
      const response = await fetch("/api/ai/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...providerConfig, resumeText: resume.text, job }),
      });
      const payload = await response.json() as { dossier?: CareerDossier; error?: string; activity?: AiActivity };
      recordAiActivity(userId, payload.activity);
      if (!response.ok || !payload.dossier) throw new Error(payload.error || "The model could not prepare this application.");
      onDossier(payload.dossier);
      onStageChange("Preparing");
      setPrepareState("idle");
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Application preparation failed.");
      setPrepareState("error");
    }
  };

  const previewPreparation = () => {
    if (!resume) { onResume(); return; }
    if (!canPrepare) { onOpenProvider(); return; }
    onConfirmAi(aiRequestPreview({ provider: providerConfig.provider, model: providerConfig.model, baseUrl: providerConfig.baseUrl, purpose: dossier ? "Regenerate the application dossier" : "Prepare an application dossier", dataCategories: ["resume text", "optional candidate constraints", "selected job description and metadata"], estimatedInputCharacters: resume.text.length + (job.description?.length ?? job.summary.length) + providerConfig.profile.length }), prepare);
  };

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside ref={dialogRef} tabIndex={-1} className="job-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-top">
          <span className="live-pill"><span /> Verified listing</span>
          <button type="button" className="icon-button" aria-label="Close job details" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="drawer-company">
          <div className="company-mark large">{job.initials}</div>
          <div><span>{job.company}</span><h2 id="drawer-title">{job.title}</h2></div>
        </div>
        <div className="drawer-meta">
          <span><MapPin size={14} />{job.location}</span>
          <span>{formatSalary(job)}</span>
          <span>{job.type}</span>
          {stage && <span>Application: {stage}</span>}
        </div>
        <p className="drawer-summary">{job.summary}</p>

        <section className="drawer-section score-breakdown-section">
          <h3>Score and constraint breakdown</h3>
          <div className="drawer-breakdown"><div><span>Evidence match</span><strong>{hasResume || (hasProfile && job.scoreKind === "search") ? `${job.score}/100` : "Not calculated"}</strong></div><div><span>Eligibility</span><strong>{job.eligibilityStatus ? eligibilityLabel(job.eligibilityStatus) : "Unclear"}</strong></div><div><span>Source freshness</span><strong>{verifiedLabel(job.lastVerifiedAt)}</strong></div><div><span>Listing status</span><strong>{job.lifecycleStatus ?? "Unknown"}</strong></div></div>
          {(job.eligibilityStatus === "excluded" || job.eligibilityStatus === "timezone_mismatch") && <div className="hard-disqualifier-callout"><X size={16} /><p><strong>Hard disqualifier:</strong> this job is not ranked as a strong match. Review the listing evidence before taking action.</p></div>}
        </section>

        {hasResume ? <div className="drawer-score-card"><MatchRing score={job.score} /><div><span className="eyebrow">Résumé evidence</span><h3>{job.scoreKind === "ai" ? "AI-assisted evidence match" : "Deterministic résumé match"}</h3><p>This percentage compares evidence in your résumé with this listing. It is not a hiring probability.</p></div></div> : hasProfile && job.scoreKind === "search" ? <div className="drawer-score-card"><MatchRing score={job.score} /><div><span className="eyebrow">Confirmed search strategy</span><h3>Deterministic strategy match</h3><p>This score combines title-query evidence and eligibility status. It is not a hiring probability.</p></div></div> : <button type="button" className="drawer-resume-prompt" onClick={onResume}><UploadCloud size={20} /><div><span className="eyebrow">Match not calculated</span><h3>Upload your résumé for an evidence-based score</h3><p>Until then, RoleAtlas shows listings without pretending to know your suitability.</p></div><ArrowRight size={17} /></button>}

        <section className="drawer-section">
          <h3>Why am I seeing this?</h3>
          <p className="drawer-section-intro">This listing matched a confirmed role query or evidence term. Eligibility remains a separate decision.</p>
          <div className="reason-list">
            {job.reasons.map((reason) => <div key={reason}><Check size={15} /><p>{reason}</p></div>)}
          </div>
        </section>
        <section className="drawer-section gap-section">
          <h3>One honest gap</h3>
          <p>{job.gap}</p>
        </section>
        <section className="drawer-section">
          <h3>Location and authorization evidence</h3>
          <div className="reason-list">{(job.eligibilityEvidence?.length ? job.eligibilityEvidence : ["The listing does not provide enough evidence to confirm individual geographic eligibility."]).map((evidence) => <div key={evidence}><MapPin size={14} /><p>{evidence}</p></div>)}</div>
        </section>
        <section className="drawer-section">
          <h3>Source and original wording</h3>
          <dl className="drawer-source-details"><div><dt>Source</dt><dd>{job.source}</dd></div><div><dt>Canonical URL</dt><dd>{job.canonicalUrl ?? job.url}</dd></div><div><dt>Last verified</dt><dd>{job.lastVerifiedAt ?? "Not available"}</dd></div><div><dt>Original employment label</dt><dd>{job.opportunityClassification?.originalLabel ?? "Not supplied"}</dd></div><div><dt>Classification confidence</dt><dd>{job.opportunityClassification ? `${Math.round(job.opportunityClassification.confidence * 100)}% · ${job.opportunityClassification.evidenceSource}` : "Unknown"}</dd></div><div><dt>Compensation</dt><dd>{formatSalary(job)}</dd></div></dl>
        </section>
        <section className="drawer-section">
          <h3>Skills in this listing</h3>
          <div className="tag-row drawer-tags">{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
        </section>

        {similarJobs.length > 0 && <section className="drawer-section"><h3>Similar jobs</h3><div className="similar-job-list">{similarJobs.slice(0, 3).map((similar) => <button type="button" key={similar.id} onClick={() => onOpenSimilar(similar)}><span><strong>{similar.title}</strong><small>{similar.company} · {similar.location}</small></span><ArrowRight size={14} /></button>)}</div></section>}

        <section className="drawer-section dossier-section">
          <div className="analysis-heading">
            <div><span className="eyebrow">Career operations</span><h3>{dossier ? "Application workspace" : "Build the full application"}</h3></div>
            <button type="button" className="primary-button compact-action" onClick={previewPreparation} disabled={prepareState === "loading"}>
              <Sparkles size={15} />{prepareState === "loading" ? `${providerConfig.provider} is preparing…` : dossier ? "Regenerate" : canPrepare ? "Prepare everything" : !resume ? "Upload résumé" : "Connect a model"}
            </button>
          </div>
          {!dossier && prepareState !== "error" && <div className="dossier-promise"><p>One action creates a structured evaluation, legitimacy check, truthful résumé tailoring, cover letter, recruiter message, interview plan, and next-action checklist.</p><div><span>Evaluate</span><span>Tailor</span><span>Write</span><span>Prepare</span></div></div>}
          {prepareState === "error" && <p className="analysis-error">{prepareError}</p>}
          {dossier && (
            <div className="dossier-workspace">
              <div className="dossier-verdict"><div className={`grade-badge grade-${dossier.grade.toLowerCase()}`}>{dossier.grade}</div><div><span>{dossier.score}/100 · {dossier.legitimacy.rating}</span><strong>{dossier.verdict}</strong><p>{dossier.roleSummary}</p></div></div>
              <div className="dossier-tabs" role="tablist">{([["evaluation", "Evaluation"], ["resume", "Résumé"], ["letter", "Messages"], ["interview", "Interview"]] as Array<[DossierTab, string]>).map(([id, label]) => <button type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "active" : ""} key={id} onClick={() => setActiveTab(id)}>{label}</button>)}</div>
              {activeTab === "evaluation" && <div className="dossier-panel">
                <p className="dossier-lead">{dossier.whyThisRole}</p>
                <div className="dimension-list">{dossier.dimensions.map((item) => <div key={item.name}><div><strong>{item.name}</strong><span>{item.score}/5</span></div><p>{item.evidence}</p></div>)}</div>
                <div className="dossier-columns"><div><strong>Evidence in your favor</strong><ul>{dossier.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div><div><strong>Gaps to handle honestly</strong><ul>{dossier.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
                <div className="legitimacy-card"><ShieldCheck size={16} /><div><strong>Posting legitimacy: {dossier.legitimacy.rating}</strong>{dossier.legitimacy.signals.map((item) => <p key={item}>{item}</p>)}</div></div>
              </div>}
              {activeTab === "resume" && <div className="dossier-panel copy-panel">
                <div className="copy-block"><div><strong>Target headline</strong><button type="button" onClick={() => void copyText("headline", dossier.resume.headline)}>{copied === "headline" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.resume.headline}</p></div>
                <div className="copy-block"><div><strong>Tailored summary</strong><button type="button" onClick={() => void copyText("summary", dossier.resume.summary)}>{copied === "summary" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.resume.summary}</p></div>
                <div><strong>Truthful bullet rewrites</strong><ul>{dossier.resume.bulletRewrites.map((item) => <li key={item}>{item}</li>)}</ul></div>
                {dossier.resume.missingEvidence.length > 0 && <div className="missing-evidence"><strong>Do not claim without evidence</strong><ul>{dossier.resume.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                <div className="keyword-row">{dossier.keywords.map((item) => <span key={item}>{item}</span>)}</div>
              </div>}
              {activeTab === "letter" && <div className="dossier-panel copy-panel">
                <div className="copy-block long-copy"><div><strong>Cover letter</strong><button type="button" onClick={() => void copyText("letter", dossier.coverLetter)}>{copied === "letter" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.coverLetter}</p></div>
                <div className="copy-block"><div><strong>Recruiter message</strong><button type="button" onClick={() => void copyText("message", dossier.recruiterMessage)}>{copied === "message" ? <ClipboardCheck size={14} /> : "Copy"}</button></div><p>{dossier.recruiterMessage}</p></div>
              </div>}
              {activeTab === "interview" && <div className="dossier-panel interview-grid">
                <div><strong>Questions they may ask</strong><ol>{dossier.interview.likelyQuestions.map((item) => <li key={item}>{item}</li>)}</ol></div>
                <div><strong>Stories to prepare</strong><ul>{dossier.interview.storiesToPrepare.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>Questions worth asking</strong><ul>{dossier.interview.questionsToAsk.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div className="next-actions"><strong>Next actions</strong>{dossier.nextActions.map((item, index) => <p key={item}><span>{index + 1}</span>{item}</p>)}</div>
              </div>}
            </div>
          )}
        </section>

        <div className="drawer-actions dossier-actions">
          <SelectMenu compact ariaLabel="Application status" value={stage ?? ""} onChange={(value) => onStageChange(value as ApplicationStage)} placeholder="Set status" options={["Preparing", "Applied", "Interview", "Offer", "Closed"].map((value) => ({ value, label: value }))} />
          <button type="button" className={cx("secondary-button", saved && "is-saved")} onClick={onSave}>{saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}{saved ? "Saved" : "Save"}</button>
          <a className="primary-button" href={job.url} target="_blank" rel="noreferrer">Original listing<ExternalLink size={15} /></a>
        </div>
      </aside>
    </div>
  );
}
