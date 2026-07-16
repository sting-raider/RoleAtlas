import { normalizeGeographicLocation, type GeographicLocation } from "../shared/geography.ts";

export type EvidenceField = {
  value: string;
  confidence: number;
  evidence: string;
  confirmed: boolean;
};

export type CandidateProfile = {
  id?: string;
  name: EvidenceField;
  location: EvidenceField | null;
  skills: EvidenceField[];
  targetRoles: EvidenceField[];
  experienceLevel: EvidenceField;
  mobility: CandidateMobility;
  sourceFile: string;
  updatedAt: string;
};

export type CandidateMobility = {
  residenceCountryCode: string | null;
  citizenshipCountryCodes: string[];
  workAuthorizedCountryCodes: string[];
  requiresSponsorshipCountryCodes: string[];
  preferredCountryCodes: string[];
  excludedCountryCodes: string[];
  preferredCities: GeographicLocation[];
  willingToRelocate: boolean;
  relocationCountryCodes: string[];
  preferredTimezones: string[];
  maximumTimezoneDifferenceHours: number | null;
  inferredFields: string[];
  confirmedFields: string[];
};

export function emptyCandidateMobility(): CandidateMobility {
  return {
    residenceCountryCode: null,
    citizenshipCountryCodes: [],
    workAuthorizedCountryCodes: [],
    requiresSponsorshipCountryCodes: [],
    preferredCountryCodes: [],
    excludedCountryCodes: [],
    preferredCities: [],
    willingToRelocate: false,
    relocationCountryCodes: [],
    preferredTimezones: [],
    maximumTimezoneDifferenceHours: null,
    inferredFields: [],
    confirmedFields: [],
  };
}

export type SearchPlan = {
  id?: string;
  profileId?: string;
  roleQueries: string[];
  locations: string[];
  jobTypes: string[];
  workModes: string[];
  maxExperience: number | null;
  noDegreeRequired: boolean;
  mobility: CandidateMobility;
  generatedAt: string;
  confirmedAt: string | null;
};

type ResumeInput = {
  fileName: string;
  text: string;
  name: string;
  skills: string[];
  suggestedRoles: string[];
  location: string | null;
};

function evidenceFor(text: string, value: string) {
  const normalized = text.replace(/\s+/g, " ");
  const index = normalized.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return "Inferred from related résumé evidence; please confirm.";
  return normalized.slice(Math.max(0, index - 55), Math.min(normalized.length, index + value.length + 85)).trim();
}

function field(value: string, text: string, confidence: number): EvidenceField {
  return { value, confidence, evidence: evidenceFor(text, value), confirmed: false };
}

export function buildCandidateProfile(resume: ResumeInput): CandidateProfile {
  const earlyCareer = /\b(intern|student|graduate|fresher|entry[- ]level|coursework|university|college)\b/i.test(resume.text);
  const years = [...resume.text.matchAll(/\b(\d{1,2})\+?\s+years?\b/gi)].map((match) => Number(match[1])).filter((value) => value <= 20);
  const level = earlyCareer ? "Early career / internship" : years.length ? `${Math.max(...years)} years indicated` : "Experience level not confirmed";
  const normalizedLocation = resume.location ? normalizeGeographicLocation(resume.location) : null;
  return {
    name: field(resume.name || "Candidate", resume.text, resume.name ? 0.78 : 0.35),
    location: resume.location ? field(resume.location, resume.text, 0.72) : null,
    skills: resume.skills.map((skill) => field(skill, resume.text, 0.9)),
    targetRoles: resume.suggestedRoles.map((role) => field(role, resume.text, 0.68)),
    experienceLevel: field(level, resume.text, earlyCareer || years.length ? 0.7 : 0.3),
    mobility: {
      residenceCountryCode: normalizedLocation?.countryCode ?? null,
      citizenshipCountryCodes: [],
      workAuthorizedCountryCodes: [],
      requiresSponsorshipCountryCodes: [],
      preferredCountryCodes: normalizedLocation?.countryCode ? [normalizedLocation.countryCode] : [],
      excludedCountryCodes: [],
      preferredCities: normalizedLocation ? [normalizedLocation] : [],
      willingToRelocate: false,
      relocationCountryCodes: [],
      preferredTimezones: normalizedLocation?.timezone ? [normalizedLocation.timezone] : [],
      maximumTimezoneDifferenceHours: null,
      inferredFields: normalizedLocation ? ["residenceCountryCode", "preferredCountryCodes", "preferredCities", ...(normalizedLocation.timezone ? ["preferredTimezones"] : [])] : [],
      confirmedFields: [],
    },
    sourceFile: resume.fileName,
    updatedAt: new Date().toISOString(),
  };
}

export function buildSearchPlan(profile: CandidateProfile): SearchPlan {
  const earlyCareer = /early career|internship|not confirmed/i.test(profile.experienceLevel.value);
  return {
    roleQueries: [...new Set(profile.targetRoles.map((item) => item.value.trim()).filter(Boolean))],
    locations: profile.location?.value ? [profile.location.value] : [],
    jobTypes: earlyCareer ? ["Internship", "Entry-level", "Apprenticeship"] : [],
    workModes: [],
    maxExperience: earlyCareer ? 1 : null,
    noDegreeRequired: false,
    mobility: profile.mobility ?? emptyCandidateMobility(),
    generatedAt: new Date().toISOString(),
    confirmedAt: null,
  };
}
