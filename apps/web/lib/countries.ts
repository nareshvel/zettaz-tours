/** Re-export shared ISO country list for web imports via `@/lib/countries`. */
export {
  COUNTRIES,
  TIMEZONES,
  CURRENCIES,
  countryName,
  defaultTimezoneForCountry,
  currencyForCountry,
  type CountryOption,
} from "../../../packages/shared/src/countries";
