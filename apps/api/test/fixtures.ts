import { TenantConfig } from "../../../packages/shared/src/contracts";

// Synthetic inputs only: not catalog defaults and not approved tenant-one finance policy.
export const mockConfig: TenantConfig = {
  supportedLocales: ["en"],
  locale: "en",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  weekStartsOn: 0,
  numberFormat: "comma_decimal",
  measurementSystem: "metric",
  bookingCurrency: "USD",
  collectionCurrency: "USD",
  reportingCurrency: "USD",
  holdSeconds: 600,
  minimumPaidPercent: 100,
  taxBasisPoints: 0,
  allowUnresolvedPickup: false,
  allowAmendmentBalance: true,
  manualPaymentMethods: ["cash", "bank_transfer"],
  bookingSources: ["phone", "walk_in", "partner_reseller"],
};
export const mockProduct = {
  name: "Mock Coastal Discovery",
  optionName: "Shared morning departure",
  durationMinutes: 120,
  categories: [
    { slug: "adult", label: "Adult", countsTowardCapacity: true },
    { slug: "child", label: "Child", countsTowardCapacity: true },
    { slug: "infant", label: "Infant", countsTowardCapacity: false },
  ],
  rates: [
    {
      category: "adult",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      amountMinor: 10000,
    },
    {
      category: "child",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      amountMinor: 6000,
    },
    {
      category: "infant",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      amountMinor: 0,
    },
  ],
};
