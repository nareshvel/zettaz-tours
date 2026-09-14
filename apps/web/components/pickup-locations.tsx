"use client";

import { useState } from "react";
import { ExternalLink, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { PickupLocation, Session } from "@/lib/types";
import { label, useMutation, useResource } from "@/lib/client";
import { countryName } from "@/lib/countries";
import {
  ConfirmDialog,
  Empty,
  Field,
  FormDialog,
  Loading,
  Notice,
} from "./common";
import { LocationMapPreview } from "./location-map-preview";

const emptyLocationForm = {
  name: "",
  slug: "",
  kind: "hotel",
  notes: "",
  address: "",
  latitude: "",
  longitude: "",
  mapUrl: "",
  visibility: "internal",
};

type LocationForm = typeof emptyLocationForm;

function slugFromName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** City / parish / country from Tenant settings → General. */
function tenantDefaultPlace(
  profile: Session["tenant"]["business_profile"] | undefined,
) {
  if (!profile) return "";
  const country = profile.country
    ? countryName(profile.country) || profile.country
    : "";
  return [profile.city, profile.stateParish, country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}

function mapsQueryUrl(form: LocationForm) {
  const lat = form.latitude.trim();
  const lon = form.longitude.trim();
  if (lat && lon) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${lat},${lon}`,
    )}`;
  }
  const address = form.address.trim();
  if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      address,
    )}`;
  }
  return "";
}

function mapsLinkFromCoords(latitude: string, longitude: string) {
  const lat = latitude.trim();
  const lon = longitude.trim();
  if (!lat || !lon) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}`;
}

export function PickupLocationsSettings({ session }: { session: Session }) {
  const canWrite = session.permissions.includes("operations.write");
  const locations = useResource<PickupLocation[]>("ops/v1/pickup-locations");
  const locationMutation = useMutation();
  const removeLocation = useMutation();
  const tenantPlace = tenantDefaultPlace(session.tenant.business_profile);
  const [locationForm, setLocationForm] =
    useState<LocationForm>(emptyLocationForm);
  const [locationEditor, setLocationEditor] = useState<
    null | { mode: "create" } | { mode: "edit"; location: PickupLocation }
  >(null);
  const [pendingDelete, setPendingDelete] = useState<PickupLocation | null>(
    null,
  );

  function openCreateLocation() {
    setLocationForm({
      ...emptyLocationForm,
      address: tenantPlace,
    });
    setLocationEditor({ mode: "create" });
    locationMutation.clear();
  }

  function openEditLocation(location: PickupLocation) {
    setLocationForm({
      name: location.name,
      slug: location.slug,
      kind: location.kind,
      notes: location.notes ?? "",
      address: location.address ?? "",
      latitude:
        location.latitude === null || location.latitude === undefined
          ? ""
          : String(location.latitude),
      longitude:
        location.longitude === null || location.longitude === undefined
          ? ""
          : String(location.longitude),
      mapUrl: location.map_url ?? "",
      visibility: location.visibility,
    });
    setLocationEditor({ mode: "edit", location });
    locationMutation.clear();
  }

  async function submitLocation() {
    if (!locationEditor) return;
    const payload = {
      name: locationForm.name,
      kind: locationForm.kind,
      notes: locationForm.notes,
      address: locationForm.address,
      latitude: locationForm.latitude
        ? Number(locationForm.latitude)
        : undefined,
      longitude: locationForm.longitude
        ? Number(locationForm.longitude)
        : undefined,
      mapUrl: locationForm.mapUrl,
      visibility: locationForm.visibility,
      ...(locationEditor.mode === "create" ? { slug: locationForm.slug } : {}),
    };
    const result =
      locationEditor.mode === "create"
        ? await locationMutation.run("ops/v1/pickup-locations", payload)
        : await locationMutation.run(
            `ops/v1/pickup-locations/${locationEditor.location.id}`,
            payload,
            "PATCH",
          );
    if (result) {
      setLocationEditor(null);
      setLocationForm(emptyLocationForm);
      locations.reload();
    }
  }

  async function confirmDeleteLocation() {
    if (!pendingDelete) return;
    const result = await removeLocation.run(
      `ops/v1/pickup-locations/${pendingDelete.id}`,
      {},
      "DELETE",
    );
    if (result) {
      setPendingDelete(null);
      locations.reload();
    }
  }

  const previewMapsUrl = mapsQueryUrl(locationForm);
  const canFillMapUrl =
    Boolean(locationForm.latitude.trim() && locationForm.longitude.trim()) &&
    !locationForm.mapUrl.trim();

  return (
    <section>
      <div className="settings-card-head">
        <MapPin size={20} />
        <div>
          <h2>Pickup locations</h2>
          <p>
            Tenant-wide controlled hotels, ports, and meeting points. Day-of
            Plan pickups only sequences stops from this library.
          </p>
        </div>
      </div>
      {!canWrite && (
        <Notice>
          You can view locations. Creating or editing requires operations
          access.
        </Notice>
      )}
      {locations.error ? (
        <Notice error>{locations.error}</Notice>
      ) : !locations.data ? (
        <Loading />
      ) : !locations.data.length ? (
        <Empty title="No pickup locations yet">
          <p>
            Add hotels and meeting points here before dispatchers can plan
            stops.
          </p>
          {canWrite && (
            <button
              type="button"
              className="button"
              onClick={openCreateLocation}
            >
              <Plus size={16} /> Add location
            </button>
          )}
        </Empty>
      ) : (
        <>
          <div className="settings-list pickup-settings-list">
            {locations.data.map((location) => (
              <article key={location.id}>
                <div>
                  <strong>{location.name}</strong>
                  <p>
                    {label(location.kind)} · {location.slug}
                    {location.address ? ` · ${location.address}` : ""}
                    {location.latitude !== null &&
                    location.longitude !== null ? (
                      <>
                        {" · "}
                        {location.map_url ? (
                          <a
                            href={location.map_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            mapped
                          </a>
                        ) : (
                          "mapped"
                        )}
                      </>
                    ) : null}
                  </p>
                </div>
                {canWrite && (
                  <div className="location-list-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${location.name}`}
                      onClick={() => openEditLocation(location)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Remove ${location.name}`}
                      onClick={() => {
                        removeLocation.clear();
                        setPendingDelete(location);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {canWrite && (
            <button
              type="button"
              className="button secondary"
              onClick={openCreateLocation}
            >
              <Plus size={16} /> Add location
            </button>
          )}
        </>
      )}
      <FormDialog
        open={locationEditor !== null}
        title={
          locationEditor?.mode === "edit"
            ? "Edit pickup location"
            : "Add pickup location"
        }
        description="Reusable across products and departures. Coordinates are optional dispatch context — they do not optimize Plan pickups order."
        busy={locationMutation.busy}
        error={locationMutation.error}
        submitLabel={
          locationEditor?.mode === "edit" ? "Save location" : "Add location"
        }
        onClose={() => {
          if (!locationMutation.busy) setLocationEditor(null);
        }}
        onSubmit={submitLocation}
        className="pickup-location-dialog"
      >
        <div className="pickup-location-form">
          <div className="pickup-location-section">
            <h3>Identity</h3>
            <Field label="Location name">
              <input
                required
                maxLength={120}
                value={locationForm.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setLocationForm((v) => {
                    const auto = slugFromName(v.name);
                    const keepEditingSlug =
                      locationEditor?.mode === "edit" ||
                      (v.slug !== "" && v.slug !== auto);
                    return {
                      ...v,
                      name,
                      slug: keepEditingSlug ? v.slug : slugFromName(name),
                    };
                  });
                }}
              />
            </Field>
            <div className="form-grid">
              <Field
                label="Location code"
                hint="Hyphenated, lowercase."
              >
                <input
                  required
                  pattern="[a-z][a-z0-9_-]{1,49}"
                  value={locationForm.slug}
                  disabled={locationEditor?.mode === "edit"}
                  onChange={(e) =>
                    setLocationForm((v) => ({ ...v, slug: e.target.value }))
                  }
                />
              </Field>
              <Field label="Kind">
                <select
                  value={locationForm.kind}
                  onChange={(e) =>
                    setLocationForm((v) => ({ ...v, kind: e.target.value }))
                  }
                >
                  <option value="hotel">Hotel</option>
                  <option value="port">Port</option>
                  <option value="meeting_point">Meeting point</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
          </div>

          <div className="pickup-location-section">
            <h3>Location</h3>
            <p className="muted pickup-location-section-hint">
              Optional address and coordinates for staff context. No live GPS or
              route optimization.
            </p>
            <Field
              label="Address or directions"
              hint={
                tenantPlace
                  ? `Defaults to tenant city/country from Settings (${tenantPlace}).`
                  : "Set city and country under Settings → General to prefill this."
              }
            >
              <input
                maxLength={300}
                value={locationForm.address}
                placeholder={tenantPlace || "City, country"}
                onChange={(e) =>
                  setLocationForm((v) => ({ ...v, address: e.target.value }))
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="Latitude">
                <input
                  inputMode="decimal"
                  placeholder="e.g. 17.122"
                  value={locationForm.latitude}
                  onChange={(e) =>
                    setLocationForm((v) => ({
                      ...v,
                      latitude: e.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Longitude">
                <input
                  inputMode="decimal"
                  placeholder="e.g. -61.845"
                  value={locationForm.longitude}
                  onChange={(e) =>
                    setLocationForm((v) => ({
                      ...v,
                      longitude: e.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            {locationEditor !== null && (
              <LocationMapPreview
                key={
                  locationEditor.mode === "edit"
                    ? locationEditor.location.id
                    : "create"
                }
                latitude={locationForm.latitude}
                longitude={locationForm.longitude}
                interactive={canWrite}
                onPositionChange={(latitude, longitude) =>
                  setLocationForm((v) => ({ ...v, latitude, longitude }))
                }
              />
            )}
            <Field
              label="Map link"
              hint="Optional external link (Google Maps, Apple Maps, etc.)."
            >
              <input
                type="url"
                value={locationForm.mapUrl}
                onChange={(e) =>
                  setLocationForm((v) => ({ ...v, mapUrl: e.target.value }))
                }
              />
            </Field>
            <div className="pickup-location-map-helpers">
              {previewMapsUrl ? (
                <a
                  className="text-link"
                  href={previewMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Maps
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : (
                <span className="muted">
                  Add an address or coordinates to preview on Maps.
                </span>
              )}
              {canFillMapUrl && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    setLocationForm((v) => ({
                      ...v,
                      mapUrl:
                        mapsLinkFromCoords(v.latitude, v.longitude) || v.mapUrl,
                    }))
                  }
                >
                  Use maps link from coordinates
                </button>
              )}
            </div>
          </div>

          <div className="pickup-location-section">
            <h3>Operations</h3>
            <Field
              label="Operational notes"
              hint="Internal only — lobby points, berth notes, etc."
            >
              <textarea
                maxLength={500}
                value={locationForm.notes}
                onChange={(e) =>
                  setLocationForm((v) => ({ ...v, notes: e.target.value }))
                }
              />
            </Field>
            <Field label="Visibility">
              <select
                value={locationForm.visibility}
                onChange={(e) =>
                  setLocationForm((v) => ({
                    ...v,
                    visibility: e.target.value,
                  }))
                }
              >
                <option value="internal">Internal operations only</option>
                <option value="guest">May be shown to guests</option>
              </select>
            </Field>
          </div>
        </div>
      </FormDialog>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove pickup location?"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be deactivated and removed from new plans. Existing saved stops that still reference it must be reassigned first.`
            : undefined
        }
        confirmLabel="Remove location"
        danger
        busy={removeLocation.busy}
        error={removeLocation.error}
        onClose={() => {
          if (!removeLocation.busy) setPendingDelete(null);
        }}
        onConfirm={confirmDeleteLocation}
      />
    </section>
  );
}
