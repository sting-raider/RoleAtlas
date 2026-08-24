import { REGIONS, countryByCodeValue, normalizeGeographicLocation } from "../shared/geography.ts";

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

const NON_NAME = /@|https?:|resume|curriculum|phone|mobile/i;

/** PDF text layers often arrive as one space-joined run, so when no standalone
 * line qualifies, try short word prefixes of the leading segment before the
 * first section heading. Two-word names win over longer guesses. */
function guessJoinedName(text: string): string | null {
  const head = text.split(/\s+(?=Skills\b|Experience\b|Education\b|Summary\b|Profile\b|Contact\b|Projects\b)/i)[0] ?? "";
  const words = head.trim().split(/\s+/).filter(Boolean);
  for (const count of [2, 3, 4]) {
    if (words.length < count) break;
    const candidate = words.slice(0, count).join(" ");
    if (candidate.length >= 3 && !NON_NAME.test(candidate) && /[A-Za-zÀ-ɏ]/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function inferProfile(text: string) {
  // Alphanumeric lookaround boundaries instead of \b so punctuated skills
  // such as C++, C#, and Node.js match while Go still fails inside "Google".
  const skills = SKILL_TERMS.filter((skill) => new RegExp(`(?<![A-Za-z0-9])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}(?![A-Za-z0-9])`, "i").test(text)).slice(0, 24);
  const suggestedRoles = ROLE_SIGNALS.filter(([pattern]) => pattern.test(text)).map(([, role]) => role).slice(0, 8);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines.find((line) => line.length >= 3 && line.length <= 60 && !NON_NAME.test(line)) ?? guessJoinedName(text) ?? "Candidate";
  // Joined single-run PDF extractions have no "line 2", so also try the
  // document head (bounded to keep long bodies from producing false matches).
  // The guessed name is removed first: given names such as "Jordan" must not
  // resolve as countries.
  const namePrefix = typeof name === "string" && name !== "Candidate" ? text.replace(name, " ") : text;
  const locationSource = lines.length > 1 ? lines.slice(1) : [namePrefix.slice(0, 200)];
  const normalized = locationSource.map((line) => normalizeGeographicLocation(line)).find((candidate) => candidate.confidence >= 0.82) ?? normalizeGeographicLocation("");
  const country = countryByCodeValue(normalized.countryCode);
  const subdivisionName = normalized.subdivisionName;
  const region = !country && normalized.regionCodes.length ? REGIONS.find((item) => item.code === normalized.regionCodes[0]) ?? null : null;
  const locationParts = [normalized.city, subdivisionName, country?.name].filter((value, index, items): value is string => Boolean(value) && items.indexOf(value) === index);
  const location = normalized.confidence >= 0.82 ? locationParts.join(", ") || region?.name || null : null;
  return {
    name,
    skills,
    suggestedRoles: suggestedRoles.length ? suggestedRoles : ["Entry-level opportunities"],
    location,
  };
}
