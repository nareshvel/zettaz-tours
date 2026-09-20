export const FLEET_KIND_GROUPS = [
  {
    family: "land" as const,
    label: "Land",
    kinds: [
      { id: "vehicle", label: "Vehicle" },
      { id: "van", label: "Van" },
      { id: "bus", label: "Bus" },
      { id: "tuk_tuk", label: "Tuk-tuk" },
    ],
  },
  {
    family: "water" as const,
    label: "Water",
    kinds: [
      { id: "vessel", label: "Vessel" },
      { id: "boat", label: "Boat" },
      { id: "jetski", label: "Jet ski" },
      { id: "kayak", label: "Kayak" },
    ],
  },
  {
    family: "equipment" as const,
    label: "Equipment",
    kinds: [
      { id: "equipment", label: "Equipment" },
      { id: "snorkel_gear", label: "Snorkel gear" },
      { id: "other", label: "Other" },
    ],
  },
] as const;

export const FLEET_KIND_IDS = [
  "vehicle",
  "van",
  "bus",
  "tuk_tuk",
  "vessel",
  "boat",
  "jetski",
  "kayak",
  "equipment",
  "snorkel_gear",
  "other",
] as const;

export type FleetKind = (typeof FLEET_KIND_IDS)[number];
export type FleetKindFamily = (typeof FLEET_KIND_GROUPS)[number]["family"];

export function isFleetKind(value: string): value is FleetKind {
  return (FLEET_KIND_IDS as readonly string[]).includes(value);
}

export function fleetKindFamily(kind: string): FleetKindFamily {
  for (const group of FLEET_KIND_GROUPS) {
    if (group.kinds.some((item) => item.id === kind)) return group.family;
  }
  return "equipment";
}

export const FLEET_PAPER_SUGGESTIONS: Record<FleetKindFamily, string[]> = {
  land: ["Insurance", "Registration", "License", "Inspection"],
  water: ["Insurance", "Registration", "License", "Inspection"],
  equipment: ["Insurance", "Inspection"],
};

export function fleetPaperSuggestions(kind: string) {
  return FLEET_PAPER_SUGGESTIONS[fleetKindFamily(kind)];
}
