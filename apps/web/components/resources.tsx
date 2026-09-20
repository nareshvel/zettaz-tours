"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Car, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import {
  dateTime,
  downloadApiFile,
  label,
  useMutation,
  useResource,
} from "@/lib/client";
import { fleetSeatCoverage } from "@/lib/fleet-coverage";
import {
  FLEET_KIND_GROUPS,
  fleetPaperSuggestions,
  isFleetKind,
} from "../../../packages/shared/src/fleet";
import type { Session } from "@/lib/types";
import {
  type ComplianceDocument,
  type LibraryUsage,
  DocumentViewDialog,
  StaffDocumentAddFields,
  StaffDocumentArchive,
  uploadComplianceDocument,
} from "./document-library";
import {
  ConfirmDialog,
  Empty,
  Field,
  FormDialog,
  Heading,
  Loading,
  Notice,
  SearchBox,
  Status,
  Toggle,
} from "./common";

type Resource = {
  id: string;
  code: string;
  name: string;
  type: string;
  capacity: number | null;
  make: string;
  model: string;
  identifier: string;
  notes: string;
  active: boolean;
};

type Editor =
  | { kind: "resource"; mode: "create" }
  | { kind: "resource"; mode: "edit"; item: Resource };

type PendingDelete =
  | { kind: "resource"; item: Resource }
  | { kind: "document"; item: ComplianceDocument };

type Assignment = {
  id: string;
  departure_id: string;
  resource_id: string | null;
  resource_capacity: number | null;
  departure_starts_at: string;
  local_date: string;
  product_name: string;
  departure_capacity: number;
  departure_committed: number;
};

function localDateIso(timezone: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day + offsetDays))
    .toISOString()
    .slice(0, 10);
}

const emptyResource = {
  code: "",
  name: "",
  type: "vehicle",
  capacity: "",
  make: "",
  model: "",
  identifier: "",
  notes: "",
  active: true,
};

const emptyDocForm = {
  documentType: "",
  expiresOn: "",
  notes: "",
  file: null as File | null,
};

function resourceCodeFrom(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

function assetDocState(
  docs: ComplianceDocument[],
  resourceId: string,
  today: string,
  soon: string,
) {
  const mine = docs.filter((doc) => doc.resource_id === resourceId);
  if (mine.some((doc) => doc.expires_on < today)) return "expired" as const;
  if (mine.some((doc) => doc.expires_on >= today && doc.expires_on <= soon))
    return "soon" as const;
  return null;
}

function assetDocCount(docs: ComplianceDocument[], resourceId: string) {
  return docs.filter((doc) => doc.resource_id === resourceId).length;
}

function AssetDocCount({
  name,
  count,
  onOpen,
}: {
  name: string;
  count: number;
  onOpen: () => void;
}) {
  if (count <= 0) return <small>—</small>;
  return (
    <button
      type="button"
      className="text-link asset-doc-count"
      aria-label={`View ${count} document${count === 1 ? "" : "s"} for ${name}`}
      onClick={onOpen}
    >
      <FileText size={15} aria-hidden="true" />
      {count}
    </button>
  );
}

export function Resources({ session }: { session: Session }) {
  const canManageDocs = session.permissions.includes("documents.expiry.manage");
  const canReadAssignments = session.permissions.includes("assignments.write");
  const resources = useResource<Resource[]>("ops/v1/resources");
  const assignments = useResource<Assignment[]>(
    canReadAssignments ? "ops/v1/assignments" : null,
  );
  const documents = useResource<ComplianceDocument[]>(
    canManageDocs ? "ops/v1/compliance-documents" : null,
  );
  const libraryUsage = useResource<LibraryUsage>(
    canManageDocs ? "ops/v1/document-library/usage" : null,
  );
  const save = useMutation();
  const remove = useMutation();

  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [resourceForm, setResourceForm] = useState(emptyResource);
  const [assetSearch, setAssetSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "active" | "inactive" | "all"
  >("active");
  const [resourceDocForm, setResourceDocForm] = useState(emptyDocForm);
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [viewer, setViewer] = useState<{
    title: string;
    docs: ComplianceDocument[];
    activeId?: string;
  } | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState("");

  const today = localDateIso(session.tenant.timezone);
  const soon = localDateIso(session.tenant.timezone, 14);
  const dateFormat = session.tenant.config.dateFormat as
    | "DD/MM/YYYY"
    | "MM/DD/YYYY"
    | "YYYY-MM-DD";

  const subjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of resources.data ?? []) {
      map.set(item.id, item.name);
    }
    return (doc: ComplianceDocument) =>
      doc.resource_id
        ? (map.get(doc.resource_id) ?? "Asset")
        : "Unknown subject";
  }, [resources.data]);

  const docs = documents.data ?? [];
  const assignmentList = assignments.data ?? [];
  const nowIso = new Date().toISOString();
  const nextTripByAsset = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const item of assignmentList) {
      if (!item.resource_id) continue;
      if (item.departure_starts_at < nowIso) continue;
      const current = map.get(item.resource_id);
      if (!current || item.departure_starts_at < current.departure_starts_at) {
        map.set(item.resource_id, item);
      }
    }
    return map;
  }, [assignmentList, nowIso]);
  const assignedToday = useMemo(() => {
    const ids = new Set<string>();
    for (const item of assignmentList) {
      if (item.resource_id && item.local_date === today) ids.add(item.resource_id);
    }
    return ids.size;
  }, [assignmentList, today]);
  const coverageGapsToday = useMemo(() => {
    const byDeparture = new Map<string, Assignment[]>();
    for (const item of assignmentList) {
      if (!item.resource_id || item.local_date !== today) continue;
      const bucket = byDeparture.get(item.departure_id) ?? [];
      bucket.push(item);
      byDeparture.set(item.departure_id, bucket);
    }
    let gaps = 0;
    for (const rows of byDeparture.values()) {
      const booked = Number(rows[0]?.departure_committed ?? 0);
      const cover = fleetSeatCoverage(rows, booked);
      if (cover.kind === "short") gaps += 1;
    }
    return gaps;
  }, [assignmentList, today]);
  const activeResources =
    resources.data?.filter((item) => item.active).length ?? 0;
  const expiredDocs = docs.filter(
    (doc) => doc.resource_id && doc.expires_on < today,
  ).length;
  const expiringDocs = docs.filter(
    (doc) =>
      doc.resource_id && doc.expires_on >= today && doc.expires_on <= soon,
  ).length;

  function openResourceCreate() {
    setResourceForm(emptyResource);
    setResourceDocForm(emptyDocForm);
    setDocError("");
    save.clear();
    setAddDocOpen(false);
    setEditor({ kind: "resource", mode: "create" });
  }

  function fillForm(item: Resource) {
    setResourceForm({
      code: item.code,
      name: item.name,
      type: item.type,
      capacity: item.capacity != null ? String(item.capacity) : "",
      make: item.make ?? "",
      model: item.model ?? "",
      identifier: item.identifier ?? "",
      notes: item.notes ?? "",
      active: item.active,
    });
  }

  function openResourceEdit(item: Resource) {
    fillForm(item);
    setResourceDocForm(emptyDocForm);
    setDocError("");
    save.clear();
    setAddDocOpen(false);
    setEditor({ kind: "resource", mode: "edit", item });
  }

  function identityPayload() {
    return {
      code: resourceCodeFrom(resourceForm.code),
      name: resourceForm.name.trim(),
      type: resourceForm.type,
      capacity: resourceForm.capacity ? Number(resourceForm.capacity) : null,
      make: resourceForm.make.trim(),
      model: resourceForm.model.trim(),
      identifier: resourceForm.identifier.trim(),
      notes: resourceForm.notes,
    };
  }

  async function submitEditor() {
    if (!editor) return;
    const payload = identityPayload();
    if (editor.mode === "create") {
      const result = await save.run<{ id: string }>("ops/v1/resources", payload);
      if (result?.id) {
        if (!resourceForm.active) {
          await save.run(
            `ops/v1/resources/${result.id}`,
            { ...payload, active: false },
            "PATCH",
          );
        }
        setEditor(null);
        resources.reload();
      }
      return;
    }
    const result = await save.run(
      `ops/v1/resources/${editor.item.id}`,
      { ...payload, active: resourceForm.active },
      "PATCH",
    );
    if (result) {
      setEditor(null);
      setAddDocOpen(false);
      resources.reload();
    }
  }

  async function saveDocument() {
    if (editor?.mode !== "edit") return;
    setDocBusy(true);
    setDocError("");
    try {
      await uploadComplianceDocument(
        session.tenant.id,
        {
          resourceId: editor.item.id,
          documentType: resourceDocForm.documentType,
          expiresOn: resourceDocForm.expiresOn,
          notes: resourceDocForm.notes,
        },
        resourceDocForm.file,
      );
      setResourceDocForm(emptyDocForm);
      setAddDocOpen(false);
      documents.reload();
      libraryUsage.reload();
    } catch (error) {
      setDocError((error as Error).message);
    } finally {
      setDocBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const result =
      pendingDelete.kind === "resource"
        ? await remove.run(
            `ops/v1/resources/${pendingDelete.item.id}`,
            {},
            "DELETE",
          )
        : await remove.run(
            `ops/v1/compliance-documents/${pendingDelete.item.id}`,
            {},
            "DELETE",
          );
    if (result !== undefined) {
      setPendingDelete(null);
      resources.reload();
      documents.reload();
      libraryUsage.reload();
    }
  }

  if (resources.error) return <Notice error>{resources.error}</Notice>;
  if (!resources.data) return <Loading />;

  const resourceList = resources.data;
  const statusAssets =
    statusFilter === "all"
      ? resourceList
      : resourceList.filter((item) =>
          statusFilter === "active" ? item.active : !item.active,
        );
  const assetNeedle = assetSearch.trim().toLowerCase();
  const visibleAssets = assetNeedle
    ? statusAssets.filter((item) =>
        [item.name, item.code, item.type, label(item.type), item.make, item.model, item.identifier]
          .join(" ")
          .toLowerCase()
          .includes(assetNeedle),
      )
    : statusAssets;
  const editingAsset = editor?.mode === "edit" ? editor.item : null;
  const assetDocs = editingAsset
    ? docs.filter((doc) => doc.resource_id === editingAsset.id)
    : [];
  const assetReady =
    Boolean(resourceForm.name.trim()) &&
    Boolean(resourceCodeFrom(resourceForm.code));

  const assetActions = (item: Resource) => (
    <div className="row-actions" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Edit ${item.name}`}
        onClick={() => openResourceEdit(item)}
      >
        <Pencil size={16} />
      </button>
      {item.active && (
        <button
          type="button"
          className="icon-button danger"
          aria-label={`Remove ${item.name}`}
          onClick={() => setPendingDelete({ kind: "resource", item })}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );

  const docToneLabel = (item: Resource) => {
    const tone = assetDocState(docs, item.id, today, soon);
    if (tone === "expired") return "Docs expired";
    if (tone === "soon") return "Docs due soon";
    return null;
  };

  return (
    <>
      <Heading eyebrow="ADMINISTRATION" title="Assets" />

      <div className="resource-metrics">
        <div>
          <strong>{activeResources}</strong>
          <span>Active assets</span>
        </div>
        {canReadAssignments && (
          <div>
            <strong>{assignedToday}</strong>
            <span>Assigned today</span>
          </div>
        )}
        {canReadAssignments && (
          <div className={coverageGapsToday ? "attention" : undefined}>
            <strong>{coverageGapsToday}</strong>
            <span>Coverage gaps today</span>
          </div>
        )}
        {canManageDocs && (
          <div className={expiredDocs ? "attention" : undefined}>
            <strong>{expiredDocs}</strong>
            <span>Expired asset docs</span>
          </div>
        )}
      </div>

      {canReadAssignments && coverageGapsToday > 0 && (
        <div className="resource-attention-callout">
          <div>
            <strong>Assigned seats short of booked occupancy</strong>
            <span>
              {coverageGapsToday} trip{coverageGapsToday === 1 ? "" : "s"} today
              have fleet assigned whose passenger seats do not cover guests
              already booked. This does not stop selling — assign more units in{" "}
              <Link href="/catalog?tab=assignments">Catalog → Assignments</Link>
              .
            </span>
          </div>
        </div>
      )}

      {canManageDocs && (expiredDocs > 0 || expiringDocs > 0) && (
        <div className="resource-attention-callout">
          <div>
            <strong>Expiry attention</strong>
            <span>
              {expiredDocs} expired · {expiringDocs} due within 14 days. Use
              Documents on an asset, or open Document library.
            </span>
          </div>
        </div>
      )}

      {documents.error && <Notice error>{documents.error}</Notice>}
      {assignments.error && <Notice error>{assignments.error}</Notice>}

      <div className="staff-list-tools fleet-asset-bar">
        <SearchBox
          value={assetSearch}
          onChange={setAssetSearch}
          placeholder="Search assets"
        />
        <select
          className="fleet-status-filter"
          aria-label="Filter assets by status"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(
              e.target.value as "active" | "inactive" | "all",
            )
          }
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button
          type="button"
          className="button catalog-add-btn"
          aria-label="Add asset"
          onClick={openResourceCreate}
        >
          <Plus size={17} />
          <span className="button-label">Add asset</span>
        </button>
      </div>

      <section className="panel" aria-label="Assets">
        {resourceList.length ? (
          visibleAssets.length ? (
            <>
              <div className="table-scroll resource-table">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Seats</th>
                      {canManageDocs && <th>Documents</th>}
                      <th>Next trip</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAssets.map((item) => {
                      const tone = docToneLabel(item);
                      const next = nextTripByAsset.get(item.id);
                      const papers = assetDocCount(docs, item.id);
                      return (
                        <tr key={item.id}>
                          <td>
                            <button
                              type="button"
                              className="text-link resource-name-btn"
                              onClick={() => openResourceEdit(item)}
                            >
                              <strong>{item.name}</strong>
                            </button>
                            <small>
                              {label(item.type)} · {item.code}
                              {item.identifier ? ` · ${item.identifier}` : ""}
                              {tone ? ` · ${tone}` : ""}
                            </small>
                          </td>
                          <td>{item.capacity ?? "—"}</td>
                          {canManageDocs && (
                            <td>
                              <AssetDocCount
                                name={item.name}
                                count={papers}
                                onOpen={() =>
                                  setViewer({
                                    title: `${item.name} papers`,
                                    docs: docs.filter(
                                      (doc) => doc.resource_id === item.id,
                                    ),
                                  })
                                }
                              />
                            </td>
                          )}
                          <td>
                            {next ? (
                              <Link
                                className="text-link"
                                href="/catalog?tab=assignments"
                              >
                                {next.product_name}
                                <small>
                                  {dateTime(
                                    next.departure_starts_at,
                                    session.tenant.timezone,
                                    session.tenant.config.locale,
                                  )}
                                </small>
                              </Link>
                            ) : (
                              <small>Unassigned</small>
                            )}
                          </td>
                          <td>
                            <Status
                              state={item.active ? "active" : "inactive"}
                            />
                          </td>
                          <td>{assetActions(item)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="resource-cards">
                {visibleAssets.map((item) => {
                  const tone = docToneLabel(item);
                  const next = nextTripByAsset.get(item.id);
                  const papers = assetDocCount(docs, item.id);
                  return (
                    <article key={item.id} className="resource-card">
                      <div className="resource-card-head">
                        <button
                          type="button"
                          className="text-link resource-name-btn"
                          onClick={() => openResourceEdit(item)}
                        >
                          <strong>{item.name}</strong>
                        </button>
                        <Status state={item.active ? "active" : "inactive"} />
                      </div>
                      <small>
                        {label(item.type)} · {item.code}
                        {item.identifier ? ` · ${item.identifier}` : ""}
                        {item.capacity != null
                          ? ` · ${item.capacity} seats`
                          : ""}
                        {tone ? ` · ${tone}` : ""}
                      </small>
                      {canManageDocs && papers > 0 && (
                        <AssetDocCount
                          name={item.name}
                          count={papers}
                          onOpen={() =>
                            setViewer({
                              title: `${item.name} papers`,
                              docs: docs.filter(
                                (doc) => doc.resource_id === item.id,
                              ),
                            })
                          }
                        />
                      )}
                      {next ? (
                        <Link
                          className="text-link"
                          href="/catalog?tab=assignments"
                        >
                          {next.product_name} ·{" "}
                          {dateTime(
                            next.departure_starts_at,
                            session.tenant.timezone,
                            session.tenant.config.locale,
                          )}
                        </Link>
                      ) : (
                        <small>Unassigned</small>
                      )}
                      {assetActions(item)}
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <Empty
              title={
                assetNeedle
                  ? "No assets match"
                  : statusFilter === "inactive"
                    ? "No inactive assets"
                    : statusFilter === "active"
                      ? "No active assets"
                      : "No assets match"
              }
            >
              <p>
                {assetNeedle
                  ? "Try a different name, code, or type."
                  : statusFilter === "inactive"
                    ? "Removed assets stay here as inactive so past assignments remain on record."
                    : statusFilter === "active"
                      ? "Add a named unit, or switch Status to see inactive assets."
                      : "Try a different name, code, or type."}
              </p>
            </Empty>
          )
        ) : (
          <Empty title="No assets yet">
            <p>Add a named unit for assignment — jet ski, kayak, van, boat, or other.</p>
            <button
              type="button"
              className="button"
              onClick={openResourceCreate}
            >
              Add asset
            </button>
          </Empty>
        )}
      </section>

      <FormDialog
        open={editor?.kind === "resource"}
        className="fleet-asset-dialog"
        title={editor?.mode === "edit" ? "Edit asset" : "Add asset"}
        description="One named unit for assignment. Papers are expiry files on this asset, not a count of vehicles."
        busy={save.busy}
        error={save.error || remove.error}
        submitLabel={editor?.mode === "edit" ? "Save asset" : "Add asset"}
        submitDisabled={!assetReady}
        onClose={() => {
          setEditor(null);
          setAddDocOpen(false);
          setDocError("");
          setResourceDocForm(emptyDocForm);
        }}
        onSubmit={submitEditor}
      >
        <section className="staff-form-section">
          <div className="fleet-identity-toolbar">
            <div className="staff-form-section-head">
              <Car size={16} aria-hidden="true" />
              <div>
                <h3>Identity</h3>
                <p>How this unit is named, typed, and identified on the roster.</p>
              </div>
            </div>
            <Toggle
              className="fleet-active-toggle"
              label="Active for assignment"
              checked={resourceForm.active}
              onChange={(active) =>
                setResourceForm((v) => ({ ...v, active }))
              }
            />
          </div>
          <div className="fleet-identity-grid">
            <div className="fleet-span-2">
              <Field label="Name" required>
            <input
              required
              autoFocus
              value={resourceForm.name}
              onChange={(e) =>
                setResourceForm((v) => {
                  const name = e.target.value;
                  const autoCode = resourceCodeFrom(name);
                  const keepManual =
                    editor?.mode === "edit" ||
                    (v.code !== "" && v.code !== resourceCodeFrom(v.name));
                  return {
                    ...v,
                    name,
                    code: keepManual ? v.code : autoCode,
                  };
                })
              }
            />
              </Field>
            </div>
            <Field label="Kind" required>
              <select
                required
                value={resourceForm.type}
                onChange={(e) =>
                  setResourceForm((v) => ({ ...v, type: e.target.value }))
                }
              >
                {!isFleetKind(resourceForm.type) && (
                  <option value={resourceForm.type}>
                    {label(resourceForm.type)} (current)
                  </option>
                )}
                {FLEET_KIND_GROUPS.map((group) => (
                  <optgroup key={group.family} label={group.label}>
                    {group.kinds.map((kind) => (
                      <option key={kind.id} value={kind.id}>
                        {kind.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field
              label="Code"
              required
              tip="Lowercase letters, numbers, hyphen or underscore. Example: tt01"
            >
              <input
                required
                pattern="[a-z][a-z0-9_-]{1,49}"
                title="Use a lowercase code like tt01 or tuk_tuk_1"
                value={resourceForm.code}
                onChange={(e) =>
                  setResourceForm((v) => ({
                    ...v,
                    code: resourceCodeFrom(e.target.value),
                  }))
                }
              />
            </Field>
            <Field
              label="Passenger seats"
              tip="Seats on this unit only. One row per vehicle or vessel — not how many you own. Sellable occupancy is on the schedule."
            >
              <input
                type="number"
                min="1"
                value={resourceForm.capacity}
                onChange={(e) =>
                  setResourceForm((v) => ({ ...v, capacity: e.target.value }))
                }
              />
            </Field>
            <Field
              label="Registration / ID"
              tip="Plate, registration mark, HIN, or another identifier for this unit."
            >
              <input
                value={resourceForm.identifier}
                onChange={(e) =>
                  setResourceForm((v) => ({
                    ...v,
                    identifier: e.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Make">
              <input
                value={resourceForm.make}
                onChange={(e) =>
                  setResourceForm((v) => ({ ...v, make: e.target.value }))
                }
              />
            </Field>
            <Field label="Model">
              <input
                value={resourceForm.model}
                onChange={(e) =>
                  setResourceForm((v) => ({ ...v, model: e.target.value }))
                }
              />
            </Field>
            <div className="fleet-span-3">
              <Field label="Notes">
                <textarea
                  rows={3}
                  value={resourceForm.notes}
                  onChange={(e) =>
                    setResourceForm((v) => ({ ...v, notes: e.target.value }))
                  }
                />
              </Field>
            </div>
          </div>
        </section>
        {editor?.mode === "edit" && canManageDocs && (
          <section className="staff-form-section fleet-papers-block">
            <div className="fleet-papers-toolbar">
              <div className="staff-form-section-head">
                <FileText size={16} aria-hidden="true" />
                <div>
                  <h3>Papers</h3>
                  <p>
                    Insurance, registration, license, or inspection. Expired
                    files can block assignment.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setResourceDocForm(emptyDocForm);
                  setDocError("");
                  setAddDocOpen(true);
                }}
              >
                <Plus size={16} aria-hidden="true" />
                Add document
              </button>
            </div>
            <StaffDocumentArchive
              compact
              docs={assetDocs}
              usage={libraryUsage.data}
              busy={docBusy || remove.busy}
              onDownload={(doc) =>
                void downloadApiFile(
                  `ops/v1/compliance-documents/${doc.id}/file`,
                  doc.file_name || "document",
                )
              }
              onRemove={(id) => {
                const item = assetDocs.find((doc) => doc.id === id);
                if (item) setPendingDelete({ kind: "document", item });
              }}
              onView={(doc) =>
                setViewer({
                  title: `${editingAsset?.name ?? "Asset"} papers`,
                  docs: assetDocs,
                  activeId: doc.id,
                })
              }
            />
          </section>
        )}
        {editor?.mode === "create" && canManageDocs && (
          <section className="staff-form-section">
            <p className="staff-form-note">
              Save this asset, then open it again to attach insurance,
              registration, license, or inspection files.
            </p>
          </section>
        )}
      </FormDialog>

      <FormDialog
        open={addDocOpen && editor?.mode === "edit"}
        className="fleet-doc-dialog"
        title="Add document"
        description={
          editor?.mode === "edit"
            ? `Attach insurance, registration, license, or inspection for ${editor.item.name}.`
            : undefined
        }
        busy={docBusy}
        error={docError}
        submitLabel="Add document"
        submitDisabled={
          !resourceDocForm.documentType.trim() ||
          !resourceDocForm.expiresOn ||
          (libraryUsage.data != null &&
            libraryUsage.data.usedBytes >= libraryUsage.data.quotaBytes &&
            Boolean(resourceDocForm.file))
        }
        onClose={() => {
          setAddDocOpen(false);
          setDocError("");
          setResourceDocForm(emptyDocForm);
        }}
        onSubmit={saveDocument}
      >
        <StaffDocumentAddFields
          hideHead
          form={resourceDocForm}
          setForm={setResourceDocForm}
          locale={session.tenant.config.locale}
          dateFormat={dateFormat}
          typeSuggestions={
            editor?.mode === "edit"
              ? fleetPaperSuggestions(resourceForm.type)
              : undefined
          }
        />
      </FormDialog>

      <DocumentViewDialog
        open={Boolean(viewer)}
        title={viewer?.title ?? "Documents"}
        docs={viewer?.docs ?? []}
        activeId={viewer?.activeId}
        onClose={() => setViewer(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.kind === "document"
            ? "Delete document?"
            : "Remove asset?"
        }
        description={
          pendingDelete?.kind === "document"
            ? `${pendingDelete.item.document_type} for ${subjectName(pendingDelete.item)} will be permanently deleted.`
            : pendingDelete?.kind === "resource"
              ? `${pendingDelete.item.name} will be deactivated and cannot be assigned to new departures. Past assignments stay on record.`
              : undefined
        }
        confirmLabel={
          pendingDelete?.kind === "document" ? "Delete document" : "Remove"
        }
        danger
        busy={remove.busy}
        error={remove.error}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
