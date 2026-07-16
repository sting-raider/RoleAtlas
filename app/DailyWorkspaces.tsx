"use client";

import {
  Archive,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Clock3,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  History,
  MapPin,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { candidateSections, type CandidateProfile, type SearchPlan } from "./candidateProfile";
import {
  APPLICATION_STAGES,
  dashboardSummary,
  serviceMode,
  type DailyApplicationStage,
  type DailyWorkspace,
  type ServiceStatus,
  type StrategyRecord,
  type StrategyStatus,
} from "./dailyProduct";
import type { ProviderConfig } from "./aiProvider";
import { providerIsConfigured, verificationIsCurrent } from "./aiProvider";
import type { Job } from "./jobs";

export type DailyView = "home" | "discover" | "searches" | "saved" | "applications" | "profile" | "sources" | "settings";

export type SessionSummary = {
  id: string;
  profile_id?: string | null;
  plan_id?: string | null;
  status: string;
  stage?: string;
  query_count: number;
  result_count: number;
  started_at: string;
  completed_at?: string | null;
  updated_at?: string;
  plan?: SearchPlan;
  coverage?: {
    state?: string;
    selected_sources?: number;
    successful_sources?: number;
    incomplete_sources?: number;
    eligibility_counts?: Record<string, number>;
    source_selection?: { observed_jobs_in_completed_runs?: number; states?: Record<string, number>; claim?: string };
  };
};

type Navigation = (view: DailyView) => void;

function relativeTime(value?: string | null) {
  if (!value) return "Not yet";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function EmptyWorkspace({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return <div className="daily-empty"><div>{icon}</div><h2>{title}</h2><p>{body}</p>{action}</div>;
}

export function HomeWorkspace({ workspace, sessions, jobs, onNavigate, onOpenJob, onNotification }: { workspace: DailyWorkspace; sessions: SessionSummary[]; jobs: Job[]; onNavigate: Navigation; onOpenJob: (job: Job) => void; onNotification: (id: string, action: "read" | "dismiss") => void }) {
  const summary = dashboardSummary(workspace, sessions, jobs);
  const referenceTime = new Date(workspace.updatedAt).getTime();
  const strong = jobs.filter((job) => job.score >= 75 && !workspace.dismissedJobIds.includes(job.id) && !["excluded", "timezone_mismatch"].includes(job.eligibilityStatus ?? "")).slice(0, 5);
  const recent = workspace.recentViews.map((view) => jobs.find((job) => job.id === view.jobId)).filter((job): job is Job => Boolean(job)).slice(0, 4);
  const notifications = workspace.notifications.filter((notification) => !notification.dismissedAt).slice(0, 5);
  return (
    <div className="daily-page home-workspace">
      <div className="daily-hero"><div><span className="eyebrow">Today on your radar</span><h1>What deserves your attention?</h1><p>New matches, active searches, and application follow-ups—without infrastructure noise.</p></div><button type="button" className="primary-button" onClick={() => onNavigate("searches")}><Radar size={16} /> Run a search</button></div>
      <section className="daily-metric-grid" aria-label="Daily summary">
        <button type="button" onClick={() => onNavigate("discover")}><span className="metric-accent lavender"><Sparkles size={17} /></span><strong>{summary.strongMatches}</strong><span>strong matches</span><small>{summary.newSinceLastVisit} new since last visit</small></button>
        <button type="button" onClick={() => onNavigate("searches")}><span className="metric-accent moss"><Radar size={17} /></span><strong>{summary.activeSearches}</strong><span>active searches</span><small>{summary.expansionAdded} listings observed in expansion</small></button>
        <button type="button" onClick={() => onNavigate("applications")}><span className="metric-accent peach"><Clock3 size={17} /></span><strong>{summary.applicationsNeedingAction}</strong><span>applications need action</span><small>Follow-ups and next steps</small></button>
        <button type="button" onClick={() => onNavigate("sources")}><span className="metric-accent sky"><Globe2 size={17} /></span><strong>{summary.coverageIssues}</strong><span>coverage issues</span><small>{summary.savedJobsClosed} saved jobs closed</small></button>
      </section>

      <div className="home-grid">
        <section className="daily-card home-matches"><div className="daily-card-head"><div><span className="eyebrow">Best current evidence</span><h2>New strong matches</h2></div><button type="button" className="text-button" onClick={() => onNavigate("discover")}>See all <ArrowRight size={14} /></button></div>
          {strong.length ? <div className="compact-job-list">{strong.map((job) => <button type="button" key={job.id} onClick={() => onOpenJob(job)}><span className={`eligibility-dot ${job.eligibilityStatus ?? "unclear"}`} /><div><strong>{job.title}</strong><span>{job.company} · {job.location}</span><small>{job.reasons[0] ?? "Evidence details available"}</small></div><em>{job.score}%</em></button>)}</div> : <EmptyWorkspace icon={<Search size={22} />} title="No strong matches yet" body="Confirm a strategy and run it against the existing index. Unclear jobs will remain visible without being overstated." action={<button type="button" className="secondary-button" onClick={() => onNavigate("searches")}>Open Searches</button>} />}
        </section>

        <section className="daily-card attention-card"><div className="daily-card-head"><div><span className="eyebrow">Inbox</span><h2>Needs attention</h2></div><Bell size={18} /></div>
          {notifications.length ? <div className="notification-list">{notifications.map((notification) => <article key={notification.id} className={notification.readAt ? "read" : "unread"}><button type="button" className="notification-body" onClick={() => { onNotification(notification.id, "read"); onNavigate(notification.targetView); }}><strong>{notification.title}</strong><span>{notification.detail}</span><small>{relativeTime(notification.createdAt)}</small></button><button type="button" aria-label={`Dismiss ${notification.title}`} onClick={() => onNotification(notification.id, "dismiss")}><X size={14} /></button></article>)}</div> : <p className="quiet-copy">You are caught up. RoleAtlas will keep durable, deduplicated alerts here.</p>}
        </section>

        <section className="daily-card weekly-card"><div className="daily-card-head"><div><span className="eyebrow">This week</span><h2>Search summary</h2></div><History size={18} /></div><dl><div><dt>Search runs</dt><dd>{sessions.filter((session) => referenceTime - new Date(session.started_at).getTime() < 7 * 86_400_000).length}</dd></div><div><dt>Results evaluated</dt><dd>{sessions.slice(0, 7).reduce((sum, session) => sum + session.result_count, 0)}</dd></div><div><dt>Unread updates</dt><dd>{summary.unreadNotifications}</dd></div></dl></section>

        <section className="daily-card recent-card"><div className="daily-card-head"><div><span className="eyebrow">Continue where you left off</span><h2>Recently viewed</h2></div></div>{recent.length ? <div className="recent-list">{recent.map((job) => <button type="button" key={job.id} onClick={() => onOpenJob(job)}><strong>{job.title}</strong><span>{job.company}</span><ArrowRight size={14} /></button>)}</div> : <p className="quiet-copy">Jobs you open will stay easy to find here.</p>}</section>
      </div>
    </div>
  );
}

function activeRevision(strategy: StrategyRecord) {
  return strategy.revisions.find((revision) => revision.id === strategy.activeRevisionId) ?? strategy.revisions.at(-1);
}

export function SearchesWorkspace({ strategies, sessions, onSave, onDuplicate, onStatus, onRerun }: { strategies: StrategyRecord[]; sessions: SessionSummary[]; onSave: (plan: SearchPlan, strategyId?: string) => void; onDuplicate: (strategyId: string) => void; onStatus: (strategyId: string, status: StrategyStatus) => void; onRerun: (strategy: StrategyRecord) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftPlan, setDraftPlan] = useState<SearchPlan | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [sessionDetail, setSessionDetail] = useState<{ session?: SessionSummary; source_expansion?: Array<{ state: string }>; execution_counts?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const edit = (strategy: StrategyRecord) => {
    const revision = activeRevision(strategy);
    if (!revision) return;
    setEditing(strategy.id);
    setDraftPlan({ ...revision.plan });
  };

  const inspectSession = async (session: SessionSummary) => {
    setSelectedSession(session);
    setSessionDetail(null);
    try {
      const response = await fetch(`/api/search-sessions/${session.id}`, { cache: "no-store" });
      if (response.ok) setSessionDetail(await response.json() as typeof sessionDetail);
    } catch { /* Summary remains useful when detail polling is unavailable. */ }
  };

  const split = (value: string) => [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
  return (
    <div className="daily-page searches-workspace">
      <div className="daily-hero"><div><span className="eyebrow">Reusable discovery</span><h1>Searches</h1><p>Edit the plan, keep revisions, and rerun the existing index while fresh sources expand in the background.</p></div>{strategies.length > 0 && <button type="button" className="secondary-button" onClick={() => edit(strategies[0])}><Edit3 size={15} /> Edit active strategy</button>}</div>
      <div className="searches-grid"><section className="strategy-list">
        {strategies.length ? strategies.map((strategy) => { const revision = activeRevision(strategy); const latestSession = sessions.find((session) => session.id === strategy.lastSessionId || session.plan_id === revision?.plan.id); return <article className="strategy-card" key={strategy.id}><div className="strategy-card-head"><div><span className={`strategy-status ${strategy.status}`}>{strategy.status}</span><h2>{strategy.name}</h2><p>Version {revision?.version ?? 0} · {revision?.plan.roleQueries.length ?? 0} queries · {revision?.plan.locations.join(", ") || "Open geography"}</p></div><button type="button" className="icon-button" aria-label={`Edit ${strategy.name}`} onClick={() => edit(strategy)}><Edit3 size={16} /></button></div><div className="strategy-tags">{revision?.plan.roleQueries.slice(0, 5).map((query) => <span key={query}>{query}</span>)}</div><div className="strategy-coverage"><div><span>Last run</span><strong>{relativeTime(strategy.lastRunAt ?? latestSession?.started_at)}</strong></div><div><span>New results</span><strong>{latestSession?.result_count ?? 0}</strong></div><div><span>Coverage</span><strong>{latestSession?.coverage?.state ?? "Not checked"}</strong></div><div><span>Sources</span><strong>{latestSession?.coverage?.successful_sources ?? 0}/{latestSession?.coverage?.selected_sources ?? latestSession?.coverage?.successful_sources ?? 0}</strong></div></div><div className="strategy-actions"><button type="button" onClick={() => { setBusy(strategy.id); void onRerun(strategy).finally(() => setBusy(null)); }} disabled={busy === strategy.id}><RefreshCw size={14} />{busy === strategy.id ? "Running…" : "Rerun"}</button><button type="button" onClick={() => edit(strategy)}><Edit3 size={14} /> Edit</button><button type="button" onClick={() => onDuplicate(strategy.id)}><Copy size={14} /> Duplicate</button>{strategy.status === "paused" ? <button type="button" onClick={() => onStatus(strategy.id, "active")}><Play size={14} /> Resume</button> : <button type="button" onClick={() => onStatus(strategy.id, "paused")}><Pause size={14} /> Pause</button>}<button type="button" onClick={() => setCompare(compare === strategy.id ? null : strategy.id)}><History size={14} /> Compare</button><button type="button" onClick={() => onStatus(strategy.id, "archived")}><Archive size={14} /> Archive</button></div>{compare === strategy.id && <div className="revision-list"><strong>Revision history</strong>{strategy.revisions.slice().reverse().map((item) => <div key={item.id}><span>v{item.version} · {item.reason} · {new Date(item.createdAt).toLocaleString()}</span><small>{item.plan.roleQueries.join(" · ")}</small></div>)}</div>}</article>; }) : <EmptyWorkspace icon={<Radar size={23} />} title="No saved search yet" body="Complete onboarding to create an editable deterministic search strategy." />}
      </section>

      <aside className="search-history-panel"><div className="daily-card-head"><div><span className="eyebrow">Persisted engine data</span><h2>Run history</h2></div><Database size={18} /></div>{sessions.length ? <div className="session-list">{sessions.map((session) => <button type="button" key={session.id} className={selectedSession?.id === session.id ? "active" : ""} onClick={() => void inspectSession(session)}><span><strong>{session.result_count} results</strong><small>{relativeTime(session.started_at)} · {session.stage ?? session.status}</small></span><ArrowRight size={14} /></button>)}</div> : <p className="quiet-copy">No persisted search session yet.</p>}</aside></div>

      {editing && draftPlan && <div className="workspace-dialog-backdrop"><section className="workspace-dialog strategy-editor" role="dialog" aria-modal="true" aria-labelledby="strategy-editor-title"><header><div><span className="eyebrow">Human-approved plan</span><h2 id="strategy-editor-title">Edit search strategy</h2></div><button type="button" className="icon-button" aria-label="Close strategy editor" onClick={() => setEditing(null)}><X size={17} /></button></header><div className="workspace-form"><label><span>Name</span><input value={draftPlan.strategyName ?? ""} onChange={(event) => setDraftPlan({ ...draftPlan, strategyName: event.target.value })} /></label><label><span>Primary and adjacent role queries</span><textarea rows={3} value={draftPlan.roleQueries.join(", ")} onChange={(event) => setDraftPlan({ ...draftPlan, roleQueries: split(event.target.value) })} /></label><div className="field-grid two"><label><span>Title synonyms</span><input value={draftPlan.titleSynonyms?.join(", ") ?? ""} onChange={(event) => setDraftPlan({ ...draftPlan, titleSynonyms: split(event.target.value) })} /></label><label><span>Excluded terms</span><input value={draftPlan.excludedTerms?.join(", ") ?? ""} onChange={(event) => setDraftPlan({ ...draftPlan, excludedTerms: split(event.target.value) })} /></label><label><span>Target locations</span><input value={draftPlan.locations.join(", ")} onChange={(event) => setDraftPlan({ ...draftPlan, locations: split(event.target.value) })} /></label><label><span>Freshness days</span><input type="number" min="1" max="365" value={draftPlan.freshnessDays ?? 30} onChange={(event) => setDraftPlan({ ...draftPlan, freshnessDays: Number(event.target.value) || 30 })} /></label></div><div className="inference-note"><Sparkles size={16} /><p>Regenerate uses confirmed profile fields deterministically. Model suggestions, when requested in Settings, are previews until you approve them.</p></div></div><footer><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="primary-button" disabled={!draftPlan.roleQueries.length} onClick={() => { onSave(draftPlan, editing); setEditing(null); }}><Save size={15} /> Save revision</button></footer></section></div>}

      {selectedSession && <div className="workspace-dialog-backdrop"><section className="workspace-dialog session-detail" role="dialog" aria-modal="true" aria-labelledby="session-detail-title"><header><div><span className="eyebrow">Server-persisted progress</span><h2 id="session-detail-title">Search run · {relativeTime(selectedSession.started_at)}</h2></div><button type="button" className="icon-button" aria-label="Close search run details" onClick={() => setSelectedSession(null)}><X size={17} /></button></header><div className="execution-grid">{[
        ["Existing index searched", sessionDetail?.execution_counts?.existing_index_results ?? selectedSession.result_count],
        ["Relevant sources selected", sessionDetail?.execution_counts?.relevant_sources_selected ?? selectedSession.coverage?.selected_sources ?? 0],
        ["Fresh sources reused", sessionDetail?.execution_counts?.fresh_sources_reused ?? 0],
        ["Stale sources scanned", sessionDetail?.execution_counts?.stale_sources_scanned ?? 0],
        ["Listings inspected", sessionDetail?.execution_counts?.listings_inspected ?? 0],
        ["Eligibility evaluated", sessionDetail?.execution_counts?.eligibility_evaluated ?? selectedSession.result_count],
        ["Listings ranked", sessionDetail?.execution_counts?.listings_ranked ?? selectedSession.result_count],
        ["Recommendations produced", sessionDetail?.execution_counts?.recommendations_produced ?? selectedSession.result_count],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className="coverage-claim">{selectedSession.coverage?.source_selection?.claim ?? "Coverage includes configured sources successfully checked for this search. It is not whole-market coverage."}</p></section></div>}
    </div>
  );
}

export function ProfileWorkspace({ candidate, plan, onEdit, onResume }: { candidate: CandidateProfile | null; plan: SearchPlan | null; onEdit: () => void; onResume: () => void }) {
  if (!candidate) return <div className="daily-page"><div className="daily-hero"><div><span className="eyebrow">Your evidence</span><h1>Profile</h1></div></div><EmptyWorkspace icon={<UserRound size={23} />} title="Build your profile" body="Use a resume or enter facts manually. AI is optional." action={<button type="button" className="primary-button" onClick={onEdit}>Start onboarding</button>} /></div>;
  const sections = candidateSections(candidate);
  const fieldList = (fields: Array<{ value: string; confirmed: boolean }>) => fields.length ? fields.map((field) => <span key={field.value} className={field.confirmed ? "confirmed" : "inferred"}>{field.value}<em>{field.confirmed ? "confirmed" : "inferred"}</em></span>) : <p className="quiet-copy">Not provided</p>;
  return <div className="daily-page profile-workspace"><div className="daily-hero"><div><span className="eyebrow">Facts stay separate from intent</span><h1>Profile</h1><p>Review what is evidence, what is a goal, and what is a constraint before it affects a search.</p></div><div className="hero-actions"><button type="button" className="secondary-button" onClick={onResume}><FileText size={15} /> Replace resume</button><button type="button" className="primary-button" onClick={onEdit}><Edit3 size={15} /> Review profile</button></div></div><div className="profile-section-grid"><section className="daily-card"><div className="profile-section-head"><UserRound size={18} /><div><span className="eyebrow">CandidateFacts</span><h2>What you can evidence</h2></div></div><dl className="profile-dl"><div><dt>Name</dt><dd>{candidate.name.value}</dd></div><div><dt>Experience</dt><dd>{candidate.experienceLevel.value}</dd></div><div><dt>Location evidence</dt><dd>{candidate.location?.value ?? "Not provided"}</dd></div></dl><div className="evidence-chips">{fieldList(sections.facts.skills)}</div></section><section className="daily-card"><div className="profile-section-head"><Radar size={18} /><div><span className="eyebrow">CandidateGoals</span><h2>Where you want to go</h2></div></div><h3>Primary roles</h3><div className="evidence-chips">{fieldList(sections.goals.primaryRoleFamilies)}</div><h3>Adjacent roles</h3><div className="evidence-chips">{fieldList(sections.goals.adjacentRoleFamilies)}</div><p>{sections.goals.opportunityTypes.join(" · ") || "Any opportunity type"}</p></section><section className="daily-card"><div className="profile-section-head"><ShieldCheck size={18} /><div><span className="eyebrow">CandidateConstraints</span><h2>Non-negotiables</h2></div></div><dl className="profile-dl"><div><dt>Experience ceiling</dt><dd>{sections.constraints.maximumExperienceYears ?? "None"}</dd></div><div><dt>Excluded terms</dt><dd>{sections.constraints.excludedTerms.join(" · ") || "None"}</dd></div><div><dt>Compensation floor</dt><dd>{sections.constraints.minimumCompensation ? `${sections.constraints.minimumCompensation.currency} ${sections.constraints.minimumCompensation.amount}` : "Not set"}</dd></div></dl></section><section className="daily-card"><div className="profile-section-head"><Settings2 size={18} /><div><span className="eyebrow">CandidatePreferences</span><h2>How results are ordered</h2></div></div><p>{sections.preferences.rankingPriorities.join(" → ")}</p><p>{sections.preferences.workModes.join(" · ") || "Any work mode"} · {sections.preferences.freshnessDays} day freshness</p></section><section className="daily-card mobility-card"><div className="profile-section-head"><MapPin size={18} /><div><span className="eyebrow">CandidateMobility</span><h2>Geography and eligibility facts</h2></div></div><dl className="profile-dl"><div><dt>Residence</dt><dd>{candidate.mobility.residenceCountryCode ?? "Not confirmed"}</dd></div><div><dt>Authorized countries</dt><dd>{candidate.mobility.workAuthorizedCountryCodes.join(" · ") || "Not stated"}</dd></div><div><dt>Sponsorship required</dt><dd>{candidate.mobility.requiresSponsorshipCountryCodes.join(" · ") || "Not stated"}</dd></div><div><dt>Relocation</dt><dd>{candidate.mobility.willingToRelocate ? "Willing" : "Not confirmed / no"}</dd></div></dl><p className="coverage-claim">RoleAtlas never derives authorization or citizenship from residence, nationality, name, university, or resume language.</p></section><section className="daily-card"><div className="profile-section-head"><Search size={18} /><div><span className="eyebrow">SearchStrategy</span><h2>{plan?.strategyName ?? "No active strategy"}</h2></div></div><p>{plan?.roleQueries.join(" · ") || "Complete onboarding to create a strategy."}</p><button type="button" className="secondary-button" onClick={onEdit}>Review profile and strategy</button></section></div></div>;
}

export function SavedWorkspace({ workspace, jobs, onOpen, onUnsave }: { workspace: DailyWorkspace; jobs: Job[]; onOpen: (job: Job) => void; onUnsave: (jobId: string) => void }) {
  const saved = Object.values(workspace.savedJobs);
  return <div className="daily-page"><div className="daily-hero"><div><span className="eyebrow">Shortlist with memory</span><h1>Saved</h1><p>Saved jobs remain visible even when a source closes or a listing leaves the current result set.</p></div></div>{saved.length ? <div className="saved-workspace-list">{saved.map((record) => { const live = jobs.find((job) => job.id === record.jobId); const closed = live?.lifecycleStatus === "closed" || record.snapshot.lifecycleStatus === "closed"; return <article key={record.jobId} className={closed ? "closed" : ""}><div><span className={`source-state ${closed ? "failed" : "healthy"}`}>{closed ? "Closed" : live?.lifecycleStatus === "possibly_closed" ? "Possibly closing" : "Saved"}</span><h2>{live?.title ?? record.snapshot.title}</h2><p>{live?.company ?? record.snapshot.company} · {live?.location ?? record.snapshot.location}</p><small>Saved {relativeTime(record.savedAt)} · {live?.source ?? record.snapshot.source}</small></div><div><button type="button" className="secondary-button" disabled={!live} onClick={() => live && onOpen(live)}>Open</button><a className="secondary-button" href={live?.url ?? record.snapshot.url} target="_blank" rel="noreferrer">Listing <ExternalLink size={14} /></a><button type="button" className="icon-button" aria-label={`Remove ${record.snapshot.title} from saved jobs`} onClick={() => onUnsave(record.jobId)}><Trash2 size={15} /></button></div></article>; })}</div> : <EmptyWorkspace icon={<FileText size={23} />} title="No saved jobs" body="Save a realistic match from Discover and it will stay here with its last known source status." />}</div>;
}

export function ApplicationsWorkspace({ workspace, jobs, onChange }: { workspace: DailyWorkspace; jobs: Job[]; onChange: (jobId: string, patch: Parameters<typeof import("./dailyProduct").updateApplication>[2], summary?: string) => void }) {
  const records = Object.values(workspace.applications);
  const [selected, setSelected] = useState(records[0]?.jobId ?? null);
  const record = selected ? workspace.applications[selected] : null;
  const job = selected ? jobs.find((item) => item.id === selected) ?? workspace.savedJobs[selected]?.snapshot : null;
  return <div className="daily-page applications-workspace"><div className="daily-hero"><div><span className="eyebrow">From saved to outcome</span><h1>Applications</h1><p>Track actions and evidence. RoleAtlas never submits an application for you.</p></div></div>{records.length ? <div className="applications-layout"><aside className="application-list">{APPLICATION_STAGES.map((stage) => { const stageRecords = records.filter((item) => item.stage === stage); if (!stageRecords.length) return null; return <section key={stage}><h2>{stage}<span>{stageRecords.length}</span></h2>{stageRecords.map((item) => { const itemJob = jobs.find((candidate) => candidate.id === item.jobId) ?? workspace.savedJobs[item.jobId]?.snapshot; return <button type="button" key={item.jobId} className={selected === item.jobId ? "active" : ""} onClick={() => setSelected(item.jobId)}><strong>{itemJob?.title ?? "Saved opportunity"}</strong><span>{itemJob?.company ?? item.jobId}</span><small>{item.nextAction || relativeTime(item.updatedAt)}</small></button>; })}</section>; })}</aside>{record && <section className="application-detail daily-card"><div className="daily-card-head"><div><span className="eyebrow">Application record</span><h2>{job?.title ?? "Opportunity"}</h2><p>{job?.company}</p></div><BriefcaseBusiness size={19} /></div><div className="workspace-form"><label><span>Stage</span><select value={record.stage} onChange={(event) => onChange(record.jobId, { stage: event.target.value as DailyApplicationStage })}>{APPLICATION_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label><div className="field-grid two"><label><span>Application date</span><input type="date" value={record.applicationDate ?? ""} onChange={(event) => onChange(record.jobId, { applicationDate: event.target.value || null })} /></label><label><span>Follow-up date</span><input type="date" value={record.followUpDate ?? ""} onChange={(event) => onChange(record.jobId, { followUpDate: event.target.value || null })} /></label></div><label><span>Next action</span><input value={record.nextAction} onChange={(event) => onChange(record.jobId, { nextAction: event.target.value })} /></label><div className="field-grid two"><label><span>Source job status</span><select value={record.sourceJobStatus} onChange={(event) => onChange(record.jobId, { sourceJobStatus: event.target.value as typeof record.sourceJobStatus })}><option value="unknown">Unknown</option><option value="active">Active</option><option value="possibly_closed">Possibly closing</option><option value="closed">Closed</option></select></label><label><span>Contact</span><input value={record.contacts[0] ? `${record.contacts[0].name} — ${record.contacts[0].detail}` : ""} placeholder="Name — email, profile, or role" onChange={(event) => { const [name, ...detail] = event.target.value.split("—"); onChange(record.jobId, { contacts: event.target.value.trim() ? [{ name: name.trim(), detail: detail.join("—").trim() }] : [] }); }} /></label></div><label><span>Notes</span><textarea rows={4} value={record.notes} onChange={(event) => onChange(record.jobId, { notes: event.target.value })} /></label><div className="field-grid two"><label><span>Tailored resume reference</span><input value={record.tailoredResumeReference} onChange={(event) => onChange(record.jobId, { tailoredResumeReference: event.target.value })} /></label><label><span>Cover letter reference</span><input value={record.coverLetterReference} onChange={(event) => onChange(record.jobId, { coverLetterReference: event.target.value })} /></label></div><label><span>Interview preparation</span><textarea rows={3} value={record.interviewPreparation} onChange={(event) => onChange(record.jobId, { interviewPreparation: event.target.value })} /></label></div><div className="activity-timeline"><h3>Activity timeline</h3>{record.activity.map((activity) => <div key={activity.id}><span /><p><strong>{activity.summary}</strong><small>{new Date(activity.at).toLocaleString()}</small></p></div>)}</div></section>}</div> : <EmptyWorkspace icon={<BriefcaseBusiness size={23} />} title="No applications yet" body="Set a saved job to Preparing or Applied to create a full tracking record." />}</div>;
}

type RegistrySource = { id: string; company: string; adapter: string; endpointUrl: string; hiringCountryCodes: string[]; hiringRegionCodes: string[]; health: string; lastVerified: string };
type HealthSource = { id: string; source_type: string; url: string; last_success_at: string | null; last_status: string | null; observed_jobs: number; error: string | null };

export function SourcesWorkspace() {
  const [registry, setRegistry] = useState<RegistrySource[]>([]);
  const [health, setHealth] = useState<Record<string, HealthSource>>({});
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { let cancelled = false; Promise.all([fetch("/api/registry", { cache: "no-store" }).then((response) => response.ok ? response.json() : null), fetch("/api/local-scout?action=sources", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)]).then(([registryPayload, healthPayload]: Array<{ selection?: { sources?: RegistrySource[] }; sources?: HealthSource[] } | null>) => { if (cancelled) return; setRegistry(registryPayload?.selection?.sources ?? []); setHealth(Object.fromEntries((healthPayload?.sources ?? []).map((source) => [source.id, source]))); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);
  const submit = async () => { setMessage("Validating…"); try { const response = await fetch("/api/local-scout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); const payload = await response.json() as { error?: string }; setMessage(response.ok ? "Submitted to the local validator and crawler queue. It is not added to the trusted registry automatically." : payload.error ?? "The source could not be submitted."); if (response.ok) setUrl(""); } catch { setMessage("The complete stack is unavailable; no URL was trusted or queued."); } };
  return <div className="daily-page sources-workspace"><div className="daily-hero"><div><span className="eyebrow">Honest configured coverage</span><h1>Sources</h1><p>See what RoleAtlas is actually configured to check. This is not a claim of whole-market coverage.</p></div></div><div className="source-explainer"><ShieldCheck size={19} /><p><strong>Source relevance can select a board for scanning, but cannot confirm your eligibility for a listing.</strong> Listing-level geography and authorization evidence decide that. Source failures may reduce results.</p></div>{loading ? <div className="daily-loading" role="status">Checking configured sources…</div> : <div className="source-table" role="table" aria-label="Configured job sources"><div role="row" className="source-table-head"><span role="columnheader">Source</span><span role="columnheader">Adapter</span><span role="columnheader">Hiring metadata</span><span role="columnheader">Last scan</span><span role="columnheader">Health</span></div>{registry.map((source) => { const state = health[source.id]; const healthLabel = state?.last_status ?? source.health ?? "unscanned"; return <div role="row" key={source.id}><span role="cell"><strong>{source.company}</strong><small>{source.id}</small></span><span role="cell">{source.adapter}</span><span role="cell">{[...source.hiringCountryCodes, ...source.hiringRegionCodes].join(" · ") || "Listing evidence"}</span><span role="cell">{relativeTime(state?.last_success_at)}</span><span role="cell"><em className={`source-state ${healthLabel === "success" ? "healthy" : healthLabel === "failed" ? "failed" : "experimental"}`}>{healthLabel}</em>{state?.observed_jobs ? <small>{state.observed_jobs} latest listings</small> : null}{state?.error ? <small>{state.error}</small> : null}</span></div>; })}</div>}<section className="daily-card source-submit"><div><span className="eyebrow">Validation request</span><h2>Submit a careers URL</h2><p>The URL is validated and queued only through your local stack. Model-generated URLs never enter the trusted registry automatically.</p></div><div><label><span>Employer careers URL</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://company.example/careers" /></label><button type="button" className="primary-button" disabled={!/^https?:\/\//i.test(url)} onClick={() => void submit()}>Submit for validation</button>{message && <p role="status">{message}</p>}</div></section></div>;
}

export function SettingsWorkspace({ provider, onProvider, aiActivities, status, onRefreshStatus, onStartOnboarding, onResetLearned }: { provider: ProviderConfig; onProvider: () => void; aiActivities: Array<{ id: string; action: string; provider: string; model: string; completedAt: string; outcome: string; dataSent: string[] }>; status: ServiceStatus; onRefreshStatus: () => void; onStartOnboarding: () => void; onResetLearned: () => void }) {
  const mode = serviceMode(status);
  const statuses: Array<[string, keyof ServiceStatus]> = [["Web UI", "web"], ["PostgreSQL", "database"], ["NATS", "nats"], ["Scout API", "scout"], ["Crawler", "crawler"], ["AI provider", "ai"]];
  return <div className="daily-page settings-workspace"><div className="daily-hero"><div><span className="eyebrow">Privacy and setup</span><h1>Settings</h1><p>Know what is local, what is external, and which services are currently available.</p></div></div><section className={`service-banner ${mode}`}><Server size={20} /><div><strong>{mode === "complete" ? "Complete local stack" : mode === "degraded" ? "Degraded mode" : "Transient web-only mode"}</strong><p>{mode === "complete" ? "Search history, workspace state, NATS source expansion, and crawler indexing are available." : mode === "degraded" ? "Existing results may work, but one or more persistence or expansion services are unavailable." : "Public browsing can work, but persistent discovery and source expansion are not available."}</p></div><button type="button" className="secondary-button" onClick={onRefreshStatus}><RefreshCw size={14} /> Recheck</button></section><div className="settings-grid"><section className="daily-card"><div className="daily-card-head"><div><span className="eyebrow">Service detection</span><h2>Local stack status</h2></div><Database size={18} /></div><div className="status-list">{statuses.map(([label, key]) => <div key={key}><span>{label}</span><strong className={String(status[key])}>{String(status[key])}</strong></div>)}</div><p className="coverage-claim">Run <code>npm run doctor</code> for ports, HTTP health, registry, and Docker diagnostics.</p></section><section className="daily-card"><div className="daily-card-head"><div><span className="eyebrow">Optional AI</span><h2>{provider.provider}</h2></div><Sparkles size={18} /></div><p>{providerIsConfigured(provider) ? `${provider.model} · ${verificationIsCurrent(provider) ? "connection verified" : "saved but not verified"}` : "No usable model connection is configured."}</p><button type="button" className="primary-button" onClick={onProvider}>Configure provider and model</button><p className="coverage-claim">Every AI action shows provider, model, purpose, data categories, request location, RoleAtlas network path, and estimated input size before it runs.</p></section><section className="daily-card ai-history-card"><div className="daily-card-head"><div><span className="eyebrow">Transparent requests</span><h2>AI activity history</h2></div><History size={18} /></div>{aiActivities.length ? aiActivities.slice(0, 10).map((activity) => <div key={activity.id}><span className={activity.outcome}>{activity.outcome}</span><strong>{activity.action.replaceAll("_", " ")}</strong><small>{activity.provider} · {activity.model} · {relativeTime(activity.completedAt)}</small><p>Sent: {activity.dataSent.join(", ")}</p></div>) : <p className="quiet-copy">No AI actions recorded on this browser.</p>}</section><section className="daily-card"><div className="daily-card-head"><div><span className="eyebrow">Profile and learning</span><h2>Review onboarding answers</h2></div><Settings2 size={18} /></div><p>Return to any step to edit facts, goals, mobility, constraints, or the deterministic search preview.</p><div className="settings-actions"><button type="button" className="secondary-button" onClick={onStartOnboarding}>Open guided setup</button><button type="button" className="text-button" onClick={onResetLearned}>Reset learned preferences</button></div></section></div></div>;
}
