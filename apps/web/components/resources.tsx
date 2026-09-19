"use client";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  formatMediumDate,
  label,
  useMutation,
  useResource,
} from "@/lib/client";
import type { Session } from "@/lib/types";
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
  TenantDateInput,
  Toggle,
} from "./common";

type Resource = {
  id: string;
  code: string;
  name: string;
  type: string;
  capacity: number | null;
  notes: string;
  active: boolean;
};

type ComplianceDocument = {
  id: string;
  resource_id: string | null;
  crew_actor_id: string | null;
  document_type: string;
  expires_on: string;
  notes?: string;
};

type Editor =
  | { kind: "resource"; mode: "create" }
  | { kind: "resource"; mode: "edit"; item: Resource };

type PendingDelete =
  | { kind: "resource"; item: Resource }
  | { kind: "document"; item: ComplianceDocument };

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
  notes: "",
  active: true,
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

export function Resources({ session }: { session: Session }) {
  const resources = useResource<Resource[]>("ops/v1/resources");
  const documents = useResource<ComplianceDocument[]>(
    "ops/v1/compliance-documents",
  );
  const save = useMutation();
  const remove = useMutation();

  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [resourceForm, setResourceForm] = useState(emptyResource);
  const [docsFor, setDocsFor] = useState<Resource | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [resourceDocForm, setResourceDocForm] = useState({
    documentType: "",
    expiresOn: "",
    evidencePath: "",
    notes: "",
  });

  const today = localDateIso(session.tenant.timezone);
  const soon = localDateIso(session.tenant.timezone, 14);

  const subjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of resources.data ?? []) {
      map.set(item.id, item.name);
    }
    return (doc: ComplianceDocument) =>
      doc.resource_id
        ? (map.get(doc.resource_id) ?? "Resource")
        : "Unknown subject";
  }, [resources.data]);

  const activeResources =
    resources.data?.filter((item) => item.active).length ?? 0;
  const expiredDocs =
    documents.data?.filter((doc) => doc.resource_id && doc.expires_on < today)
      .length ?? 0;
  const expiringDocs =
    documents.data?.filter(
      (doc) =>
        doc.resource_id && doc.expires_on >= today && doc.expires_on <= soon,
    ).length ?? 0;

  function openResourceCreate() {
    setResourceForm(emptyResource);
    setEditor({ kind: "resource", mode: "create" });
  }

  function openResourceEdit(item: Resource) {
    setResourceForm({
      code: item.code,
      name: item.name,
      type: item.type,
      capacity: item.capacity != null ? String(item.capacity) : "",
      notes: item.notes ?? "",
      active: item.active,
    });
    setEditor({ kind: "resource", mode: "edit", item });
  }

  async function submitEditor() {
    if (!editor) return;
    const payload = {
      code: resourceCodeFrom(resourceForm.code),
      name: resourceForm.name,
      type: resourceForm.type,
      capacity: resourceForm.capacity ? Number(resourceForm.capacity) : null,
      notes: resourceForm.notes,
    };
    const result =
      editor.mode === "create"
        ? await save.run("ops/v1/resources", payload)
        : await save.run(
            `ops/v1/resources/${editor.item.id}`,
            { ...payload, active: resourceForm.active },
            "PATCH",
          );
    if (result) {
      setEditor(null);
      resources.reload();
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
    if (result) {
      setPendingDelete(null);
      resources.reload();
      documents.reload();
    }
  }

  if (resources.error || documents.error)
    return <Notice error>{resources.error || documents.error}</Notice>;
  if (!resources.data || !documents.data) return <Loading />;

  const resourceList = resources.data;
  const assetNeedle = assetSearch.trim().toLowerCase();
  const visibleAssets = assetNeedle
    ? resourceList.filter((item) =>
        [item.name, item.code, item.type, label(item.type)]
          .join(" ")
          .toLowerCase()
          .includes(assetNeedle),
      )
    : resourceList;

  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Fleet"
        description="Operational assets such as vehicles, vessels, and equipment. People live under Staff. Departure assignments are managed in Catalog → Assignments."
      />

      <div className="resource-metrics">
        <div>
          <strong>{activeResources}</strong>
          <span>Active assets</span>
        </div>
        <div className={expiredDocs ? "attention" : undefined}>
          <strong>{expiredDocs}</strong>
          <span>Expired asset docs</span>
        </div>
      </div>

      {(expiredDocs > 0 || expiringDocs > 0) && (
        <div className="resource-attention-callout">
          <div>
            <strong>Expiry attention</strong>
            <span>
              {expiredDocs} expired · {expiringDocs} due within 14 days. Use
              Manage documents on an asset, or open Document library.
            </span>
          </div>
        </div>
      )}

      <div className="staff-list-tools fleet-asset-bar">
        <SearchBox
          value={assetSearch}
          onChange={setAssetSearch}
          placeholder="Search assets"
        />
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

      <section className="panel" role="tabpanel" aria-label="Resources">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Fleet assets</h2>
            <p className="muted">
              Vehicles, vessels, and equipment available for departure
              assignment.
            </p>
          </div>
        </div>
        {resourceList.length ? (
          visibleAssets.length ? (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Capacity</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleAssets.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small>{item.code}</small>
                      </td>
                      <td>{label(item.type)}</td>
                      <td>{item.capacity ?? "—"}</td>
                      <td>
                        <Status state={item.active ? "active" : "inactive"} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => openResourceEdit(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => {
                              setDocsFor(item);
                              setResourceDocForm({
                                documentType: "",
                                expiresOn: "",
                                evidencePath: "",
                                notes: "",
                              });
                            }}
                          >
                            Documents
                          </button>
                          {item.active && (
                            <button
                              type="button"
                              className="text-link danger-text"
                              onClick={() =>
                                setPendingDelete({ kind: "resource", item })
                              }
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {visibleAssets.map((item) => (
                <article key={item.id} className="resource-card">
                  <div className="resource-card-head">
                    <strong>{item.name}</strong>
                    <Status state={item.active ? "active" : "inactive"} />
                  </div>
                  <small>
                    {label(item.type)} · {item.code}
                    {item.capacity != null
                      ? ` · capacity ${item.capacity}`
                      : ""}
                  </small>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => openResourceEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        setDocsFor(item);
                        setResourceDocForm({
                          documentType: "",
                          expiresOn: "",
                          evidencePath: "",
                          notes: "",
                        });
                      }}
                    >
                      Documents
                    </button>
                    {item.active && (
                      <button
                        type="button"
                        className="text-link danger-text"
                        onClick={() =>
                          setPendingDelete({ kind: "resource", item })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
          ) : (
            <Empty title="No assets match">
              <p>Try a different name, code, or type.</p>
            </Empty>
          )
        ) : (
          <Empty title="No resources yet">
            Add a vehicle, vessel, or equipment item for assignment.
          </Empty>
        )}
      </section>

      <FormDialog
        open={editor?.kind === "resource"}
        title={editor?.mode === "edit" ? "Edit resource" : "Add resource"}
        description="Vehicles, vessels, and equipment for departure assignment."
        busy={save.busy}
        error={save.error}
        submitLabel={editor?.mode === "edit" ? "Save resource" : "Add resource"}
        onClose={() => setEditor(null)}
        onSubmit={submitEditor}
      >
        <Field label="Name" required>
          <input
            required
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
        <Field
          label="Code"
          required
          hint="Lowercase letters, numbers, hyphen or underscore. Example: tt01"
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
        <Field label="Type" required>
          <select
            required
            value={resourceForm.type}
            onChange={(e) =>
              setResourceForm((v) => ({ ...v, type: e.target.value }))
            }
          >
            <option value="vehicle">Vehicle</option>
            <option value="vessel">Vessel</option>
            <option value="equipment">Equipment</option>
          </select>
        </Field>
        <Field label="Capacity">
          <input
            type="number"
            min="1"
            value={resourceForm.capacity}
            onChange={(e) =>
              setResourceForm((v) => ({ ...v, capacity: e.target.value }))
            }
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={resourceForm.notes}
            onChange={(e) =>
              setResourceForm((v) => ({ ...v, notes: e.target.value }))
            }
          />
        </Field>
        {editor?.mode === "edit" && (
          <Toggle
            label="Active for assignment"
            checked={resourceForm.active}
            onChange={(active) => setResourceForm((v) => ({ ...v, active }))}
          />
        )}
      </FormDialog>

      <FormDialog
        open={Boolean(docsFor)}
        title={docsFor ? `Documents · ${docsFor.name}` : "Documents"}
        description="Expiry documents for this asset. Expired documents can block trip assignments."
        busy={save.busy}
        error={save.error}
        submitLabel="Add document"
        onClose={() => setDocsFor(null)}
        onSubmit={async () => {
          if (!docsFor) return;
          const result = await save.run("ops/v1/compliance-documents", {
            resourceId: docsFor.id,
            documentType: resourceDocForm.documentType,
            expiresOn: resourceDocForm.expiresOn,
            evidencePath: resourceDocForm.evidencePath,
            notes: resourceDocForm.notes,
          });
          if (result) {
            setResourceDocForm({
              documentType: "",
              expiresOn: "",
              evidencePath: "",
              notes: "",
            });
            documents.reload();
          }
        }}
      >
        {docsFor &&
          (documents.data ?? [])
            .filter((d) => d.resource_id === docsFor.id)
            .map((doc) => (
              <div className="staff-doc-list" key={doc.id}>
              <div className="staff-doc-row">
                  <div>
                    <strong>{doc.document_type}</strong>
                    <small>
                      Expires {formatMediumDate(doc.expires_on)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="text-link danger-text"
                    onClick={() =>
                      setPendingDelete({ kind: "document", item: doc })
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
        <Field label="Document type" required>
          <input
            required
            value={resourceDocForm.documentType}
            onChange={(e) =>
              setResourceDocForm((v) => ({
                ...v,
                documentType: e.target.value,
              }))
            }
          />
        </Field>
        <TenantDateInput
          label="Expires on"
          value={resourceDocForm.expiresOn}
          onChange={(expiresOn) =>
            setResourceDocForm((v) => ({
              ...v,
              expiresOn,
            }))
          }
          locale={session.tenant.config.locale}
          dateFormat={session.tenant.config.dateFormat}
        />
        <Field label="Evidence reference">
          <input
            value={resourceDocForm.evidencePath}
            onChange={(e) =>
              setResourceDocForm((v) => ({
                ...v,
                evidencePath: e.target.value,
              }))
            }
          />
        </Field>
        <Field label="Notes">
          <input
            value={resourceDocForm.notes}
            onChange={(e) =>
              setResourceDocForm((v) => ({ ...v, notes: e.target.value }))
            }
          />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.kind === "document"
            ? "Delete document?"
            : "Remove resource?"
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
