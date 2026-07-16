"use client";

import { ArrowLeft, ArrowRight, Check, FileText, PencilLine, ShieldCheck, Sparkles, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildCandidateProfile, type CandidateProfile, type EvidenceField, type SearchPlan } from "./candidateProfile";
import {
  ONBOARDING_STEPS,
  adaptiveProfileQuestions,
  blankEvidence,
  createManualProfile,
  manualStrategy,
  type OnboardingDraft,
  type OnboardingStep,
} from "./dailyProduct";
import type { JobType, WorkMode } from "./jobs";
import { COUNTRIES, countryByCodeValue, resolveCountry } from "../shared/geography";

export type ResumeProfile = {
  fileName: string;
  totalPages: number;
  text: string;
  name: string;
  skills: string[];
  suggestedRoles: string[];
  location: string | null;
  headline?: string;
};

type Props = {
  initialDraft: OnboardingDraft;
  onDraftChange: (draft: OnboardingDraft) => void;
  onComplete: (profile: CandidateProfile, plan: SearchPlan, resume: ResumeProfile | null) => Promise<void>;
  onSkip: () => void;
};

const TITLES: Record<OnboardingStep, string> = {
  welcome: "Make RoleAtlas yours",
  "profile-source": "How should we build your profile?",
  "review-facts": "Review the facts",
  "career-goals": "What should this search aim for?",
  "location-eligibility": "Where can and should the work happen?",
  "hard-constraints": "Set the boundaries",
  "strategy-preview": "Review the search strategy",
  "run-search": "Ready for the first search",
};

const STEP_HELP: Record<OnboardingStep, string> = {
  welcome: "A short setup separates what you have done from what you want next. You can edit every answer later.",
  "profile-source": "Use a resume for faster evidence extraction, or enter the same facts manually. AI is not used for either path.",
  "review-facts": "Facts support match explanations. Inferred resume fields stay labelled until you confirm them.",
  "career-goals": "Role families guide discovery; they are not claims about your current experience.",
  "location-eligibility": "Location, authorization, sponsorship, and relocation are kept separate so RoleAtlas never guesses eligibility.",
  "hard-constraints": "Hard constraints protect your time. Preferences only affect ordering and can be changed later.",
  "strategy-preview": "This deterministic strategy works without a model. AI suggestions are optional and always require approval.",
  "run-search": "Existing indexed jobs appear first while relevant stale sources refresh incrementally.",
};

function values(raw: string) {
  return [...new Set(raw.split(/[,\n]/).map((value) => value.trim()).filter(Boolean))];
}

function evidenceValues(items: EvidenceField[]) {
  return items.map((item) => item.value).join(", ");
}

function fields(raw: string, existing: EvidenceField[] = []) {
  return values(raw).map((value) => existing.find((field) => field.value.toLowerCase() === value.toLowerCase()) ?? blankEvidence(value));
}

function stepIndex(step: OnboardingStep) {
  return ONBOARDING_STEPS.indexOf(step);
}

export function OnboardingFlow({ initialDraft, onDraftChange, onComplete, onSkip }: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [resume, setResume] = useState<ResumeProfile | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const profile = draft.profile;
  const plan = draft.strategy;
  const index = stepIndex(draft.currentStep);

  useEffect(() => {
    titleRef.current?.focus();
  }, [draft.currentStep]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onSkip]);

  const adaptiveQuestions = useMemo(() => profile ? adaptiveProfileQuestions(profile, plan) : [], [plan, profile]);

  const commit = (change: Partial<OnboardingDraft>) => {
    const next = { ...draft, ...change, updatedAt: new Date().toISOString() };
    setDraft(next);
    onDraftChange(next);
  };

  const go = (step: OnboardingStep) => {
    const completedSteps = draft.currentStep === step ? draft.completedSteps : [...new Set([...draft.completedSteps, draft.currentStep])];
    commit({ currentStep: step, completedSteps });
  };

  const back = () => {
    if (index > 0) go(ONBOARDING_STEPS[index - 1]);
  };

  const chooseManual = () => {
    const manual = createManualProfile();
    goWith({ profileSource: "manual", profile: manual, strategy: manualStrategy(manual, { primaryRoles: [] }) }, "review-facts");
  };

  const goWith = (change: Partial<OnboardingDraft>, step: OnboardingStep) => {
    const next = { ...draft, ...change, currentStep: step, completedSteps: [...new Set([...draft.completedSteps, draft.currentStep])], updatedAt: new Date().toISOString() };
    setDraft(next);
    onDraftChange(next);
  };

  const readResume = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("resume", file);
      const response = await fetch("/api/resume", { method: "POST", body: form });
      const payload = await response.json() as ResumeProfile & { error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "The resume could not be read.");
      const extracted = buildCandidateProfile(payload);
      const strategy = manualStrategy(extracted, {
        primaryRoles: extracted.targetRoles.map((role) => role.value),
        opportunityTypes: extracted.goals?.opportunityTypes,
        maxExperience: extracted.constraints?.maximumExperienceYears,
        locations: extracted.location?.value ? [extracted.location.value] : [],
      });
      setResume(payload);
      goWith({ profileSource: "resume", profile: extracted, strategy }, "review-facts");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The resume could not be read.");
    } finally {
      setBusy(false);
    }
  };

  const updateProfile = (next: CandidateProfile) => {
    const nextPlan = draft.strategy ? { ...draft.strategy, mobility: next.mobility } : null;
    commit({ profile: { ...next, updatedAt: new Date().toISOString() }, strategy: nextPlan });
  };

  const confirmFacts = () => {
    if (!profile) return;
    const facts = profile.facts ?? { name: profile.name, location: profile.location, skills: profile.skills, experienceLevel: profile.experienceLevel, education: [], certifications: [], graduationDate: null, leadershipScope: null };
    const confirmed = (field: EvidenceField) => ({ ...field, confirmed: true });
    const nextFacts = { ...facts, name: confirmed(facts.name), location: facts.location ? confirmed(facts.location) : null, skills: facts.skills.map(confirmed), experienceLevel: confirmed(facts.experienceLevel), education: facts.education.map(confirmed), certifications: facts.certifications.map(confirmed), graduationDate: facts.graduationDate ? confirmed(facts.graduationDate) : null, leadershipScope: facts.leadershipScope ? confirmed(facts.leadershipScope) : null };
    updateProfile({ ...profile, name: nextFacts.name, location: nextFacts.location, skills: nextFacts.skills, experienceLevel: nextFacts.experienceLevel, facts: nextFacts });
    go("career-goals");
  };

  const strategyFor = (nextProfile = profile) => {
    if (!nextProfile) return null;
    const goals = nextProfile.goals;
    const next = manualStrategy(nextProfile, {
      primaryRoles: goals?.primaryRoleFamilies.map((role) => role.value) ?? nextProfile.targetRoles.map((role) => role.value),
      adjacentRoles: goals?.adjacentRoleFamilies.map((role) => role.value) ?? [],
      titleSynonyms: draft.strategy?.titleSynonyms,
      excludedTerms: nextProfile.constraints?.excludedTerms,
      opportunityTypes: goals?.opportunityTypes,
      workModes: nextProfile.preferences?.workModes,
      maxExperience: nextProfile.constraints?.maximumExperienceYears,
      locations: draft.strategy?.locations ?? (nextProfile.location?.value ? [nextProfile.location.value] : []),
      freshnessDays: nextProfile.preferences?.freshnessDays,
    });
    return { ...next, id: draft.strategy?.id, profileId: draft.strategy?.profileId, strategyName: draft.strategy?.strategyName ?? next.strategyName };
  };

  const rebuildStrategy = (nextProfile = profile) => {
    const next = strategyFor(nextProfile);
    if (next) commit({ strategy: next });
  };

  const finish = async () => {
    if (!profile || !plan || !plan.roleQueries.length) return;
    setBusy(true);
    setError("");
    try {
      await onComplete(profile, { ...plan, confirmedAt: new Date().toISOString(), strategyStatus: "active" }, resume);
      commit({ completedAt: new Date().toISOString() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The first search could not start.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-backdrop" role="presentation">
      <section className="onboarding-shell" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <aside className="onboarding-progress" aria-label="Onboarding progress">
          <div className="onboarding-brand"><span>RA</span><strong>RoleAtlas</strong></div>
          <ol>
            {ONBOARDING_STEPS.map((step, position) => (
              <li key={step} className={position === index ? "current" : position < index || draft.completedSteps.includes(step) ? "complete" : ""}>
                <button type="button" onClick={() => position <= index || draft.completedSteps.includes(step) ? go(step) : undefined} disabled={position > index && !draft.completedSteps.includes(step)} aria-current={position === index ? "step" : undefined}>
                  <span>{position < index || draft.completedSteps.includes(step) ? <Check size={13} /> : position + 1}</span>{TITLES[step]}
                </button>
              </li>
            ))}
          </ol>
          <p>Progress is saved on this device and, when the complete stack is available, in your local RoleAtlas database.</p>
        </aside>

        <div className="onboarding-main">
          <header>
            <div><span className="eyebrow">Step {index + 1} of {ONBOARDING_STEPS.length}</span><h1 id="onboarding-title" ref={titleRef} tabIndex={-1}>{TITLES[draft.currentStep]}</h1><p>{STEP_HELP[draft.currentStep]}</p></div>
            <button type="button" className="icon-button" aria-label="Skip onboarding for now" onClick={onSkip}><X size={19} /></button>
          </header>

          <div className="onboarding-content">
            {draft.currentStep === "welcome" && (
              <div className="welcome-step">
                <div className="welcome-mark"><Sparkles size={28} /></div>
                <h2>One honest profile. Reusable searches. A calmer daily radar.</h2>
                <p>RoleAtlas will show what it knows, what it inferred, and what remains unclear. It will never infer citizenship, work authorization, salary expectations, or relocation willingness.</p>
                <div className="onboarding-assurances"><span><ShieldCheck size={16} /> AI stays optional</span><span><Check size={16} /> Works with the local engine</span><span><Check size={16} /> Edit anything later</span></div>
              </div>
            )}

            {draft.currentStep === "profile-source" && (
              <div className="source-choice-grid">
                <article><div className="choice-icon"><UploadCloud size={22} /></div><h2>Use my resume</h2><p>Extract evidence from a text-based PDF, then confirm every important field before searching.</p><label className="onboarding-file"><input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span>{file?.name ?? "Choose PDF"}</span></label><button type="button" className="primary-button" disabled={!file || busy} onClick={() => void readResume()}>{busy ? "Reading resume…" : "Review extracted facts"}<ArrowRight size={15} /></button></article>
                <article><div className="choice-icon peach"><PencilLine size={22} /></div><h2>Create it manually</h2><p>Enter only the facts and goals that matter. Nothing is sent to a model.</p><button type="button" className="secondary-button" onClick={chooseManual}>Start a manual profile<ArrowRight size={15} /></button></article>
              </div>
            )}

            {draft.currentStep === "review-facts" && profile && (
              <div className="onboarding-form">
                <div className="field-grid two">
                  <label><span>Name <em>{profile.name.confirmed ? "Confirmed" : profile.name.origin === "resume" ? "Inferred from resume" : "Not confirmed"}</em></span><input value={profile.name.value} onChange={(event) => updateProfile({ ...profile, name: { ...profile.name, value: event.target.value, origin: profile.name.origin ?? "manual" }, facts: { ...(profile.facts!), name: { ...profile.name, value: event.target.value } } })} /></label>
                  <label><span>Experience level <em>{profile.experienceLevel.confirmed ? "Confirmed" : "Needs review"}</em></span><input value={profile.experienceLevel.value} onChange={(event) => updateProfile({ ...profile, experienceLevel: { ...profile.experienceLevel, value: event.target.value }, facts: { ...(profile.facts!), experienceLevel: { ...profile.experienceLevel, value: event.target.value } } })} /></label>
                </div>
                <label><span>Skills and evidence <em>{profile.skills.some((skill) => !skill.confirmed) ? "Inferred fields" : "Confirmed"}</em></span><textarea rows={3} value={evidenceValues(profile.skills)} onChange={(event) => { const next = fields(event.target.value, profile.skills); updateProfile({ ...profile, skills: next, facts: { ...(profile.facts!), skills: next } }); }} /></label>
                <div className="field-grid two">
                  <label><span>Education</span><input value={evidenceValues(profile.facts?.education ?? [])} onChange={(event) => updateProfile({ ...profile, facts: { ...(profile.facts!), education: fields(event.target.value, profile.facts?.education) } })} placeholder="Degree, programme, or training" /></label>
                  <label><span>Certifications or licenses</span><input value={evidenceValues(profile.facts?.certifications ?? [])} onChange={(event) => updateProfile({ ...profile, facts: { ...(profile.facts!), certifications: fields(event.target.value, profile.facts?.certifications) } })} placeholder="Only credentials you hold" /></label>
                </div>
                {profile.skills.some((skill) => !skill.confirmed) && <div className="inference-note"><FileText size={17} /><p><strong>Resume evidence is still inferred.</strong> Review the values above, then confirm them. Editing a value does not automatically make unrelated fields true.</p></div>}
              </div>
            )}

            {draft.currentStep === "career-goals" && profile && (
              <div className="onboarding-form">
                <label><span>Primary role families <em>Required</em></span><textarea rows={2} value={evidenceValues(profile.goals?.primaryRoleFamilies ?? profile.targetRoles)} onChange={(event) => { const primary = fields(event.target.value, profile.goals?.primaryRoleFamilies ?? profile.targetRoles); const next = { ...profile, targetRoles: primary, goals: { ...(profile.goals!), primaryRoleFamilies: primary } }; updateProfile(next); }} placeholder="Policy research, product design, laboratory operations…" /></label>
                <label><span>Adjacent role families <em>Optional</em></span><textarea rows={2} value={evidenceValues(profile.goals?.adjacentRoleFamilies ?? [])} onChange={(event) => updateProfile({ ...profile, goals: { ...(profile.goals!), adjacentRoleFamilies: fields(event.target.value, profile.goals?.adjacentRoleFamilies) } })} placeholder="Related paths you would genuinely consider" /></label>
                <fieldset><legend>Opportunity types</legend><div className="choice-chips">{(["Internship", "Entry-level", "Apprenticeship", "Full-time", "Part-time", "Contract", "Unknown"] as JobType[]).map((type) => <label key={type}><input type="checkbox" checked={profile.goals?.opportunityTypes.includes(type) ?? false} onChange={() => { const current = profile.goals?.opportunityTypes ?? []; updateProfile({ ...profile, goals: { ...(profile.goals!), opportunityTypes: current.includes(type) ? current.filter((item) => item !== type) : [...current, type] } }); }} /><span>{type}</span></label>)}</div></fieldset>
                {adaptiveQuestions.length > 0 && <div className="adaptive-question-list"><span className="eyebrow">Questions based on your answers</span>{adaptiveQuestions.map((question) => <p key={question}>{question}</p>)}</div>}
              </div>
            )}

            {draft.currentStep === "location-eligibility" && profile && (
              <div className="onboarding-form">
                <datalist id="country-options">{COUNTRIES.map((item) => <option key={item.code} value={item.name} />)}</datalist>
                <div className="field-grid two">
                  <label><span>Country of residence <em>Not authorization</em></span><input list="country-options" value={countryByCodeValue(profile.mobility.residenceCountryCode)?.name ?? ""} onChange={(event) => { const code = resolveCountry(event.target.value)?.code ?? null; updateProfile({ ...profile, mobility: { ...profile.mobility, residenceCountryCode: code, confirmedFields: [...new Set([...profile.mobility.confirmedFields, "residenceCountryCode"])], inferredFields: profile.mobility.inferredFields.filter((field) => field !== "residenceCountryCode") } }); }} placeholder="Choose or type a country" /></label>
                  <label><span>Target countries</span><input value={profile.mobility.preferredCountryCodes.map((code) => countryByCodeValue(code)?.name ?? code).join(", ")} onChange={(event) => updateProfile({ ...profile, mobility: { ...profile.mobility, preferredCountryCodes: values(event.target.value).map((value) => resolveCountry(value)?.code).filter((code): code is string => Boolean(code)), confirmedFields: [...new Set([...profile.mobility.confirmedFields, "preferredCountryCodes"])] } })} placeholder="Any country, or list targets" /></label>
                  <label><span>Countries where you already have work authorization <em>Never inferred</em></span><input value={profile.mobility.workAuthorizedCountryCodes.map((code) => countryByCodeValue(code)?.name ?? code).join(", ")} onChange={(event) => updateProfile({ ...profile, mobility: { ...profile.mobility, workAuthorizedCountryCodes: values(event.target.value).map((value) => resolveCountry(value)?.code).filter((code): code is string => Boolean(code)), confirmedFields: [...new Set([...profile.mobility.confirmedFields, "workAuthorizedCountryCodes"])] } })} /></label>
                  <label><span>Countries where sponsorship is required <em>Never inferred</em></span><input value={profile.mobility.requiresSponsorshipCountryCodes.map((code) => countryByCodeValue(code)?.name ?? code).join(", ")} onChange={(event) => updateProfile({ ...profile, mobility: { ...profile.mobility, requiresSponsorshipCountryCodes: values(event.target.value).map((value) => resolveCountry(value)?.code).filter((code): code is string => Boolean(code)), confirmedFields: [...new Set([...profile.mobility.confirmedFields, "requiresSponsorshipCountryCodes"])] } })} /></label>
                </div>
                <fieldset><legend>Mobility</legend><div className="stacked-checks"><label><input type="checkbox" checked={profile.mobility.willingToRelocate} onChange={(event) => updateProfile({ ...profile, mobility: { ...profile.mobility, willingToRelocate: event.target.checked, confirmedFields: [...new Set([...profile.mobility.confirmedFields, "willingToRelocate"])] } })} /> I am willing to relocate</label></div></fieldset>
                <div className="field-grid two">
                  <label><span>Preferred timezones</span><input value={profile.mobility.preferredTimezones.join(", ")} onChange={(event) => updateProfile({ ...profile, mobility: { ...profile.mobility, preferredTimezones: values(event.target.value), confirmedFields: [...new Set([...profile.mobility.confirmedFields, "preferredTimezones"])] } })} placeholder="Asia/Kolkata, Europe/London…" /></label>
                  <label><span>Maximum timezone difference</span><input type="number" min="0" max="12" value={profile.mobility.maximumTimezoneDifferenceHours ?? ""} onChange={(event) => updateProfile({ ...profile, mobility: { ...profile.mobility, maximumTimezoneDifferenceHours: event.target.value ? Number(event.target.value) : null, confirmedFields: [...new Set([...profile.mobility.confirmedFields, "maximumTimezoneDifferenceHours"])] } })} placeholder="Hours" /></label>
                </div>
              </div>
            )}

            {draft.currentStep === "hard-constraints" && profile && (
              <div className="onboarding-form">
                <div className="field-grid two">
                  <label><span>Maximum experience requested</span><input type="number" min="0" max="30" value={profile.constraints?.maximumExperienceYears ?? ""} onChange={(event) => updateProfile({ ...profile, constraints: { ...(profile.constraints!), maximumExperienceYears: event.target.value ? Number(event.target.value) : null } })} placeholder="No ceiling" /></label>
                  <label><span>Freshness threshold</span><input type="number" min="1" max="365" value={profile.preferences?.freshnessDays ?? 30} onChange={(event) => updateProfile({ ...profile, preferences: { ...(profile.preferences!), freshnessDays: Number(event.target.value) || 30 } })} /></label>
                </div>
                <label><span>Excluded title terms</span><input value={profile.constraints?.excludedTerms.join(", ") ?? ""} onChange={(event) => updateProfile({ ...profile, constraints: { ...(profile.constraints!), excludedTerms: values(event.target.value) } })} placeholder="Senior, commission-only…" /></label>
                <label><span>Companies to exclude</span><input value={profile.constraints?.excludedCompanies.join(", ") ?? ""} onChange={(event) => updateProfile({ ...profile, constraints: { ...(profile.constraints!), excludedCompanies: values(event.target.value) } })} /></label>
                <fieldset><legend>Work-mode preferences</legend><div className="choice-chips">{(["Remote", "Hybrid", "On-site"] as WorkMode[]).map((mode) => <label key={mode}><input type="checkbox" checked={profile.preferences?.workModes.includes(mode) ?? false} onChange={() => { const current = profile.preferences?.workModes ?? []; updateProfile({ ...profile, preferences: { ...(profile.preferences!), workModes: current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode] } }); }} /><span>{mode}</span></label>)}</div></fieldset>
                <div className="inference-note"><ShieldCheck size={17} /><p><strong>Hard facts stay yours.</strong> Feedback may suggest a preference or strategy change, but it never changes authorization, citizenship, experience, or relocation facts.</p></div>
              </div>
            )}

            {draft.currentStep === "strategy-preview" && profile && plan && (
              <div className="onboarding-form strategy-preview-form">
                <div className="strategy-summary"><div><span>Existing index</span><strong>Searched immediately</strong></div><div><span>Relevant sources</span><strong>Selected from verified registry</strong></div><div><span>AI</span><strong>Not required</strong></div></div>
                <label><span>Strategy name</span><input value={plan.strategyName ?? "My search"} onChange={(event) => commit({ strategy: { ...plan, strategyName: event.target.value } })} /></label>
                <label><span>Search queries</span><textarea rows={3} value={plan.roleQueries.join(", ")} onChange={(event) => commit({ strategy: { ...plan, roleQueries: values(event.target.value) } })} /></label>
                <div className="field-grid two"><label><span>Title synonyms</span><input value={plan.titleSynonyms?.join(", ") ?? ""} onChange={(event) => commit({ strategy: { ...plan, titleSynonyms: values(event.target.value) } })} /></label><label><span>Excluded terms</span><input value={plan.excludedTerms?.join(", ") ?? ""} onChange={(event) => commit({ strategy: { ...plan, excludedTerms: values(event.target.value) } })} /></label></div>
                <button type="button" className="text-button" onClick={() => rebuildStrategy()}><Sparkles size={15} /> Regenerate deterministically from confirmed answers</button>
              </div>
            )}

            {draft.currentStep === "run-search" && profile && plan && (
              <div className="run-search-step">
                <div className="run-search-icon"><Check size={30} /></div><h2>{plan.strategyName || "Your search"} is ready</h2><p>RoleAtlas will search the full existing index, rank eligible results, show unclear eligibility honestly, and refresh selected sources without holding back existing matches.</p>
                <dl><div><dt>Role queries</dt><dd>{plan.roleQueries.length}</dd></div><div><dt>Target geography</dt><dd>{plan.locations.length || profile.mobility.preferredCountryCodes.length || "Open"}</dd></div><div><dt>Opportunity types</dt><dd>{plan.jobTypes.length || "Any"}</dd></div><div><dt>AI calls</dt><dd>None</dd></div></dl>
              </div>
            )}

            {error && <p className="onboarding-error" role="alert">{error}</p>}
          </div>

          <footer>
            <button type="button" className="text-button" onClick={onSkip}>Finish later</button>
            <div>{index > 0 && <button type="button" className="secondary-button" onClick={back}><ArrowLeft size={15} /> Back</button>}
              {draft.currentStep === "welcome" && <button type="button" className="primary-button" onClick={() => go("profile-source")}>Set up my radar<ArrowRight size={15} /></button>}
              {draft.currentStep === "review-facts" && <button type="button" className="primary-button" disabled={!profile?.name.value} onClick={confirmFacts}>Confirm facts<ArrowRight size={15} /></button>}
              {draft.currentStep === "career-goals" && <button type="button" className="primary-button" disabled={!(profile?.goals?.primaryRoleFamilies.length ?? profile?.targetRoles.length)} onClick={() => { const next = strategyFor(); if (next) goWith({ strategy: next }, "location-eligibility"); }}>Continue<ArrowRight size={15} /></button>}
              {draft.currentStep === "location-eligibility" && <button type="button" className="primary-button" onClick={() => go("hard-constraints")}>Continue<ArrowRight size={15} /></button>}
              {draft.currentStep === "hard-constraints" && <button type="button" className="primary-button" onClick={() => { const next = strategyFor(); if (next) goWith({ strategy: next }, "strategy-preview"); }}>Build strategy<ArrowRight size={15} /></button>}
              {draft.currentStep === "strategy-preview" && <button type="button" className="primary-button" disabled={!plan?.roleQueries.length} onClick={() => go("run-search")}>Approve strategy<ArrowRight size={15} /></button>}
              {draft.currentStep === "run-search" && <button type="button" className="primary-button" disabled={busy || !plan?.roleQueries.length} onClick={() => void finish()}>{busy ? "Starting search…" : "Run first search"}<ArrowRight size={15} /></button>}
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
