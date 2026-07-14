import { JOBS, type Job, type JobType, type WorkMode } from "./jobs";

export type LiveJobsPayload = {
  jobs: Job[];
  sources: string[];
  fetchedAt: string;
  fallback: boolean;
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

const BEGINNER_SIGNALS = /\b(intern(ship)?|apprentice(ship)?|trainee|graduate|junior|entry[- ]level|assistant|associate|coordinator|early career|new grad)\b/i;
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

function inferExperience(title: string, description: string) {
  if (BEGINNER_SIGNALS.test(title)) return /intern|apprentice|trainee|graduate|new grad/i.test(title) ? 0 : 1;
  const matches = [...description.matchAll(/\b(\d{1,2})\s*(?:[-–]\s*\d{1,2}\s*)?\+?\s*years?\b/gi)]
    .map((match) => Number(match[1]))
    .filter((years) => years <= 20);
  return matches.length ? Math.min(...matches) : 4;
}

function classifyType(title: string, rawTypes: string[]): JobType {
  const haystack = `${title} ${rawTypes.join(" ")}`;
  if (/intern/i.test(haystack)) return "Internship";
  if (/apprentice|trainee|graduate program/i.test(haystack)) return "Apprenticeship";
  if (/contract|freelance|temporary/i.test(haystack)) return "Contract";
  return "Entry-level";
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

function inferDegreeRequired(description: string) {
  return /(?:bachelor'?s?|master'?s?|university) degree (?:is )?required|required[^.]{0,35}(?:bachelor'?s?|degree)/i.test(description);
}

function inferVisaSupport(description: string) {
  if (/do not (?:offer|provide) (?:visa )?sponsorship|unable to sponsor|no sponsorship/i.test(description)) return false;
  return /visa sponsorship|sponsorship (?:is )?(?:available|provided)|relocation and visa/i.test(description);
}

function parseSalary(value: string) {
  const currency: Job["currency"] = /£|GBP/i.test(value) ? "GBP" : /€|EUR/i.test(value) ? "EUR" : /₹|INR/i.test(value) ? "INR" : "USD";
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
  title: string;
  company: string;
  description: string;
  location: string;
  remote: boolean;
  url: string;
  tags: string[];
  rawTypes: string[];
  postedDays: number;
  source: string;
  salary?: string;
}): Job | null {
  const description = textFromHtml(input.description);
  const experience = inferExperience(input.title, description);
  if (SENIOR_SIGNALS.test(input.title) || experience > 3) return null;

  const workMode = classifyWorkMode(input.remote, input.location, description);
  const degreeRequired = inferDegreeRequired(description);
  const visaSupport = inferVisaSupport(description);
  const salary = parseSalary(input.salary ?? "");
  const skills = input.tags.filter(Boolean).slice(0, 4);
  const score = Math.min(96, 58 + (experience === 0 ? 15 : experience === 1 ? 10 : 4) + (workMode === "Remote" ? 9 : 3) + (!degreeRequired ? 6 : 0) + (input.postedDays <= 3 ? 7 : 3) + (salary.salaryMin ? 4 : 0));
  const reasons = [
    experience === 0 ? "The title and requirements are explicitly aimed at career starters." : `The listing appears to ask for no more than ${experience} year${experience === 1 ? "" : "s"} of experience.`,
    degreeRequired ? "A degree is mentioned, so check whether equivalent project experience is accepted." : "No mandatory degree requirement was detected in the listing.",
    workMode === "Remote" ? "The role is listed as remote; confirm the stated country or timezone limits." : `The role is listed as ${workMode.toLowerCase()} in ${input.location || "the stated location"}.`,
  ];

  return {
    id: input.id,
    title: input.title,
    company: input.company,
    initials: initials(input.company),
    location: input.location || (workMode === "Remote" ? "Remote" : "Location not stated"),
    country: input.location || "Not stated",
    workMode,
    type: classifyType(input.title, input.rawTypes),
    category: inferCategory(input.title, input.tags),
    experience,
    experienceLabel: experience === 0 ? "No experience stated" : `0–${experience} years`,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    currency: salary.currency,
    salaryPeriod: "year",
    postedDays: input.postedDays,
    degreeRequired,
    visaSupport,
    source: input.source,
    url: input.url,
    verified: true,
    score,
    accent: accentFor(input.id),
    skills: skills.length ? skills : [inferCategory(input.title, input.tags), workMode],
    reasons,
    gap: salary.salaryMin ? "The salary is listed, but confirm the final range and employment terms with the employer." : "The source does not state a salary, so ask for the range before investing heavily in the process.",
    summary: description.slice(0, 280) || `View the original ${input.source} listing for the complete role description.`,
  };
}

async function fetchArbeitnow() {
  const response = await fetch("https://www.arbeitnow.com/api/job-board-api?page=1", {
    headers: { Accept: "application/json", "User-Agent": "FirstRung/1.0 job discovery" },
    next: { revalidate: 1800 },
  });
  if (!response.ok) throw new Error(`Arbeitnow returned ${response.status}`);
  const payload = await response.json() as { data: ArbeitnowJob[] };
  return payload.data.map((item) => buildJob({
    id: `arbeitnow-${item.slug}`,
    title: item.title,
    company: item.company_name,
    description: item.description,
    location: item.location,
    remote: item.remote,
    url: item.url,
    tags: item.tags ?? [],
    rawTypes: item.job_types ?? [],
    postedDays: daysSince(item.created_at),
    source: "Arbeitnow",
  })).filter((job): job is Job => Boolean(job));
}

async function fetchRemotive() {
  const response = await fetch("https://remotive.com/api/remote-jobs?limit=100", {
    headers: { Accept: "application/json", "User-Agent": "FirstRung/1.0 job discovery" },
    next: { revalidate: 21_600 },
  });
  if (!response.ok) throw new Error(`Remotive returned ${response.status}`);
  const payload = await response.json() as { jobs: RemotiveJob[] };
  return payload.jobs.map((item) => buildJob({
    id: `remotive-${item.id}`,
    title: item.title,
    company: item.company_name,
    description: item.description,
    location: item.candidate_required_location,
    remote: true,
    url: item.url,
    tags: item.tags ?? [],
    rawTypes: [item.job_type],
    postedDays: daysSince(item.publication_date),
    source: "Remotive",
    salary: item.salary,
  })).filter((job): job is Job => Boolean(job));
}

export async function getLiveJobs(): Promise<LiveJobsPayload> {
  const results = await Promise.allSettled([fetchArbeitnow(), fetchRemotive()]);
  const sources: string[] = [];
  const jobs: Job[] = [];
  if (results[0].status === "fulfilled") { sources.push("Arbeitnow"); jobs.push(...results[0].value); }
  if (results[1].status === "fulfilled") { sources.push("Remotive"); jobs.push(...results[1].value); }

  const uniqueJobs = [...new Map(jobs.map((job) => [`${job.company.toLowerCase()}|${job.title.toLowerCase()}`, job])).values()]
    .sort((a, b) => a.postedDays - b.postedDays || b.score - a.score)
    .slice(0, 120);

  return {
    jobs: uniqueJobs.length ? uniqueJobs : JOBS,
    sources: uniqueJobs.length ? sources : ["Demo fallback"],
    fetchedAt: new Date().toISOString(),
    fallback: uniqueJobs.length === 0,
  };
}
