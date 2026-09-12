"use client";

import {
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import type { Session } from "@/lib/types";
import { dateTime, label, useMutation, useResource } from "@/lib/client";
import { Empty, Heading, Loading, Notice, Status } from "./common";

type Passenger = {
  id: string;
  name: string;
  category: string;
  is_minor: boolean;
  identity_pending: boolean;
  checkin_state: string | null;
  waiver_signed: boolean;
};
type Guest = {
  booking_id: string;
  lead_name: string;
  party_size: number;
  pickup: { kind?: string };
  passengers: Passenger[];
};
type Trip = {
  id: string;
  starts_at: string;
  product_name: string;
  assignment_roles: string[];
  guests: Guest[];
};
type CrewDay = {
  date: string;
  waiverTemplate: { id: string; version: number; title: string } | null;
  trips: Trip[];
};

const tripStates = ["preparing", "boarding", "departed", "completed"];

export function CrewWorkspace({ session }: { session: Session }) {
  const day = useResource<CrewDay>("crew/v1/today");
  const update = useMutation();

  async function updateTrip(tripId: string, state: string) {
    const result = await update.run(`crew/v1/departures/${tripId}/events`, {
      state,
    });
    if (result) day.reload();
  }

  return (
    <>
      <Heading
        eyebrow="CREW WORKSPACE"
        title="My assigned trips"
        description="Today’s departures, guests, waiver readiness, and trip progress."
        action={
          <button
            className="button secondary"
            onClick={day.reload}
            type="button"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />
      {day.error && <Notice error>{day.error}</Notice>}
      {update.error && <Notice error>{update.error}</Notice>}
      {!day.data ? (
        <Loading />
      ) : !day.data.trips.length ? (
        <section className="panel">
          <Empty title="No trips assigned today">
            <p>Your dispatcher’s active assignments will appear here.</p>
          </Empty>
        </section>
      ) : (
        <div className="crew-trip-list">
          {day.data.trips.map((trip) => (
            <section className="panel crew-trip" key={trip.id}>
              <div className="crew-trip-heading">
                <div className="crew-trip-title">
                  <span className="crew-trip-icon">
                    <CalendarDays size={20} />
                  </span>
                  <div>
                    <p className="eyebrow">
                      {trip.assignment_roles.map(label).join(" · ")}
                    </p>
                    <h2>{trip.product_name}</h2>
                    <p>{dateTime(trip.starts_at, session.tenant.timezone)}</p>
                  </div>
                </div>
                <div
                  className="crew-trip-actions"
                  aria-label="Update trip status"
                >
                  {tripStates.map((state) => (
                    <button
                      className="button secondary"
                      disabled={update.busy}
                      key={state}
                      onClick={() => void updateTrip(trip.id, state)}
                      type="button"
                    >
                      {label(state)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="crew-guest-heading">
                <UsersRound size={18} />
                <strong>
                  {trip.guests.length} booking
                  {trip.guests.length === 1 ? "" : "s"}
                </strong>
              </div>
              {!trip.guests.length ? (
                <Empty title="No confirmed guests on this departure" />
              ) : (
                <div className="crew-guests">
                  {trip.guests.map((guest) => (
                    <article className="crew-guest" key={guest.booking_id}>
                      <div>
                        <strong>{guest.lead_name}</strong>
                        <small>
                          {guest.party_size} guest
                          {guest.party_size === 1 ? "" : "s"} · Pickup{" "}
                          {label(guest.pickup?.kind ?? "none")}
                        </small>
                      </div>
                      <div className="crew-passengers">
                        {guest.passengers.map((passenger) => (
                          <div className="crew-passenger" key={passenger.id}>
                            <span>
                              <strong>
                                {passenger.identity_pending
                                  ? "Guest name required"
                                  : passenger.name}
                              </strong>
                              <small>
                                {label(passenger.category)}
                                {passenger.is_minor ? " · Minor" : ""}
                              </small>
                            </span>
                            <span className="crew-readiness">
                              <Status
                                state={passenger.checkin_state ?? "not_arrived"}
                              />
                              <span
                                className={
                                  passenger.waiver_signed ? "ready" : "required"
                                }
                              >
                                <CheckCircle2 size={15} />{" "}
                                {passenger.waiver_signed
                                  ? "Waiver signed"
                                  : "Waiver required"}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
