"use client";

import { useState } from "react";
import { ArrowRight, ClipboardCheck, X } from "lucide-react";
import { emptyCandidateMobility, type CandidateProfile, type EvidenceField, type SearchPlan } from "../candidateProfile";
import type { JobType } from "../jobs";
import { liteCountryByCode, resolveLiteCountry } from "../../shared/geography-lite";
import type { GeographicLocation } from "../../shared/geography";
import { useDialogFocus } from "../useDialogFocus";

export function ProfileReviewModal({ profile, plan, onClose, onConfirm }: { profile: CandidateProfile; plan: SearchPlan; onClose: () => void; onConfirm: (profile: CandidateProfile, plan: SearchPlan) => Promise<void> }) {
  const [name, setName] = useState(profile.name.value);
  const [location, setLocation] = useState(profile.location?.value ?? "");
  const [skills, setSkills] = useState(profile.skills.map((item) => item.value).join(", "));
  const [roles, setRoles] = useState(plan.roleQueries.join(", "));
  const [jobTypes, setJobTypes] = useState(plan.jobTypes);
  const [maxExperience, setMaxExperience] = useState(plan.maxExperience === null ? "" : String(plan.maxExperience));
  const [workAuthorization, setWorkAuthorization] = useState((profile.mobility?.workAuthorizedCountryCodes ?? []).map((code) => liteCountryByCode(code)?.name ?? code).join(", "));
  const [sponsorshipNeeded, setSponsorshipNeeded] = useState((profile.mobility?.requiresSponsorshipCountryCodes ?? []).map((code) => liteCountryByCode(code)?.name ?? code).join(", "));
  const [willingToRelocate, setWillingToRelocate] = useState(profile.mobility?.willingToRelocate ?? false);
  const [relocationCountries, setRelocationCountries] = useState((profile.mobility?.relocationCountryCodes ?? []).map((code) => liteCountryByCode(code)?.name ?? code).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const values = (input: string) => [...new Set(input.split(",").map((value) => value.trim()).filter(Boolean))];
  const countryCodes = (input: string) => [...new Set(values(input).map((value) => resolveLiteCountry(value)?.code).filter((code): code is string => Boolean(code)))];
  const confirmedField = (value: string, original?: EvidenceField): EvidenceField => ({ value, confidence: original?.value === value ? original.confidence : 1, evidence: original?.value === value ? original.evidence : "Edited and confirmed by you.", confirmed: true });
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      // Lite dataset resolves exact names/codes in-process; anything else
      // asks the server, whose full alias corpus stays out of this bundle.
      const normalizedLocation = location
        ? resolveLiteCountry(location)
          ? {
            raw: location,
            city: null,
            subdivisionCode: null,
            subdivisionName: null,
            countryCode: resolveLiteCountry(location)?.code ?? null,
            regionCodes: [],
            timezone: null,
            confidence: 0.9,
            evidence: ["Matched an exact country name or code."],
          } satisfies GeographicLocation
          : await fetch(`/api/geography/resolve?raw=${encodeURIComponent(location)}`, { cache: "no-store" })
            .then((response) => response.ok ? response.json() as Promise<GeographicLocation | null> : null)
            .catch(() => null)
        : null;
      const confirmedMobilityFields = ["residenceCountryCode", "preferredCountryCodes", "preferredCities", ...(normalizedLocation?.timezone ? ["preferredTimezones"] : [])];
      const mobility = {
        ...(profile.mobility ?? plan.mobility ?? emptyCandidateMobility()),
        residenceCountryCode: normalizedLocation?.countryCode ?? null,
        preferredCountryCodes: normalizedLocation?.countryCode ? [normalizedLocation.countryCode] : [],
        preferredCities: normalizedLocation ? [normalizedLocation] : [],
        preferredTimezones: normalizedLocation?.timezone ? [normalizedLocation.timezone] : [],
        workAuthorizedCountryCodes: countryCodes(workAuthorization),
        requiresSponsorshipCountryCodes: countryCodes(sponsorshipNeeded),
        willingToRelocate,
        relocationCountryCodes: willingToRelocate ? countryCodes(relocationCountries) : [],
        inferredFields: (profile.mobility?.inferredFields ?? []).filter((field) => !confirmedMobilityFields.includes(field)),
        confirmedFields: [...new Set([...(profile.mobility?.confirmedFields ?? []), ...confirmedMobilityFields, "workAuthorizedCountryCodes", "requiresSponsorshipCountryCodes", "willingToRelocate", "relocationCountryCodes"])],
      };
      const nextProfile: CandidateProfile = {
        ...profile,
        name: confirmedField(name, profile.name),
        location: location ? confirmedField(location, profile.location ?? undefined) : null,
        skills: values(skills).map((value) => confirmedField(value, profile.skills.find((item) => item.value === value))),
        targetRoles: values(roles).map((value) => confirmedField(value, profile.targetRoles.find((item) => item.value === value))),
        experienceLevel: { ...profile.experienceLevel, confirmed: true },
        mobility,
        updatedAt: new Date().toISOString(),
      };
      const nextPlan: SearchPlan = { ...plan, roleQueries: values(roles), locations: location ? [location] : [], jobTypes, maxExperience: maxExperience === "" ? null : Number(maxExperience), mobility, confirmedAt: new Date().toISOString() };
      await onConfirm(nextProfile, nextPlan);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The profile could not be saved.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="resume-modal profile-review-modal" role="dialog" aria-modal="true" aria-labelledby="profile-review-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div className="modal-title-wrap"><div className="modal-icon mint"><ClipboardCheck size={20} /></div><div><span className="eyebrow">Review before search</span><h2 id="profile-review-title">Confirm what RoleAtlas found</h2></div></div><button type="button" className="icon-button" aria-label="Close profile review" onClick={onClose}><X size={19} /></button></div>
        <p className="modal-intro">Every inferred field is editable. Confidence describes extraction certainty, not your ability.</p>
        <div className="provider-grid">
          <label><span>Name · {Math.round(profile.name.confidence * 100)}% extraction confidence</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Preferred location · {Math.round((profile.location?.confidence ?? 0) * 100)}% confidence</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Add only if you want a location constraint" /></label>
        </div>
        <label className="profile-text-field"><span>Skills (comma separated)</span><input value={skills} onChange={(event) => setSkills(event.target.value)} /></label>
        <label className="profile-text-field"><span>Role searches (comma separated)</span><input value={roles} onChange={(event) => setRoles(event.target.value)} /></label>
        <div className="provider-grid">
          <label><span>Countries where you already have work authorization</span><input value={workAuthorization} onChange={(event) => setWorkAuthorization(event.target.value)} placeholder="For example: India, Canada" /></label>
          <label><span>Countries where you would need sponsorship</span><input value={sponsorshipNeeded} onChange={(event) => setSponsorshipNeeded(event.target.value)} placeholder="Leave blank when not applicable" /></label>
        </div>
        <div className="profile-plan-row"><div><span className="eyebrow">Relocation</span><label><input type="checkbox" checked={willingToRelocate} onChange={(event) => setWillingToRelocate(event.target.checked)} />I am willing to relocate</label></div>{willingToRelocate && <label><span>Relocation countries</span><input value={relocationCountries} onChange={(event) => setRelocationCountries(event.target.value)} placeholder="Any, or list countries" /></label>}</div>
        <p className="modal-intro">RoleAtlas never infers citizenship, visas, or work authorization from your résumé. These answers are used only for geographic eligibility.</p>
        <div className="profile-evidence-list">{[...profile.skills.slice(0, 3), ...profile.targetRoles.slice(0, 2)].map((item) => <div key={`${item.value}-${item.evidence}`}><strong>{item.value} · {Math.round(item.confidence * 100)}%</strong><p>{item.evidence}</p></div>)}</div>
        <div className="profile-plan-row"><div><span className="eyebrow">Opportunity types</span>{(["Internship", "Entry-level", "Apprenticeship", "Full-time", "Part-time", "Contract", "Unknown"] as JobType[]).map((type) => <label key={type}><input type="checkbox" checked={jobTypes.includes(type)} onChange={() => setJobTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type])} />{type}</label>)}</div><label><span>Maximum experience requested</span><input type="number" min="0" max="20" value={maxExperience} onChange={(event) => setMaxExperience(event.target.value)} placeholder="No ceiling" /></label></div>
        {error && <p className="resume-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Review later</button><button type="button" className="primary-button" disabled={saving || values(roles).length === 0} onClick={() => void confirm()}>{saving ? "Saving profile…" : "Confirm and find roles"}<ArrowRight size={15} /></button></div>
      </section>
    </div>
  );
}
