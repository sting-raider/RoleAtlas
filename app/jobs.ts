import type { GeographicLocation } from "../shared/geography.ts";
import type { OpportunityClassification } from "../shared/opportunityTaxonomy.ts";

export type WorkMode = "Remote" | "Hybrid" | "On-site";
export type JobType = "Internship" | "Entry-level" | "Apprenticeship" | "Full-time" | "Part-time" | "Contract";
export type ApplicationStage = "Saved" | "Preparing" | "Applied" | "Interview" | "Offer" | "Closed";
export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export type EligibilityStatus = "confirmed" | "likely" | "unclear" | "excluded" | "requires_sponsorship" | "requires_relocation" | "requires_office_attendance" | "timezone_mismatch";

export type RemotePolicy = {
  mode: "remote" | "hybrid" | "onsite" | "unknown";
  scope: "worldwide" | "countries" | "region" | "timezone" | "location_restricted" | "unspecified";
  eligibleCountryCodes: string[];
  excludedCountryCodes: string[];
  eligibleRegionCodes: string[];
  excludedRegionCodes: string[];
  excludedSubdivisionCodes: string[];
  requiredTimezones: string[];
  requiredUtcOffsetRange: { minimum: number; maximum: number } | null;
  residencyRequirements: string[];
  workAuthorizationRequirements: string[];
  sponsorshipAvailable: boolean | null;
  officeLocations: GeographicLocation[];
  officeFrequency: string | null;
  confidence: number;
  evidence: string[];
  originalWording: string;
};

export type Job = {
  id: string;
  title: string;
  company: string;
  initials: string;
  location: string;
  country: string;
  workMode: WorkMode;
  type: JobType;
  category: string;
  experience: number | null;
  experienceLabel: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  salaryPeriod: SalaryPeriod;
  postedDays: number | null;
  degreeRequired: boolean | null;
  visaSupport: boolean;
  source: string;
  sourceJobId?: string | null;
  canonicalUrl?: string;
  applyUrl?: string | null;
  companyDomain?: string | null;
  requisitionId?: string | null;
  postedAt?: string | null;
  url: string;
  verified: boolean;
  isDemo?: boolean;
  score: number;
  scoreKind?: "estimate" | "resume" | "ai";
  accent: "mint" | "lilac" | "coral" | "amber";
  skills: string[];
  reasons: string[];
  gap: string;
  summary: string;
  description?: string;
  lifecycleStatus?: "active" | "possibly_closed" | "closed";
  lastVerifiedAt?: string | null;
  geographicLocations?: GeographicLocation[];
  remotePolicy?: RemotePolicy;
  eligibilityStatus?: EligibilityStatus;
  eligibilityEvidence?: string[];
  opportunityClassification?: OpportunityClassification;
};

const DEMO_JOB_FIXTURES: Job[] = [
  {
    id: "tandem-product-design",
    title: "Associate Product Designer",
    company: "Tandem Works",
    initials: "TW",
    location: "Remote — UK & Europe",
    country: "United Kingdom",
    workMode: "Remote",
    type: "Entry-level",
    category: "Design",
    experience: 0,
    experienceLabel: "0 years required",
    salaryMin: 32000,
    salaryMax: 39000,
    currency: "GBP",
    salaryPeriod: "year",
    postedDays: 0,
    degreeRequired: false,
    visaSupport: false,
    source: "Greenhouse",
    url: "https://www.greenhouse.com/",
    verified: true,
    score: 94,
    accent: "mint",
    skills: ["Figma", "Research", "Prototyping"],
    reasons: [
      "A portfolio counts as experience; no commercial work is required.",
      "Six of the seven core skills can be shown through coursework or personal projects.",
      "The team pairs every new designer with a mentor for the first 12 weeks.",
    ],
    gap: "Motion design is useful, but explicitly listed as optional.",
    summary: "Help a small product team turn research into clear, accessible workflows for independent businesses.",
  },
  {
    id: "sparrow-growth-intern",
    title: "Growth Marketing Intern",
    company: "Sparrow Finance",
    initials: "SF",
    location: "Bengaluru, India",
    country: "India",
    workMode: "Hybrid",
    type: "Internship",
    category: "Marketing",
    experience: 0,
    experienceLabel: "No prior experience",
    salaryMin: 25000,
    salaryMax: 35000,
    currency: "INR",
    salaryPeriod: "month",
    postedDays: 1,
    degreeRequired: false,
    visaSupport: false,
    source: "Company site",
    url: "https://example.com/",
    verified: true,
    score: 91,
    accent: "lilac",
    skills: ["Writing", "Analytics", "Social"],
    reasons: [
      "Writing samples and curiosity are valued over agency experience.",
      "The role includes a paid analytics and experimentation bootcamp.",
      "Your newsletter, club, or creator work can satisfy the portfolio request.",
    ],
    gap: "Basic spreadsheet confidence would strengthen the application.",
    summary: "Run small experiments, learn from campaign data, and explain what worked in plain language.",
  },
  {
    id: "northmetric-data-ops",
    title: "Junior Data Operations Analyst",
    company: "Northmetric",
    initials: "NM",
    location: "Remote — India",
    country: "India",
    workMode: "Remote",
    type: "Entry-level",
    category: "Data",
    experience: 1,
    experienceLabel: "0–1 years",
    salaryMin: 520000,
    salaryMax: 710000,
    currency: "INR",
    salaryPeriod: "year",
    postedDays: 3,
    degreeRequired: false,
    visaSupport: false,
    source: "Lever",
    url: "https://www.lever.co/",
    verified: true,
    score: 86,
    accent: "amber",
    skills: ["SQL", "Spreadsheets", "Quality checks"],
    reasons: [
      "Projects, coursework, and internships all count toward the experience range.",
      "SQL basics cover every must-have technical requirement.",
      "The application asks for a problem-solving example instead of a degree.",
    ],
    gap: "Excel lookup functions are the only skill to brush up before applying.",
    summary: "Keep customer datasets clean, investigate anomalies, and improve repeatable quality checks.",
  },
  {
    id: "civicthread-research",
    title: "User Research Apprentice",
    company: "Civic Thread",
    initials: "CT",
    location: "London, UK",
    country: "United Kingdom",
    workMode: "Hybrid",
    type: "Apprenticeship",
    category: "Research",
    experience: 0,
    experienceLabel: "No experience stated",
    salaryMin: 26500,
    salaryMax: 28500,
    currency: "GBP",
    salaryPeriod: "year",
    postedDays: 4,
    degreeRequired: false,
    visaSupport: true,
    source: "Ashby",
    url: "https://www.ashbyhq.com/",
    verified: true,
    score: 84,
    accent: "coral",
    skills: ["Interviews", "Synthesis", "Accessibility"],
    reasons: [
      "The apprenticeship is designed for career starters and switchers.",
      "Community volunteering can demonstrate the required listening skills.",
      "Salary, training plan, and sponsorship policy are stated clearly.",
    ],
    gap: "You will need two days per week in the London studio.",
    summary: "Learn to plan interviews and turn lived experience into better public-service products.",
  },
  {
    id: "brightfield-climate-content",
    title: "Climate Content Assistant",
    company: "Brightfield Energy",
    initials: "BE",
    location: "Remote — Americas",
    country: "United States",
    workMode: "Remote",
    type: "Contract",
    category: "Writing",
    experience: 1,
    experienceLabel: "0–1 years",
    salaryMin: 52000,
    salaryMax: 62000,
    currency: "USD",
    salaryPeriod: "year",
    postedDays: 2,
    degreeRequired: false,
    visaSupport: false,
    source: "Company site",
    url: "https://example.com/",
    verified: true,
    score: 82,
    accent: "mint",
    skills: ["Writing", "Research", "CMS"],
    reasons: [
      "Published class work and independent writing are accepted samples.",
      "The role prioritizes careful research over sector experience.",
      "Every core tool is taught during onboarding.",
    ],
    gap: "Working hours need at least four hours of US Eastern overlap.",
    summary: "Research climate policy and help turn complex energy topics into useful, accurate guides.",
  },
  {
    id: "luma-customer-success",
    title: "Customer Success Trainee",
    company: "Luma Learning",
    initials: "LL",
    location: "Dublin, Ireland",
    country: "Ireland",
    workMode: "Hybrid",
    type: "Entry-level",
    category: "Customer Success",
    experience: 0,
    experienceLabel: "Training provided",
    salaryMin: 30000,
    salaryMax: 34000,
    currency: "EUR",
    salaryPeriod: "year",
    postedDays: 5,
    degreeRequired: false,
    visaSupport: true,
    source: "Greenhouse",
    url: "https://www.greenhouse.com/",
    verified: true,
    score: 80,
    accent: "lilac",
    skills: ["Communication", "Troubleshooting", "Empathy"],
    reasons: [
      "The listing says hospitality, volunteering, or peer support all count.",
      "A four-week paid product academy is included.",
      "The interview uses a scenario, not a prior-results presentation.",
    ],
    gap: "The role is hybrid and expects two office days each week.",
    summary: "Help new schools get value from an education platform while learning SaaS customer success.",
  },
  {
    id: "fieldnote-frontend-intern",
    title: "Frontend Engineering Intern",
    company: "Fieldnote",
    initials: "FN",
    location: "Remote — Asia Pacific",
    country: "Singapore",
    workMode: "Remote",
    type: "Internship",
    category: "Engineering",
    experience: 0,
    experienceLabel: "Projects welcome",
    salaryMin: 1800,
    salaryMax: 2400,
    currency: "USD",
    salaryPeriod: "month",
    postedDays: 6,
    degreeRequired: false,
    visaSupport: false,
    source: "Lever",
    url: "https://www.lever.co/",
    verified: true,
    score: 79,
    accent: "coral",
    skills: ["JavaScript", "React", "CSS"],
    reasons: [
      "Two personal projects satisfy the only experience requirement.",
      "The take-home task is capped at 90 minutes.",
      "The listing explicitly welcomes self-taught applicants.",
    ],
    gap: "TypeScript is preferred; one small typed project would help.",
    summary: "Ship small interface improvements and learn through paired reviews with senior engineers.",
  },
  {
    id: "arcway-people-ops",
    title: "People Operations Coordinator",
    company: "Arcway Studios",
    initials: "AS",
    location: "New York, USA",
    country: "United States",
    workMode: "On-site",
    type: "Entry-level",
    category: "Operations",
    experience: 1,
    experienceLabel: "0–1 years",
    salaryMin: 50000,
    salaryMax: 58000,
    currency: "USD",
    salaryPeriod: "year",
    postedDays: 8,
    degreeRequired: true,
    visaSupport: false,
    source: "Ashby",
    url: "https://www.ashbyhq.com/",
    verified: true,
    score: 67,
    accent: "amber",
    skills: ["Coordination", "Writing", "Spreadsheets"],
    reasons: [
      "Campus society or volunteer coordination can cover the experience ask.",
      "The responsibilities are concrete and training is documented.",
    ],
    gap: "A degree is listed as required and the role cannot sponsor a visa.",
    summary: "Coordinate onboarding, documentation, and team events for a growing creative studio.",
  },
];

export const JOBS: Job[] = DEMO_JOB_FIXTURES.map((job) => ({
  ...job,
  isDemo: true,
  verified: false,
}));

export const PROVIDERS = {
  DeepSeek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  OpenAI: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
  },
  Anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
  },
  Gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  OpenRouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
  },
  Groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  Mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
  },
  Ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
  },
  "Custom OpenAI-compatible": {
    baseUrl: "",
    model: "",
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;
