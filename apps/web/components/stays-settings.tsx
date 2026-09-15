"use client";

import { useState } from "react";
import { Building2, Plus, Ship } from "lucide-react";
import type { Session } from "@/lib/types";
import { useMutation, useResource } from "@/lib/client";
import {
  Empty,
  Field,
  FormDialog,
  Loading,
  Notice,
  SearchBox,
} from "./common";

type Vessel = {
  id: string;
  name: string;
  cruise_line: string | null;
  imo: string | null;
  passenger_capacity: number | null;
  active: boolean;
  /** false for platform-seeded entries shared by every tenant. */
  tenant_owned: boolean;
};

type Accommodation = {
  id: string;
  name: string;
  address: string;
  tenant_owned: boolean;
};

type StayOptions = { vessels: Vessel[]; accommodations: Accommodation[] };

const emptyVessel = { name: "", cruiseLine: "" };
const emptyStay = { name: "", address: "" };

type StaysTab = "vessels" | "properties";

export function StaysSettings({ session }: { session: Session }) {
  const canWrite = session.permissions.includes("operations.write");
  const [tab, setTab] = useState<StaysTab>("vessels");
  const [search, setSearch] = useState("");

  const vessels = useResource<Vessel[]>(
    `ops/v1/stays/vessels${search ? `?q=${encodeURIComponent(search)}` : ""}`,
  );
  const options = useResource<StayOptions>("ops/v1/stays/options");
  const vesselMutation = useMutation();
  const stayMutation = useMutation();

  const [vesselForm, setVesselForm] = useState(emptyVessel);
  const [stayForm, setStayForm] = useState(emptyStay);
  const [vesselOpen, setVesselOpen] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const stays = options.data?.accommodations ?? [];
  const onVessels = tab === "vessels";

  function openVessel() {
    setVesselForm(emptyVessel);
    vesselMutation.clear();
    setNotice("");
    setVesselOpen(true);
  }

  function openStay() {
    setStayForm(emptyStay);
    stayMutation.clear();
    setNotice("");
    setStayOpen(true);
  }

  async function submitVessel() {
    const result = await vesselMutation.run<{
      id: string;
      name: string;
      alreadyListed?: boolean;
    }>("ops/v1/stays/vessels", {
      name: vesselForm.name,
      ...(vesselForm.cruiseLine ? { cruiseLine: vesselForm.cruiseLine } : {}),
    });
    if (result) {
      setVesselOpen(false);
      setVesselForm(emptyVessel);
      if (result.alreadyListed)
        setNotice(`${result.name} is already in the shared list.`);
      vessels.reload();
      options.reload();
    }
  }

  async function submitStay() {
    const result = await stayMutation.run<{
      id: string;
      name: string;
      alreadyListed?: boolean;
    }>("ops/v1/stays/accommodations", {
      name: stayForm.name,
      address: stayForm.address,
    });
    if (result) {
      setStayOpen(false);
      setStayForm(emptyStay);
      if (result.alreadyListed)
        setNotice(`${result.name} is already listed.`);
      options.reload();
    }
  }

  return (
    <section>
      <div className="settings-card-head">
        <Ship size={20} />
        <div>
          <h2>Vessels &amp; properties</h2>
          <p>
            Where a guest arrived from. Optional on a booking, shown on the
            waiver and used for emergency contact. Most entries are shared and
            already filled in — add one only if it is missing.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            className="button catalog-add-btn settings-head-action"
            aria-label={onVessels ? "Add vessel" : "Add property"}
            onClick={onVessels ? openVessel : openStay}
          >
            <Plus size={17} />
            <span className="button-label">
              {onVessels ? "Add vessel" : "Add property"}
            </span>
          </button>
        )}
      </div>

      <div className="view-action-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Stay sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={onVessels}
            onClick={() => setTab("vessels")}
          >
            Vessels
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!onVessels}
            onClick={() => setTab("properties")}
          >
            Properties
            {stays.length > 0 && (
              <span className="tab-count">{stays.length}</span>
            )}
          </button>
        </div>
        {onVessels && (
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search vessels"
          />
        )}
      </div>

      {notice && <Notice>{notice}</Notice>}

      {onVessels ? (
        vessels.error ? (
          <Notice error>{vessels.error}</Notice>
        ) : !vessels.data ? (
          <Loading />
        ) : !vessels.data.length ? (
          <Empty title={search ? "No vessels match" : "No vessels yet"}>
            <p>
              {search
                ? "Try a different name, or add this ship if it is genuinely missing."
                : "The shared list looks empty — add the ships your guests arrive on."}
            </p>
          </Empty>
        ) : (
          <div className="settings-list">
            {vessels.data.map((vessel) => (
              <article key={vessel.id}>
                <div>
                  <strong>
                    {vessel.name}
                    {vessel.tenant_owned ? (
                      <span className="status inactive">Yours</span>
                    ) : null}
                  </strong>
                  <p>
                    {[
                      vessel.cruise_line,
                      vessel.imo && `IMO ${vessel.imo}`,
                      vessel.passenger_capacity &&
                        `${vessel.passenger_capacity.toLocaleString()} guests`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Shared entry"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )
      ) : options.error ? (
        <Notice error>{options.error}</Notice>
      ) : !options.data ? (
        <Loading />
      ) : !stays.length ? (
        <Empty title="No properties yet">
          <p>
            Add the hotels and rentals your guests stay at so pickups can be
            planned against a known address.
          </p>
          {canWrite && (
            <button type="button" className="button" onClick={openStay}>
              <Plus size={16} /> Add property
            </button>
          )}
        </Empty>
      ) : (
        <div className="settings-list">
          {stays.map((stay) => (
            <article key={stay.id}>
              <div>
                <strong>
                  <Building2 size={14} aria-hidden="true" /> {stay.name}
                  {stay.tenant_owned ? (
                    <span className="status inactive">Yours</span>
                  ) : null}
                </strong>
                <p>{stay.address || "No address recorded"}</p>
              </div>
            </article>
          ))}
        </div>
      )}

      <FormDialog
        open={vesselOpen}
        title="Add vessel"
        description="Only needed when a ship is missing from the shared list. Check the list first — a match there is available to every tenant already."
        busy={vesselMutation.busy}
        error={vesselMutation.error}
        submitLabel="Add vessel"
        submitDisabled={!vesselForm.name.trim()}
        onClose={() => {
          if (!vesselMutation.busy) setVesselOpen(false);
        }}
        onSubmit={submitVessel}
      >
        <div className="form-grid">
          <Field label="Vessel name" required>
            <input
              required
              maxLength={160}
              value={vesselForm.name}
              placeholder="e.g. Rhapsody of the Seas"
              onChange={(e) =>
                setVesselForm((v) => ({ ...v, name: e.target.value }))
              }
            />
          </Field>
          <Field label="Cruise line" hint="Optional.">
            <input
              maxLength={160}
              value={vesselForm.cruiseLine}
              placeholder="e.g. Royal Caribbean International"
              onChange={(e) =>
                setVesselForm((v) => ({ ...v, cruiseLine: e.target.value }))
              }
            />
          </Field>
        </div>
      </FormDialog>

      <FormDialog
        open={stayOpen}
        title="Add property"
        description="A hotel, resort or rental guests stay at. Pickup planning uses the address for meeting points."
        busy={stayMutation.busy}
        error={stayMutation.error}
        submitLabel="Add property"
        submitDisabled={!stayForm.name.trim()}
        onClose={() => {
          if (!stayMutation.busy) setStayOpen(false);
        }}
        onSubmit={submitStay}
      >
        <Field label="Property name" required>
          <input
            required
            maxLength={160}
            value={stayForm.name}
            placeholder="e.g. Jolly Beach Resort"
            onChange={(e) =>
              setStayForm((v) => ({ ...v, name: e.target.value }))
            }
          />
        </Field>
        <Field label="Address" hint="Used as pickup context for dispatch.">
          <input
            maxLength={300}
            value={stayForm.address}
            onChange={(e) =>
              setStayForm((v) => ({ ...v, address: e.target.value }))
            }
          />
        </Field>
      </FormDialog>
    </section>
  );
}
