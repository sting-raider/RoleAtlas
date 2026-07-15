import { JOBS, type Job, type WorkMode } from "./jobs.ts";
import { FALLBACK_USD_RATES, classifyJobType, normalizeCurrency, normalizeSalaryPeriod, type ExchangeRates } from "./jobData.ts";
import { deduplicateJobs } from "./jobIdentity.ts";
import { countryByCodeValue, normalizeGeographicLocation, REGIONS } from "../shared/geography.ts";

export type LiveJobsPayload = {
  jobs: Job[];
  sources: string[];
  failedSources: string[];
  fetchedAt: string;
  fallback: boolean;
  sourceStatus: "live" | "partial" | "unavailable" | "demo";
  exchangeRates: ExchangeRates;
  exchangeRatesDate: string | null;
};

type ExchangeRateResult = { date?: string; rates?: Record<string, number> };
export type LiveJobsFetcher = readonly [name: string, fetcher: () => Promise<Job[]>];
export type LiveJobsOptions = {
  demoMode?: boolean;
  fetchers?: readonly LiveJobsFetcher[];
  exchangeRateLoader?: () => Promise<ExchangeRateResult>;
};

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
};

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  tags: string[];
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
};

type JobicyJob = {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobIndustry: string[];
  jobType: string[];
  jobGeo: string;
  jobLevel: string;
  jobDescription: string;
  pubDate: string;
};

type HimalayasJob = {
  guid: string;
  title: string;
  companyName: string;
  employmentType: string;
  minSalary: number | null;
  maxSalary: number | null;
  salaryPeriod: string | null;
  seniority: string[];
  currency: string | null;
  locationRestrictions: string[];
  categories: string[];
  description: string;
  pubDate: number;
  applicationLink: string;
};

type RemoteOkJob = {
  id: string;
  position: string;
  company: string;
  tags: string[];
  description: string;
  location: string;
  apply_url: string;
  salary_min: number;
  salary_max: number;
  date: string;
};

const BEGINNER_SIGNALS = /\b(intern(ship)?|apprentice(ship)?|trainee|graduate|junior|entry[- ]level|assistant|associate|coordinator|early career|new grad)\b/i;
const STRONG_BEGINNER_SIGNALS = /\b(intern(ship)?|apprentice(ship)?|trainee|graduate|junior|entry[- ]level|early career|new grad)\b/i;
const SENIOR_SIGNALS = /\b(senior|staff|principal|lead|head|director|vp|vice president|manager)\b/i;
const ACCENTS: Job["accent"][] = ["mint", "lilac", "coral", "amber"];

function textFromHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function daysSince(value: string | number) {
  const millis = typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(millis)) return 30;
  return Math.max(0, Math.floor((Date.now() - millis) / 86_400_000));
}

function postedAt(value: string | number) {
  const millis = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function companyDomain(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
}

function inferExperience(title: string, description: string): number | null {
  if (STRONG_BEGINNER_SIGNALS.test(title)) return /intern|apprentice|trainee|graduate|new grad/i.test(title) ? 0 : 1;
  if (SENIOR_SIGNALS.test(title)) return 5;
  if (BEGINNER_SIGNALS.test(title)) return 1;
  const matches = [...description.matchAll(/\b(\d{1,2})\s*(?:[-–]\s*\d{1,2}\s*)?\+?\s*years?\b/gi)]
    .map((match) => Number(match[1]))
    .filter((years) => years <= 20);
  return matches.length ? Math.min(...matches) : null;
}

function classifyWorkMode(remote: boolean, location: string, description: string): WorkMode {
  if (remote || /\bremote\b/i.test(location)) return "Remote";
  if (/\bhybrid\b/i.test(`${location} ${description.slice(0, 800)}`)) return "Hybrid";
  return "On-site";
}

function inferCategory(title: string, tags: string[]) {
  const value = `${title} ${tags.join(" ")}`.toLowerCase();
  if (/design|ux|ui/.test(value)) return "Design";
  if (/data|analytics|analyst|sql/.test(value)) return "Data";
  if (/marketing|growth|seo|content|social/.test(value)) return "Marketing";
  if (/research/.test(value)) return "Research";
  if (/support|customer|success/.test(value)) return "Customer Success";
  if (/write|writer|editor|copy/.test(value)) return "Writing";
  if (/engineer|developer|software|frontend|backend|programming/.test(value)) return "Engineering";
  return "Operations";
}

function inferDegreeRequired(description: string): boolean | null {
  if (/no degree required|degree (?:is )?not required|equivalent practical experience/i.test(description)) return false;
  if (/(?:bachelor'?s?|master'?s?|university) degree (?:is )?required|required[^.]{0,35}(?:bachelor'?s?|degree)/i.test(description)) return true;
  return null;
}

function inferVisaSupport(description: string) {
  if (/do not (?:offer|provide) (?:visa )?sponsorship|unable to sponsor|no sponsorship/i.test(description)) return false;
  return /visa sponsorship|sponsorship (?:is )?(?:available|provided)|relocation and visa/i.test(description);
}

function inferCountry(location: string) {
  const normalized = normalizeGeographicLocation(location);
  const country = countryByCodeValue(normalized.countryCode);
  if (country) return country.name;
  const region = REGIONS.find((candidate) => normalized.regionCodes.includes(candidate.code));
  if (region) return region.code === "WORLDWIDE" ? "Worldwide" : region.name;
  return "Not stated";
}

function parseSalary(value: string) {
  const currency = /¥|JPY/i.test(value) ? "JPY"
    : /₹|INR/i.test(value) ? "INR"
      : /£|GBP/i.test(value) ? "GBP"
        : /€|EUR/i.test(value) ? "EUR"
          : /\$|USD/i.test(value) ? "USD"
            : null;
  if (!currency) return { salaryMin: 0, salaryMax: 0, currency: "USD" };
  const numbers = [...value.matchAll(/(?:[$£€₹]\s*)?(\d[\d,.]*)(\s*[kK])?/g)]
    .map((match) => Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1))
    .filter((amount) => amount >= 1000);
  return { salaryMin: numbers[0] ?? 0, salaryMax: numbers[1] ?? numbers[0] ?? 0, currency };
}

function initials(company: string) {
  return company.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "JR";
}

function accentFor(id: string) {
  const total = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return ACCENTS[total % ACCENTS.length];
}

function buildJob(input: {
  id: string;
  sourceJobId: string;
  title: string;
  company: string;
  description: string;
  location: string;
  remote: boolean;
  url: string;
  tags: string[];
  rawTypes: string[];
  postedDays: number;
  postedAt: string | null;
  source: string;
  salary?: string;
}): Job | null {
  const description = textFromHtml(input.description);
  const experience = inferExperience(input.title, description);

  const workMode = classifyWorkMode(input.remote, input.location, description);
  const degreeRequired = inferDegreeRequired(description);
  const visaSupport = inferVisaSupport(description);
  const salary = parseSalary(input.salary ?? "");
  const skills = input.tags.filter(Boolean).slice(0, 4);
  const score = Math.min(82, 42 + (experience === 0 ? 14 : experience === 1 ? 10 : experience === null ? 5 : Math.max(0, 8 - experience)) + (workMode === "Remote" ? 7 : 3) + (degreeRequired !== true ? 5 : 0) + (input.postedDays <= 3 ? 7 : 3) + (salary.salaryMin ? 4 : 0));
  const reasons = [
    experience === 0 ? "The title and requirements are explicitly aimed at career starters." : experience === null ? "The listing does not state a clear minimum number of years." : `The listing appears to ask for about ${experience} year${experience === 1 ? "" : "s"} of experience.`,
    degreeRequired === true ? "A degree is mentioned, so check whether equivalent project experience is accepted." : degreeRequired === false ? "The listing explicitly accepts applicants without a degree or with equivalent experience." : "No explicit mandatory degree requirement was detected.",
    workMode === "Remote" ? "The role is listed as remote; confirm the stated country or timezone limits." : `The role is listed as ${workMode.toLowerCase()} in ${input.location || "the stated location"}.`,
  ];

  return {
    id: input.id,
    title: input.title,
    company: input.company,
    initials: initials(input.company),
    location: input.location || (workMode === "Remote" ? "Remote" : "Location not stated"),
    country: inferCountry(input.location),
    workMode,
    type: classifyJobType(input.title, input.rawTypes.join(" ")),
    category: inferCategory(input.title, input.tags),
    experience,
    experienceLabel: experience === null ? "Experience not stated" : experience === 0 ? "No experience stated" : `${experience}+ years signal`,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    currency: salary.currency,
    salaryPeriod: "year",
    postedDays: input.postedDays,
    degreeRequired,
    visaSupport,
    source: input.source,
    sourceJobId: input.sourceJobId,
    canonicalUrl: input.url,
    applyUrl: input.url,
    companyDomain: companyDomain(input.url),
    postedAt: input.postedAt,
    url: input.url,
    verified: true,
    isDemo: false,
    score,
    scoreKind: "estimate",
    accent: accentFor(input.id),
    skills: skills.length ? skills : [inferCategory(input.title, input.tags), workMode],
    reasons,
    gap: salary.salaryMin ? "The salary is listed, but confirm the final range and employment terms with the employer." : "The source does not state a salary, so ask for the range before investing heavily in the process.",
    summary: description.slice(0, 280) || `View the original ${input.source} listing for the complete role description.`,
    description,
  };
}

async function fetchArbeitnow() {
  const responses = await Promise.all([1, 2, 3, 4, 5].map((page) => fetch(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, {
    headers: { Accept: "application/json", "User-Agent": "RoleAtlas/1.0 job discovery" },
    next: { revalidate: 1800 },
  })));
  if (responses.every((response) => !response.ok)) throw new Error("Arbeitnow feeds were unavailable");
  const payloads = await Promise.all(responses.filter((response) => response.ok).map((response) => response.json() as Promise<{ data: ArbeitnowJob[] }>));
  return payloads.flatMap((payload) => payload.data).map((item) => buildJob({
    id: `arbeitnow-${item.slug}`,
    sourceJobId: item.slug,
    title: item.title,
    company: item.company_name,
    description: item.description,
    location: item.location,
    remote: item.remote,
    url: item.url,
    tags: item.tags ?? [],
    rawTypes: item.job_types ?? [],
    postedDays: daysSince(item.created_at),
    postedAt: postedAt(item.created_at),
    source: "Arbeitnow",
  })).filter((job): job is Job => Boolean(job));
}

async function fetchJobicy() {
  const response = await fetch("https://jobicy.com/api/v2/remote-jobs?count=100", {
    headers: { Accept: "application/json", "User-Agent": "RoleAtlas/1.0 job discovery" },
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`Jobicy returned ${response.status}`);
  const payload = await response.json() as { jobs: JobicyJob[] };
  return payload.jobs.map((item) => buildJob({
    id: `jobicy-${item.id}`,
    sourceJobId: String(item.id),
    title: item.jobTitle,
    company: item.companyName,
    description: item.jobDescription,
    location: item.jobGeo,
    remote: true,
    url: item.url,
    tags: item.jobIndustry ?? [],
    rawTypes: [...(item.jobType ?? []), item.jobLevel ?? ""],
    postedDays: daysSince(item.pubDate),
    postedAt: postedAt(item.pubDate),
    source: "Jobicy",
  })).filter((job): job is Job => Boolean(job));
}

async function fetchHimalayas() {
  const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => fetch(`https://himalayas.app/jobs/api?limit=20&offset=${index * 20}`, {
    headers: { Accept: "application/json", "User-Agent": "RoleAtlas/1.0 job discovery" },
    next: { revalidate: 3600 },
  })));
  if (responses.every((response) => !response.ok)) throw new Error("Himalayas feeds were unavailable");
  const payloads = await Promise.all(responses.filter((response) => response.ok).map((response) => response.json() as Promise<{ jobs: HimalayasJob[] }>));
  return payloads.flatMap((payload) => payload.jobs).map((item) => {
    const job = buildJob({
      id: `himalayas-${item.guid}`,
      sourceJobId: item.guid,
      title: item.title,
      company: item.companyName,
      description: item.description,
      location: item.locationRestrictions?.join(", ") || "Worldwide",
      remote: true,
      url: item.applicationLink,
      tags: item.categories ?? [],
      rawTypes: [item.employmentType, ...(item.seniority ?? [])],
      postedDays: daysSince(item.pubDate),
      postedAt: postedAt(item.pubDate),
      source: "Himalayas",
    });
    if (job && item.minSalary) {
      const currency = normalizeCurrency(item.currency, "");
      if (currency) {
        job.salaryMin = item.minSalary;
        job.salaryMax = item.maxSalary ?? item.minSalary;
        job.currency = currency;
        job.salaryPeriod = normalizeSalaryPeriod(item.salaryPeriod);
      }
    }
    return job;
  }).filter((job): job is Job => Boolean(job));
}

async function fetchRemoteOk() {
  const response = await fetch("https://remoteok.com/api", {
    headers: { Accept: "application/json", "User-Agent": "RoleAtlas/1.0 job discovery" },
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`Remote OK returned ${response.status}`);
  const payload = await response.json() as Array<RemoteOkJob | Record<string, unknown>>;
  return payload.filter((item): item is RemoteOkJob => "position" in item && "company" in item).map((item) => {
    const job = buildJob({
      id: `remoteok-${item.id}`,
      sourceJobId: item.id,
      title: item.position,
      company: item.company,
      description: item.description,
      location: item.location || "Worldwide",
      remote: true,
      url: item.apply_url,
      tags: item.tags ?? [],
      rawTypes: [],
      postedDays: daysSince(item.date),
      postedAt: postedAt(item.date),
      source: "Remote OK",
    });
    if (job && item.salary_min) {
      job.salaryMin = item.salary_min;
      job.salaryMax = item.salary_max || item.salary_min;
    }
    return job;
  }).filter((job): job is Job => Boolean(job));
}

async function fetchRemotive() {
  const response = await fetch("https://remotive.com/api/remote-jobs?limit=100", {
    headers: { Accept: "application/json", "User-Agent": "RoleAtlas/1.0 job discovery" },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`Remotive returned ${response.status}`);
  const payload = await response.json() as { jobs: RemotiveJob[] };
  return payload.jobs.map((item) => buildJob({
    id: `remotive-${item.id}`,
    sourceJobId: String(item.id),
    title: item.title,
    company: item.company_name,
    description: item.description,
    location: item.candidate_required_location,
    remote: true,
    url: item.url,
    tags: item.tags ?? [],
    rawTypes: [item.job_type],
    postedDays: daysSince(item.publication_date),
    postedAt: postedAt(item.publication_date),
    source: "Remotive",
    salary: item.salary,
  })).filter((job): job is Job => Boolean(job));
}

async function loadExchangeRates(): Promise<ExchangeRateResult> {
  return fetch("https://api.frankfurter.app/latest?base=USD", {
    headers: { Accept: "application/json", "User-Agent": "RoleAtlas/1.0 salary normalization" },
    next: { revalidate: 43_200 },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Exchange-rate service returned ${response.status}`);
      return response.json() as Promise<ExchangeRateResult>;
    })
    .catch(() => ({ date: undefined, rates: undefined }));
}

export async function getLiveJobs(options: LiveJobsOptions = {}): Promise<LiveJobsPayload> {
  const fetchers = options.fetchers ?? [
    ["Arbeitnow", fetchArbeitnow],
    ["Remotive", fetchRemotive],
    ["Jobicy", fetchJobicy],
    ["Himalayas", fetchHimalayas],
    ["Remote OK", fetchRemoteOk],
  ] as const;
  const [results, exchangeRateResult] = await Promise.all([
    Promise.allSettled(fetchers.map(([, fetcher]) => fetcher())),
    (options.exchangeRateLoader ?? loadExchangeRates)(),
  ]);
  const sources: string[] = [];
  const failedSources: string[] = [];
  const jobs: Job[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sources.push(fetchers[index][0]);
      jobs.push(...result.value);
    } else {
      failedSources.push(fetchers[index][0]);
    }
  });

  const uniqueJobs = deduplicateJobs(jobs)
    .sort((a, b) => (a.postedDays ?? Number.MAX_SAFE_INTEGER) - (b.postedDays ?? Number.MAX_SAFE_INTEGER) || b.score - a.score)
    .slice(0, 600);
  const demoMode = options.demoMode ?? process.env.ROLEATLAS_DEMO_MODE === "true";
  const useDemo = uniqueJobs.length === 0 && demoMode;
  const sourceStatus: LiveJobsPayload["sourceStatus"] = useDemo
    ? "demo"
    : uniqueJobs.length === 0
      ? "unavailable"
      : failedSources.length > 0
        ? "partial"
        : "live";

  return {
    jobs: useDemo ? JOBS : uniqueJobs,
    sources: useDemo ? ["Explicit demo mode"] : sources,
    failedSources,
    fetchedAt: new Date().toISOString(),
    fallback: sourceStatus !== "live",
    sourceStatus,
    exchangeRates: { ...FALLBACK_USD_RATES, ...(exchangeRateResult.rates ?? {}), USD: 1 },
    exchangeRatesDate: exchangeRateResult.date ?? null,
  };
}
