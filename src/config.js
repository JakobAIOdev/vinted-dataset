export const REGIONS = [
  { code: "de", label: "Germany", domain: "vinted.de" },
  { code: "fr", label: "France", domain: "vinted.fr" },
  { code: "ee", label: "Estonia", domain: "vinted.ee" },
  { code: "it", label: "Italy", domain: "vinted.it" },
  { code: "es", label: "Spain", domain: "vinted.es" },
  { code: "nl", label: "Netherlands", domain: "vinted.nl" },
  { code: "lv", label: "Latvia", domain: "vinted.lv" },
  { code: "pl", label: "Poland", domain: "vinted.pl" },
  { code: "pt", label: "Portugal", domain: "vinted.pt" },
  { code: "be", label: "Belgium", domain: "vinted.be" },
  { code: "at", label: "Austria", domain: "vinted.at" },
  { code: "lu", label: "Luxembourg", domain: "vinted.lu" },
  { code: "uk", label: "United Kingdom", domain: "vinted.co.uk" },
  { code: "cz", label: "Czech Republic", domain: "vinted.cz" },
  { code: "sk", label: "Slovakia", domain: "vinted.sk" },
  { code: "lt", label: "Lithuania", domain: "vinted.lt" },
  { code: "si", label: "Slovenia", domain: "vinted.si" },
  { code: "se", label: "Sweden", domain: "vinted.se" },
  { code: "dk", label: "Denmark", domain: "vinted.dk" },
  { code: "ro", label: "Romania", domain: "vinted.ro" },
  { code: "hu", label: "Hungary", domain: "vinted.hu" },
  { code: "hr", label: "Croatia", domain: "vinted.hr" },
  { code: "fi", label: "Finland", domain: "vinted.fi" },
  { code: "gr", label: "Greece", domain: "vinted.gr" },
  { code: "ie", label: "Ireland", domain: "vinted.ie" }
];

export const ROOT_CATALOGS = [
  { id: 1904, slug: "women" },
  { id: 5, slug: "men" },
  { id: 1193, slug: "kids" },
  { id: 1918, slug: "home" },
  { id: 2309, slug: "entertainment" },
  { id: 2093, slug: "pet-supplies" }
];

export const DEFAULT_OUTPUT_DIR = new URL("../output/", import.meta.url);

export const BRAND_PREFIX_ALPHABET = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."0123456789",
  "&",
  "'",
  "-",
  "."
];
