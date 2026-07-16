export type RegistryCompany = string | { name: string; domain?: string };

export function registryCompanyLabel(company: RegistryCompany) {
  return typeof company === "string" ? company : company.name;
}
