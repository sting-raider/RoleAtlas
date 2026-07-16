import taxonomyData from "./taxonomy/opportunity-types.json" with { type: "json" };

export type OpportunityCategory = "contract_internship" | "internship" | "co_op" | "fellowship" | "apprenticeship" | "trainee" | "student_program" | "graduate_program" | "placement" | "working_student" | "entry_level" | "unknown";
export type OpportunityJobType = "Internship" | "Entry-level" | "Apprenticeship" | "Full-time";
export type OpportunityClassification = {
  category: OpportunityCategory;
  jobType: OpportunityJobType;
  originalLabel: string;
  matchedTerm: string | null;
  evidenceSource: "structured" | "title" | "description" | "unresolved";
  confidence: number;
  evidence: string[];
};

type TaxonomyEntry = { category: OpportunityCategory; jobType: OpportunityJobType; terms: string[]; titleOnlyTerms?: string[]; descriptionTerms?: string[] };
export const OPPORTUNITY_TAXONOMY = taxonomyData as TaxonomyEntry[];

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function termMatch(value: string, term: string) {
  const haystack = ` ${normalized(value)} `;
  const needle = normalized(term);
  return needle.length > 0 && haystack.includes(` ${needle} `);
}

function find(value: string, source: "structured" | "title" | "description") {
  for (const entry of OPPORTUNITY_TAXONOMY) {
    const terms = source === "description" ? entry.descriptionTerms ?? [] : entry.terms;
    const term = terms.slice().sort((a, b) => b.length - a.length).find((candidate) => source !== "description" || !entry.titleOnlyTerms?.includes(candidate) ? termMatch(value, candidate) : false);
    if (term) return { entry, term };
  }
  return null;
}

export function classifyOpportunity(input: { structuredLabel?: string | null; title: string; description?: string | null }): OpportunityClassification {
  const candidates = [
    { source: "structured" as const, value: input.structuredLabel?.trim() ?? "", confidence: 0.98 },
    { source: "title" as const, value: input.title.trim(), confidence: 0.94 },
    { source: "description" as const, value: input.description?.trim() ?? "", confidence: 0.72 },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const match = find(candidate.value, candidate.source);
    if (match) return {
      category: match.entry.category,
      jobType: match.entry.jobType,
      originalLabel: candidate.value,
      matchedTerm: match.term,
      evidenceSource: candidate.source,
      confidence: candidate.confidence,
      evidence: [`${candidate.source} field matched “${match.term}” in the employer's original wording.`],
    };
  }
  return { category: "unknown", jobType: "Full-time", originalLabel: input.structuredLabel?.trim() || input.title, matchedTerm: null, evidenceSource: "unresolved", confidence: 0.25, evidence: ["No maintained early-career taxonomy term matched; the original employer label was preserved."] };
}
