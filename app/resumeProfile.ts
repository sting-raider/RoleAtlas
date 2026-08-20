import { REGIONS, SUBDIVISIONS, countryByCodeValue, normalizeGeographicLocation } from "../shared/geography.ts";

const SKILL_TERMS = [
  "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Python", "Java", "C++", "C#", "Go", "Rust", "SQL", "PostgreSQL", "MongoDB", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Git", "HTML", "CSS", "Figma", "Excel", "Power BI", "Tableau", "Machine Learning", "Data Analysis", "Research", "Writing", "Marketing", "SEO", "Sales", "Customer Support", "Project Management", "Communication", "Leadership", "Finance", "Accounting", "Operations",
];

const ROLE_SIGNALS: Array<[RegExp, string]> = [
  [/react|javascript|typescript|html|css|frontend/i, "Frontend Developer"],
  [/python|java|node\.js|backend|api|sql/i, "Software Engineer"],
  [/data analysis|power bi|tableau|excel|sql|statistics/i, "Data Analyst"],
  [/machine learning|tensorflow|pytorch|data science/i, "Data Science / ML"],
  [/figma|user experience|ux|ui design|prototype/i, "Product / UX Designer"],
  [/marketing|seo|content|social media|campaign/i, "Marketing / Growth"],
  [/research|interview|survey|qualitative|quantitative/i, "Research"],
  [/sales|business development|crm|lead generation/i, "Sales / Business Development"],
  [/customer support|customer success|client service/i, "Customer Success"],
  [/finance|accounting|audit|financial analysis/i, "Finance / Accounting"],
  [/operations|coordination|project management|logistics/i, "Operations / Project Coordinator"],
];

export function inferProfile(text: string) {
  const skills = SKILL_TERMS.filter((skill) => new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}\\b`, "i").test(text)).slice(0, 24);
  const suggestedRoles = ROLE_SIGNALS.filter(([pattern]) => pattern.test(text)).map(([, role]) => role).slice(0, 8);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines.find((line) => line.length >= 3 && line.length <= 60 && !/@|https?:|resume|curriculum|phone|mobile/i.test(line)) ?? "Candidate";
  const normalized = lines.slice(1).map((line) => normalizeGeographicLocation(line)).find((candidate) => candidate.confidence >= 0.82) ?? normalizeGeographicLocation("");
  const country = countryByCodeValue(normalized.countryCode);
  const subdivision = normalized.subdivisionCode ? SUBDIVISIONS.find((item) => item.code === normalized.subdivisionCode) ?? null : null;
  const region = !country && normalized.regionCodes.length ? REGIONS.find((item) => item.code === normalized.regionCodes[0]) ?? null : null;
  const locationParts = [normalized.city, subdivision?.name, country?.name].filter((value, index, items): value is string => Boolean(value) && items.indexOf(value) === index);
  const location = normalized.confidence >= 0.82 ? locationParts.join(", ") || region?.name || null : null;
  return {
    name,
    skills,
    suggestedRoles: suggestedRoles.length ? suggestedRoles : ["Entry-level opportunities"],
    location,
  };
}
