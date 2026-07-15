export type ScoreDimension = {
  name: string;
  score: number;
  evidence: string;
};

export type CareerDossier = {
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  verdict: "Apply now" | "Worth applying" | "Consider carefully" | "Skip";
  roleSummary: string;
  whyThisRole: string;
  dimensions: ScoreDimension[];
  strengths: string[];
  gaps: string[];
  legitimacy: {
    rating: "High confidence" | "Proceed with caution" | "Suspicious";
    signals: string[];
  };
  keywords: string[];
  resume: {
    headline: string;
    summary: string;
    bulletRewrites: string[];
    missingEvidence: string[];
  };
  coverLetter: string;
  recruiterMessage: string;
  interview: {
    likelyQuestions: string[];
    storiesToPrepare: string[];
    questionsToAsk: string[];
  };
  nextActions: string[];
  generatedAt: string;
  provider: string;
};

export type ApplicationRecord = {
  stage: import("./jobs").ApplicationStage;
  createdAt: string;
  updatedAt: string;
  nextAction?: string;
  note?: string;
};
