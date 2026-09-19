import { occupancyPressure } from "@/lib/types";

export type OccupancySnapshot = {
  capacity: number;
  capacity_adult?: number;
  capacity_child?: number | null;
  committed: number;
  committed_adults?: number;
  committed_children?: number;
  available?: number;
  available_adults?: number;
  available_children?: number | null;
};

function occupancyTracks(d: OccupancySnapshot) {
  const adultCap = d.capacity_adult ?? d.capacity;
  const childCap = d.capacity_child;
  const nested = adultCap !== d.capacity;
  const partitioned = childCap != null;
  const tracks: {
    key: string;
    label: string;
    committed: number;
    capacity: number;
    available?: number | null;
  }[] = [
    {
      key: "occupancy",
      label: "Occupancy",
      committed: d.committed,
      capacity: d.capacity,
      available: d.available,
    },
  ];
  if (nested || partitioned) {
    tracks.push({
      key: "adults",
      label: "Adults",
      committed: d.committed_adults ?? Math.min(d.committed, adultCap),
      capacity: adultCap,
      available: d.available_adults,
    });
  }
  if (partitioned) {
    tracks.push({
      key: "children",
      label: "Children",
      committed: d.committed_children ?? 0,
      capacity: childCap,
      available: d.available_children,
    });
  }
  return tracks;
}

export function OccupancyMeters({
  departure,
  compact,
}: {
  departure: OccupancySnapshot;
  compact?: boolean;
}) {
  const tracks = occupancyTracks(departure);
  return (
    <div
      className={
        "occupancy-meters" +
        (compact ? " is-compact" : "") +
        (tracks.length > 1 ? " is-split" : "")
      }
    >
      {tracks.map((track) => {
        const pressure = occupancyPressure({
          committed: track.committed,
          capacity: track.capacity,
          available: track.available ?? undefined,
        });
        return (
          <div key={track.key} className={"capacity-meter is-" + pressure}>
            <span
              style={{
                width: `${Math.min(
                  100,
                  track.capacity ? (track.committed / track.capacity) * 100 : 0,
                )}%`,
              }}
            />
            <small>
              {track.committed} of {track.capacity} {track.label.toLowerCase()}
            </small>
          </div>
        );
      })}
    </div>
  );
}
