import { countryByCodeValue, normalizeGeographicLocation, type GeographicLocation } from "../shared/geography.ts";
import type { JobType, WorkMode } from "./jobs.ts";

export type EvidenceField = {
  value: string;
  confidence: number;
  evidence: string;
  confirmed: boolean;
  origin?: "resume" | "manual" | "system";
};

export type CandidateFacts = {
  name: EvidenceField;
  location: EvidenceField | null;
  skills: EvidenceField[];
  experienceLevel: EvidenceField;
  education: EvidenceField[];
  certifications: EvidenceField[];
  graduationDate: EvidenceField | null;
  leadershipScope: EvidenceField | null;
};

export type CandidateGoals = {
  primaryRoleFamilies: EvidenceField[];
  adjacentRoleFamilies: EvidenceField[];
  opportunityTypes: JobType[];
  targetIndustries: string[];
};

export type CandidateConstraints = {
  excludedTerms: string[];
  excludedCompanies: string[];
  maximumExperienceYears: number | null;
  minimumCompensation: { amount: number; currency: string; period: "year" | "month" | "hour" } | null;
  degreeRequiredAllowed: boolean;
};

export type CandidatePreferences = {
  workModes: WorkMode[];
  freshnessDays: number;
  rankingPriorities: Array<"eligibility" | "role_fit" | "skills" | "freshness" | "compensation" | "location">;
  preferredIndustries: string[];
  avoidedIndustries: string[];
};

export type CandidateProfile = {
  id?: string;
  name: EvidenceField;
  location: EvidenceField | null;
  skills: EvidenceField[];
  targetRoles: EvidenceField[];
  experienceLevel: EvidenceField;
  mobility: CandidateMobility;
  facts?: CandidateFacts;
  goals?: CandidateGoals;
  constraints?: CandidateConstraints;
  preferences?: CandidatePreferences;
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
  jobTypes: JobType[];
  workModes: WorkMode[];
  maxExperience: number | null;
  noDegreeRequired: boolean;
  mobility: CandidateMobility;
  primaryRoleFamilies?: string[];
  adjacentRoleFamilies?: string[];
  titleSynonyms?: string[];
  excludedTerms?: string[];
  targetCountryCodes?: string[];
  targetRegionCodes?: string[];
  freshnessDays?: number;
  rankingPriorities?: CandidatePreferences["rankingPriorities"];
  strategyName?: string;
  strategyStatus?: "draft" | "active" | "paused" | "archived";
  strategyVersion?: number;
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
  return { value, confidence, evidence: evidenceFor(text, value), confirmed: false, origin: "resume" };
}

export function candidateSections(profile: CandidateProfile): {
  facts: CandidateFacts;
  goals: CandidateGoals;
  constraints: CandidateConstraints;
  preferences: CandidatePreferences;
} {
  return {
    facts: profile.facts ?? {
      name: profile.name,
      location: profile.location,
      skills: profile.skills,
      experienceLevel: profile.experienceLevel,
      education: [],
      certifications: [],
      graduationDate: null,
      leadershipScope: null,
    },
    goals: profile.goals ?? {
      primaryRoleFamilies: profile.targetRoles,
      adjacentRoleFamilies: [],
      opportunityTypes: [],
      targetIndustries: [],
    },
    constraints: profile.constraints ?? {
      excludedTerms: [],
      excludedCompanies: [],
      maximumExperienceYears: null,
      minimumCompensation: null,
      degreeRequiredAllowed: true,
    },
    preferences: profile.preferences ?? {
      workModes: [],
      freshnessDays: 30,
      rankingPriorities: ["eligibility", "role_fit", "skills", "freshness"],
      preferredIndustries: [],
      avoidedIndustries: [],
    },
  };
}

export function buildCandidateProfile(resume: ResumeInput): CandidateProfile {
  const earlyCareer = /\b(intern|student|graduate|fresher|entry[- ]level|coursework|university|college)\b/i.test(resume.text);
  const years = [...resume.text.matchAll(/\b(\d{1,2})\+?\s+years?\b/gi)].map((match) => Number(match[1])).filter((value) => value <= 20);
  const level = earlyCareer ? "Early career / internship" : years.length ? `${Math.max(...years)} years indicated` : "Experience level not confirmed";
  const normalizedLocation = resume.location ? normalizeGeographicLocation(resume.location) : null;
  const name = field(resume.name || "Candidate", resume.text, resume.name ? 0.78 : 0.35);
  const location = resume.location ? field(resume.location, resume.text, 0.72) : null;
  const skills = resume.skills.map((skill) => field(skill, resume.text, 0.9));
  const targetRoles = resume.suggestedRoles.map((role) => field(role, resume.text, 0.68));
  const experienceLevel = field(level, resume.text, earlyCareer || years.length ? 0.7 : 0.3);
  const mobility = {
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
  } satisfies CandidateMobility;
  return {
    name,
    location,
    skills,
    targetRoles,
    experienceLevel,
    facts: { name, location, skills, experienceLevel, education: [], certifications: [], graduationDate: null, leadershipScope: null },
    goals: {
      primaryRoleFamilies: targetRoles,
      adjacentRoleFamilies: [],
      opportunityTypes: earlyCareer ? ["Internship", "Entry-level", "Apprenticeship"] : [],
      targetIndustries: [],
    },
    constraints: { excludedTerms: [], excludedCompanies: [], maximumExperienceYears: earlyCareer ? 1 : null, minimumCompensation: null, degreeRequiredAllowed: true },
    preferences: { workModes: [], freshnessDays: 30, rankingPriorities: ["eligibility", "role_fit", "skills", "freshness"], preferredIndustries: [], avoidedIndustries: [] },
    mobility,
    sourceFile: resume.fileName,
    updatedAt: new Date().toISOString(),
  };
}

export function searchPlanGeographyLabel(plan: SearchPlan): string {
  const preferredCountries = [...new Set((plan.mobility?.preferredCountryCodes ?? []).map((code) => countryByCodeValue(code)?.name ?? code.trim()).filter(Boolean))];
  if (preferredCountries.length) return preferredCountries.join(", ");
  const legacyLocations = [...new Set(plan.locations.map((location) => location.trim()).filter(Boolean))];
  return legacyLocations.join(", ") || "Open geography";
}

export function buildSearchPlan(profile: CandidateProfile): SearchPlan {
  const sections = candidateSections(profile);
  const earlyCareer = /early career|internship|not confirmed/i.test(profile.experienceLevel.value);
  const primaryRoleFamilies = sections.goals.primaryRoleFamilies.map((item) => item.value.trim()).filter(Boolean);
  const adjacentRoleFamilies = sections.goals.adjacentRoleFamilies.map((item) => item.value.trim()).filter(Boolean);
  return {
    roleQueries: [...new Set([...primaryRoleFamilies, ...adjacentRoleFamilies])],
    locations: profile.location?.value ? [profile.location.value] : [],
    jobTypes: sections.goals.opportunityTypes.length ? sections.goals.opportunityTypes : earlyCareer ? ["Internship", "Entry-level", "Apprenticeship"] : [],
    workModes: sections.preferences.workModes,
    maxExperience: sections.constraints.maximumExperienceYears ?? (earlyCareer ? 1 : null),
    noDegreeRequired: false,
    mobility: profile.mobility ?? emptyCandidateMobility(),
    primaryRoleFamilies,
    adjacentRoleFamilies,
    titleSynonyms: [],
    excludedTerms: sections.constraints.excludedTerms,
    targetCountryCodes: profile.mobility.preferredCountryCodes,
    targetRegionCodes: [],
    freshnessDays: sections.preferences.freshnessDays,
    rankingPriorities: sections.preferences.rankingPriorities,
    strategyName: primaryRoleFamilies[0] ? `${primaryRoleFamilies[0]} search` : "My search",
    strategyStatus: "draft",
    strategyVersion: 1,
    generatedAt: new Date().toISOString(),
    confirmedAt: null,
  };
}
