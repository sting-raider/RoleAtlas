import { extractText } from "unpdf";

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

function inferProfile(text: string) {
  const skills = SKILL_TERMS.filter((skill) => new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}\\b`, "i").test(text)).slice(0, 24);
  const suggestedRoles = ROLE_SIGNALS.filter(([pattern]) => pattern.test(text)).map(([, role]) => role).slice(0, 8);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines.find((line) => line.length >= 3 && line.length <= 60 && !/@|https?:|resume|curriculum|phone|mobile/i.test(line)) ?? "Candidate";
  const location = /\b(bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|noida|chennai|kolkata|india)\b/i.exec(text)?.[0] ?? null;
  return {
    name,
    skills,
    suggestedRoles: suggestedRoles.length ? suggestedRoles : ["Entry-level opportunities"],
    location: location ? (location.toLowerCase() === "india" ? "India" : `${location}, India`) : null,
  };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("resume");
    if (!(file instanceof File)) return Response.json({ error: "Choose a PDF résumé." }, { status: 400 });
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return Response.json({ error: "The résumé must be a PDF." }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return Response.json({ error: "The PDF must be smaller than 8 MB." }, { status: 400 });

    const { text, totalPages } = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true });
    const cleaned = text.replace(/\0/g, "").replace(/[ \t]+/g, " ").trim();
    if (cleaned.length < 80) return Response.json({ error: "This PDF contains too little readable text. Export the résumé as a text-based PDF rather than a scanned image." }, { status: 422 });
    const limited = cleaned.slice(0, 60_000);
    return Response.json({ fileName: file.name, totalPages, text: limited, ...inferProfile(limited) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The résumé could not be read." }, { status: 400 });
  }
}
