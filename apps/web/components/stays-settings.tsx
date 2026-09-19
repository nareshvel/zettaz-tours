"use client";

import { useState, type ReactNode } from "react";
import { Building2, Plus, Ship } from "lucide-react";
import type { Session } from "@/lib/types";
import { useMutation, useResource } from "@/lib/client";
import { Empty, Field, FormDialog, Loading, Notice, SearchBox } from "./common";

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
  const stayNeedle = search.trim().toLowerCase();
  const visibleStays = stayNeedle
    ? stays.filter((stay) =>
        [stay.name, stay.address]
          .join(" ")
          .toLowerCase()
          .includes(stayNeedle),
      )
    : stays;

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
      if (result.alreadyListed) setNotice(`${result.name} is already listed.`);
      options.reload();
    }
  }

  let list: ReactNode;
  if (onVessels) {
    if (vessels.error) list = <Notice error>{vessels.error}</Notice>;
    else if (!vessels.data) list = <Loading />;
    else if (!vessels.data.length)
      list = (
        <Empty title={search ? "No vessels match" : "No vessels yet"}>
          <p>
            {search
              ? "Try a different name, or add this ship if it is genuinely missing."
              : "The shared list looks empty — add the ships your guests arrive on."}
          </p>
        </Empty>
      );
    else
      list = (
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
                    .join(" · ") ||
                    (vessel.tenant_owned
                      ? "Added by your team"
                      : "Shared entry")}
                </p>
              </div>
            </article>
          ))}
        </div>
      );
  } else if (options.error) {
    list = <Notice error>{options.error}</Notice>;
  } else if (!options.data) {
    list = <Loading />;
  } else if (!visibleStays.length) {
    list = (
      <Empty
        title={stayNeedle ? "No properties match" : "No properties yet"}
      >
        <p>
          {stayNeedle
            ? "Try a different name, or add this hotel if it is genuinely missing."
            : "Add the hotels and rentals your guests stay at so pickups can be planned against a known address."}
        </p>
      </Empty>
    );
  } else {
    list = (
      <div className="settings-list">
        {visibleStays.map((stay) => (
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
    );
  }

  return (
    <section>
      <div className="settings-card-head">
        <Ship size={20} />
        <div>
          <h2>Vessels &amp; properties</h2>
          <p>
            Optional on a booking, shown on the waiver, and used for emergency
            contact. Shared ships and hotels are already listed — add one only
            if it is missing.
          </p>
        </div>
      </div>

      <div className="view-action-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Stay sections"
        >
          <button
            type="button"
            className="view-tab-link"
            role="tab"
            aria-selected={onVessels}
            onClick={() => setTab("vessels")}
          >
            Vessels
            {vessels.data && vessels.data.length > 0 && (
              <span className="tab-count">{vessels.data.length}</span>
            )}
          </button>
          <button
            type="button"
            className="view-tab-link"
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
      </div>
      <div className="staff-list-tools fleet-asset-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={onVessels ? "Search vessels" : "Search properties"}
        />
        {canWrite && (
          <button
            type="button"
            className="button catalog-add-btn"
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

      {notice && <Notice>{notice}</Notice>}

      {list}

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
