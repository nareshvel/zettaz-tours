/** Operational coverage: assigned named-asset seats vs booked occupancy. Not inventory. */

export type FleetAssignmentSeats = {
  resource_id?: string | null;
  resource_capacity?: number | null;
};

export type FleetCoverage =
  | { kind: "none" }
  | { kind: "unknown" }
  | { kind: "ok"; seats: number; booked: number }
  | { kind: "short"; seats: number; booked: number };

export function fleetSeatCoverage(
  assigned: FleetAssignmentSeats[],
  booked: number,
): FleetCoverage {
  const fleet = assigned.filter((item) => item.resource_id);
  if (fleet.length === 0) return { kind: "none" };
  const known = fleet.filter(
    (item) => item.resource_capacity != null && Number.isFinite(item.resource_capacity),
  );
  if (known.length === 0) return { kind: "unknown" };
  const seats = known.reduce(
    (sum, item) => sum + Number(item.resource_capacity),
    0,
  );
  if (seats < booked) return { kind: "short", seats, booked };
  return { kind: "ok", seats, booked };
}

export function coverageLine(cover: FleetCoverage): string | null {
  if (cover.kind === "ok" || cover.kind === "short")
    return `Assigned seats ${cover.seats} · booked ${cover.booked} occupancy`;
  return null;
}

export function coverageSuffix(cover: FleetCoverage): string {
  const line = coverageLine(cover);
  if (!line) return "";
  return cover.kind === "short"
    ? ` · ${line} · short of booked occupancy`
    : ` · ${line}`;
}
