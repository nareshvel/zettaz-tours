"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { useMutation } from "@/lib/client";
import { ConfirmDialog } from "./common";

export type StartTripGuest = {
  id: string;
  name: string;
};

export type StartTripReadiness = {
  confirmedGuests: number;
  boardedGuests: number;
  noShowGuests: number;
  boardingPending: number;
  pickupRequired: number;
  pickupPlanned: number;
  pickupUnresolved: number;
  operationalStatus: "open" | "weather_hold" | "closed" | string;
};

function pendingNames(guests: StartTripGuest[], limit = 8) {
  if (!guests.length) return "";
  const names = guests.slice(0, limit).map((guest) => guest.name);
  const extra = guests.length - names.length;
  return extra > 0
    ? `${names.join(", ")}, and ${extra} more`
    : names.join(", ");
}

function startBlockReason(
  readiness: StartTripReadiness | undefined,
): string | null {
  if (!readiness) return null;
  if (readiness.confirmedGuests <= 0)
    return "No confirmed guests — use Weather hold or Close if this departure should not run.";
  if (readiness.operationalStatus !== "open" && readiness.boardedGuests <= 0)
    return readiness.operationalStatus === "weather_hold"
      ? "On weather hold with nobody boarded — reopen to sell/board, or keep hold without starting."
      : "Closed with nobody boarded — reopen or use Recovery instead of Start.";
  return null;
}

function readinessIssues(
  readiness: StartTripReadiness | undefined,
  pending: number,
  named: string,
): {
  warnings: string[];
  needsReason: boolean;
  danger: boolean;
  title: string;
  blocked: string | null;
} {
  const blocked = startBlockReason(readiness);
  const warnings: string[] = [];
  if (blocked) {
    return {
      warnings: [blocked],
      needsReason: false,
      danger: true,
      title: "Cannot start this trip",
      blocked,
    };
  }
  if (!readiness) {
    if (pending > 0) {
      warnings.push(
        `${pending} guest${pending === 1 ? "" : "s"} still not boarded${named ? ` (${named})` : ""} will be marked no-show.`,
      );
      return {
        warnings,
        needsReason: true,
        danger: true,
        title: "Start trip with no-shows?",
        blocked: null,
      };
    }
    return {
      warnings: [
        "Records that this departure has left. Boarding for late walk-ups stays a separate audited exception.",
      ],
      needsReason: false,
      danger: false,
      title: "Start this trip?",
      blocked: null,
    };
  }

  const {
    confirmedGuests,
    boardedGuests,
    noShowGuests,
    boardingPending,
    pickupRequired,
    pickupPlanned,
    pickupUnresolved,
    operationalStatus,
  } = readiness;

  warnings.push(
    `Boarding: ${boardedGuests} boarded · ${boardingPending} pending · ${noShowGuests} no-show · ${confirmedGuests} confirmed.`,
  );

  if (boardingPending > 0) {
    warnings.push(
      `${boardingPending} guest${boardingPending === 1 ? "" : "s"} still not boarded${named ? ` (${named})` : ""} will be marked no-show.`,
    );
  } else if (boardedGuests === 0) {
    warnings.push(
      "Nobody is boarded yet — remaining guests will be marked no-show if still pending, or the run leaves with no boarded guests.",
    );
  } else if (boardedGuests < confirmedGuests - noShowGuests) {
    warnings.push(
      "Partial boarding — remaining unresolved guests will be marked no-show.",
    );
  }

  if (pickupUnresolved > 0) {
    warnings.push(
      `${pickupUnresolved} pickup follow-up${pickupUnresolved === 1 ? "" : "s"} still open. Confirm the stop plan before leaving, or note why in the reason.`,
    );
  }
  if (pickupRequired > pickupPlanned) {
    warnings.push(
      `Pickup plan incomplete (${pickupPlanned}/${pickupRequired} arranged pickups planned).`,
    );
  }
  if (operationalStatus === "weather_hold") {
    warnings.push(
      "Departure is on weather hold (not sellable). Only start if boarded guests are actually leaving.",
    );
  } else if (operationalStatus === "closed") {
    warnings.push(
      "Departure is closed (not sellable). Only start if boarded guests are actually leaving.",
    );
  }

  const needsReason =
    boardingPending > 0 ||
    pickupUnresolved > 0 ||
    pickupRequired > pickupPlanned ||
    operationalStatus !== "open" ||
    boardedGuests === 0;

  const danger =
    boardingPending > 0 || boardedGuests === 0 || operationalStatus !== "open";

  let title = "Start this trip?";
  if (boardingPending > 0) title = "Start trip with no-shows?";
  else if (pickupUnresolved > 0 || pickupRequired > pickupPlanned)
    title = "Start with pickup issues?";
  else if (operationalStatus !== "open") title = "Start while not sellable?";
  else if (boardedGuests === 0) title = "Start with nobody boarded?";

  return { warnings, needsReason, danger, title, blocked: null };
}

export function StartTripButton({
  departureId,
  pendingGuests = [],
  pendingCount,
  readiness,
  tripRunState,
  canStart,
  variant = "primary",
  onStarted,
}: {
  departureId: string;
  pendingGuests?: StartTripGuest[];
  /** Use when names are not available (Day Board counts). */
  pendingCount?: number;
  readiness?: StartTripReadiness;
  tripRunState: string | null | undefined;
  canStart: boolean;
  variant?: "primary" | "secondary";
  onStarted: () => void;
}) {
  const start = useMutation();
  const unstart = useMutation();
  const [open, setOpen] = useState(false);
  const [unstartOpen, setUnstartOpen] = useState(false);
  const started = tripRunState === "departed";
  const terminal = ["completed", "cancelled"].includes(tripRunState ?? "");
  const pending = pendingCount ?? pendingGuests.length;
  const named = pendingNames(pendingGuests);
  const check = useMemo(
    () =>
      readinessIssues(
        readiness ? { ...readiness, boardingPending: pending } : undefined,
        pending,
        named,
      ),
    [readiness, pending, named],
  );

  if (!canStart && !started && !terminal) return null;

  if (terminal)
    return (
      <button type="button" className="button secondary" disabled>
        Trip {tripRunState === "cancelled" ? "cancelled" : "completed"}
      </button>
    );

  if (started)
    return (
      <>
        <button
          type="button"
          className="button secondary"
          disabled={unstart.busy}
          onClick={() => setUnstartOpen(true)}
        >
          Undo start
        </button>
        <ConfirmDialog
          open={unstartOpen}
          title="Undo trip start?"
          description="Moves the run back to boarding. Guest no-shows recorded at start are not reversed."
          confirmLabel="Undo start"
          danger
          reasonRequired
          reasonLabel="Reason"
          reasonPlaceholder="e.g. Started by mistake on an empty weather-held departure"
          busy={unstart.busy}
          error={unstart.error}
          onClose={() => {
            if (!unstart.busy) setUnstartOpen(false);
          }}
          onConfirm={async (reason) => {
            const result = await unstart.run(
              `ops/v1/departures/${departureId}/unstart`,
              { reason: reason.trim() },
            );
            if (result) {
              setUnstartOpen(false);
              onStarted();
            }
          }}
        />
      </>
    );

  if (check.blocked)
    return (
      <button
        type="button"
        className="button secondary"
        disabled
        title={check.blocked}
      >
        <Play size={16} aria-hidden="true" /> Start trip
      </button>
    );

  const description: ReactNode = (
    <span className="start-trip-checklist">
      {check.warnings.map((warning) => (
        <span key={warning}>{warning}</span>
      ))}
    </span>
  );

  return (
    <>
      <button
        type="button"
        className={variant === "secondary" ? "button secondary" : "button"}
        disabled={start.busy}
        onClick={() => setOpen(true)}
      >
        <Play size={16} aria-hidden="true" /> Start trip
      </button>
      <ConfirmDialog
        open={open}
        title={check.title}
        description={description}
        confirmLabel={pending > 0 ? "Mark no-show & start" : "Start trip"}
        danger={check.danger}
        reasonRequired={check.needsReason}
        reasonLabel="Reason"
        reasonPlaceholder={
          check.needsReason
            ? pending > 0
              ? "e.g. Guests did not arrive before departure"
              : "e.g. Pickup follow-ups accepted / weather hold with boarded guests"
            : undefined
        }
        busy={start.busy}
        error={start.error}
        onClose={() => {
          if (!start.busy) setOpen(false);
        }}
        onConfirm={async (reason) => {
          const result = await start.run(
            `ops/v1/departures/${departureId}/start`,
            {
              markRemainingNoShow: pending > 0,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            },
          );
          if (result) {
            setOpen(false);
            onStarted();
          }
        }}
      />
    </>
  );
}
