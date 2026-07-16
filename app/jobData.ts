import type { Job, JobType, SalaryPeriod } from "./jobs";
import { classifyOpportunity } from "../shared/opportunityTaxonomy.ts";

export type ExchangeRates = Record<string, number>;

export const FALLBACK_USD_RATES: ExchangeRates = {
  USD: 1,
  EUR: 0.88,
  GBP: 0.75,
  INR: 96,
  JPY: 162,
  CAD: 1.37,
  AUD: 1.53,
  SGD: 1.28,
  CHF: 0.8,
  CNY: 7.18,
  KRW: 1_385,
};

export function normalizeCurrency(value: string | null | undefined, fallback = "USD") {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
}

export function classifyJobType(title: string, employmentType = ""): JobType {
  const opportunity = classifyOpportunity({ structuredLabel: employmentType, title });
  if (opportunity.category !== "unknown") return opportunity.jobType;
  const value = `${title} ${employmentType}`;
  if (/\bcontract(?:or)?\b|\btemporary\b|\bfreelance\b/i.test(value)) return "Contract";
  if (/\bpart[ -]?time\b/i.test(value)) return "Part-time";
  if (/\bjunior\b|\bentry[ -]?level\b|\bnew grad\b|\bearly career\b/i.test(value)) return "Entry-level";
  return "Full-time";
}

export function normalizeSalaryPeriod(value: string | null | undefined): SalaryPeriod {
  const normalized = value?.toLowerCase() ?? "";
  if (/hour/.test(normalized)) return "hour";
  if (/day|daily/.test(normalized)) return "day";
  if (/week/.test(normalized)) return "week";
  if (/month/.test(normalized)) return "month";
  return "year";
}

export function annualSalary(amount: number, period: SalaryPeriod) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (period === "hour") return amount * 2_080;
  if (period === "day") return amount * 260;
  if (period === "week") return amount * 52;
  if (period === "month") return amount * 12;
  return amount;
}

export function salaryUsdEquivalent(job: Pick<Job, "salaryMin" | "salaryMax" | "salaryPeriod" | "currency">, rates: ExchangeRates, bound: "min" | "max" = "max") {
  const rate = rates[normalizeCurrency(job.currency)];
  if (!rate || rate <= 0) return null;
  const amount = bound === "min" ? job.salaryMin : job.salaryMax || job.salaryMin;
  return annualSalary(amount, job.salaryPeriod) / rate;
}

export function formatSalary(job: Pick<Job, "salaryMin" | "salaryMax" | "salaryPeriod" | "currency">) {
  if (!job.salaryMin) return "Salary not listed";
  const currency = normalizeCurrency(job.currency);
  const period = job.salaryPeriod === "year" ? "yr" : job.salaryPeriod === "month" ? "mo" : job.salaryPeriod === "week" ? "wk" : job.salaryPeriod === "day" ? "day" : "hr";
  try {
    const compact = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: currency === "INR" || currency === "JPY" ? 1 : 0,
    });
    return `${compact.format(job.salaryMin)}–${compact.format(job.salaryMax)}/${period}`;
  } catch {
    return `${currency} ${job.salaryMin.toLocaleString()}–${job.salaryMax.toLocaleString()}/${period}`;
  }
}
