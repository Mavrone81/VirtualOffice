// Prisma returns enum *member names* (e.g. "SalesAssociate", "PendingCollection").
// Humanize them for display.
const SPECIAL: Record<string, string> = {
  AddOn: "Add-on",
  PendingCollection: "Pending Collection",
  CompanyRetained: "Company Retained",
  ExternalPayable: "External Payable",
  FullPayment: "Full Payment",
  ComputerGenerated: "Computer-Generated",
};

export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  if (SPECIAL[value]) return SPECIAL[value];
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}
