export type OccupancyClass = "adult" | "child" | "none";

export function defaultOccupancyClass(
  slug: string,
  countsTowardCapacity: boolean,
): OccupancyClass {
  if (!countsTowardCapacity) return "none";
  if (slug === "child") return "child";
  return "adult";
}

export function resolveOccupancyClass(input: {
  slug: string;
  countsTowardCapacity: boolean;
  occupancyClass?: OccupancyClass;
}): OccupancyClass {
  return input.occupancyClass ?? defaultOccupancyClass(
    input.slug,
    input.countsTowardCapacity,
  );
}

export function occupancyCaption(input: {
  capacity: number | null | undefined;
  capacityAdult?: number | null;
  capacityChild?: number | null;
}) {
  if (input.capacity == null) return "—";
  const adult = input.capacityAdult ?? input.capacity;
  const extra = input.capacity - adult;
  if (input.capacityChild != null)
    return `${input.capacity} occupancy · ${adult} adults · ${input.capacityChild} children`;
  if (adult === input.capacity) return `${input.capacity} occupancy`;
  return `${input.capacity} occupancy · ${adult} adults${extra ? ` (${extra} child/mixed)` : ""}`;
}

export function occupancyRemainingCopy(input: {
  available: number;
  availableAdults: number;
  availableChildren: number | null;
}) {
  if (input.available <= 0) return "Sold out";
  if (input.availableAdults <= 0 && input.available > 0)
    return `${input.available} occupancy left · sold out for adults`;
  if (input.availableChildren != null && input.availableChildren <= 0)
    return `${input.availableAdults} adult place${input.availableAdults === 1 ? "" : "s"} left · no child places`;
  if (input.availableChildren != null)
    return `${input.available} occupancy · ${input.availableAdults} adult · ${input.availableChildren} child place${input.availableChildren === 1 ? "" : "s"} left`;
  return `${input.available} occupancy · ${input.availableAdults} adult place${input.availableAdults === 1 ? "" : "s"} left`;
}
