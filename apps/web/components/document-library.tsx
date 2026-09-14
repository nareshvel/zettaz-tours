"use client";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Download, FileText, HardDrive, Plus, Trash2, Upload } from "lucide-react";
import {
  downloadApiFile,
  errorText,
  formatMediumDate,
  useMutation,
  useResource,
} from "@/lib/client";
import type { Member, Session } from "@/lib/types";
import {
  Empty,
  Field,
  FormDialog,
  Heading,
  Loading,
  Notice,
  TenantDateInput,
} from "./common";

export type ComplianceDocument = {
  id: string;
  resource_id: string | null;
  crew_actor_id: string | null;
  document_type: string;
  expires_on: string;
  evidence_path?: string;
  notes?: string;
  file_name?: string | null;
  content_type?: string | null;
  byte_size?: number;
  has_file?: boolean;
  subject_kind?: "crew" | "resource";
  subject_name?: string;
};

export type LibraryUsage = {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
};

type ResourceOption = {
  id: string;
  name: string;
  active: boolean;
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageMeter({ usage }: { usage: LibraryUsage | null }) {
  if (!usage) return null;
  const ratio =
    usage.quotaBytes > 0
      ? Math.min(1, usage.usedBytes / usage.quotaBytes)
      : 0;
  const pct = Math.round(ratio * 100);
  const tone =
    ratio >= 1 ? "full" : ratio >= 0.8 ? "warn" : "ok";
  return (
    <div className={`library-storage-meter is-${tone}`}>
      <div className="library-storage-meter-head">
        <HardDrive size={16} aria-hidden="true" />
        <div>
          <strong>
            {formatBytes(usage.usedBytes)}
            <span> of {formatBytes(usage.quotaBytes)}</span>
          </strong>
          <p>
            {usage.fileCount} file{usage.fileCount === 1 ? "" : "s"} · {pct}%
            used
            {ratio >= 1
              ? " · uploads blocked until space is freed"
              : ratio >= 0.8
                ? " · nearing quota"
                : ""}
          </p>
        </div>
      </div>
      <div
        className="library-storage-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export async function uploadComplianceDocument(
  tenantId: string,
  fields: {
    documentType: string;
    expiresOn: string;
    notes?: string;
    evidencePath?: string;
    crewActorId?: string;
    resourceId?: string;
  },
  file?: File | null,
) {
  const form = new FormData();
  form.append("documentType", fields.documentType);
  form.append("expiresOn", fields.expiresOn);
  form.append("notes", fields.notes ?? "");
  form.append("evidencePath", fields.evidencePath ?? "");
  if (fields.crewActorId) form.append("crewActorId", fields.crewActorId);
  if (fields.resourceId) form.append("resourceId", fields.resourceId);
  if (file) form.append("file", file);
  const response = await fetch("/api/gateway/ops/v1/compliance-documents", {
    method: "POST",
    headers: {
      "X-Tenant-Id": tenantId,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(data));
  return data;
}

export function DocumentLibrary({ session }: { session: Session }) {
  const documents = useResource<ComplianceDocument[]>(
    "ops/v1/compliance-documents",
  );
  const usage = useResource<LibraryUsage>("ops/v1/document-library/usage");
  const members = useResource<{ items: Member[] }>(
    "staff/v1/workspace/members?limit=100",
  );
  const resources = useResource<ResourceOption[]>("ops/v1/resources");
  const mutation = useMutation();
  const [filter, setFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    subjectKind: "crew" as "crew" | "resource",
    subjectId: "",
    documentType: "",
    expiresOn: "",
    notes: "",
    file: null as File | null,
  });

  const items = useMemo(() => {
    const list = documents.data ?? [];
    const q = filter.trim().toLowerCase();
    return list.filter((doc) => {
      if (subjectFilter === "crew" && !doc.crew_actor_id) return false;
      if (subjectFilter === "resource" && !doc.resource_id) return false;
      if (!q) return true;
      return [
        doc.document_type,
        doc.subject_name,
        doc.file_name,
        doc.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [documents.data, filter, subjectFilter]);

  const staffOptions = (members.data?.items ?? []).filter((m) => m.active);
  const resourceOptions = (resources.data ?? []).filter((r) => r.active);

  useEffect(() => {
    if (!adding) return;
    if (form.subjectKind === "crew" && !form.subjectId) {
      const first = (members.data?.items ?? []).find((m) => m.active);
      if (first) setForm((v) => ({ ...v, subjectId: first.id }));
    }
    if (form.subjectKind === "resource" && !form.subjectId) {
      const first = (resources.data ?? []).find((r) => r.active);
      if (first) setForm((v) => ({ ...v, subjectId: first.id }));
    }
  }, [
    adding,
    form.subjectKind,
    form.subjectId,
    members.data,
    resources.data,
  ]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await uploadComplianceDocument(
        session.tenant.id,
        {
          documentType: form.documentType,
          expiresOn: form.expiresOn,
          notes: form.notes,
          crewActorId:
            form.subjectKind === "crew" ? form.subjectId : undefined,
          resourceId:
            form.subjectKind === "resource" ? form.subjectId : undefined,
        },
        form.file,
      );
      setAdding(false);
      setForm({
        subjectKind: "crew",
        subjectId: "",
        documentType: "",
        expiresOn: "",
        notes: "",
        file: null,
      });
      documents.reload();
      usage.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const result = await mutation.run(
      "ops/v1/compliance-documents/" + id,
      {},
      "DELETE",
    );
    if (result !== undefined) {
      documents.reload();
      usage.reload();
    }
  }

  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Document library"
        description="Long-lived compliance files for staff and fleet, stored in an exclusive tenant folder with a hard storage quota."
      />

      {(documents.error || usage.error || mutation.error) && (
        <Notice error>
          {documents.error || usage.error || mutation.error}
        </Notice>
      )}

      <StorageMeter usage={usage.data} />

      <div className="view-action-bar">
        <div className="library-filters">
          <input
            type="search"
            placeholder="Search type, subject, or file"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            aria-label="Filter by subject"
          >
            <option value="all">All subjects</option>
            <option value="crew">Staff</option>
            <option value="resource">Fleet</option>
          </select>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => {
            setError("");
            setAdding(true);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          <span className="button-label">Add document</span>
        </button>
      </div>

      {!documents.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title="No compliance documents yet">
          <p>
            Upload licenses, insurance, and other expiry documents for staff or
            fleet assets.
          </p>
        </Empty>
      ) : (
        <>
          <div className="table-scroll">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Document</th>
                  <th>Expires</th>
                  <th>File</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <strong>{doc.subject_name || "—"}</strong>
                      <small>
                        {doc.subject_kind === "resource" ? "Fleet" : "Staff"}
                      </small>
                    </td>
                    <td>
                      <strong>{doc.document_type}</strong>
                      {doc.notes ? <small>{doc.notes}</small> : null}
                    </td>
                    <td>
                      <small>{formatMediumDate(doc.expires_on)}</small>
                    </td>
                    <td>
                      <small>
                        {doc.has_file
                          ? doc.file_name || "Attached file"
                          : "No file"}
                      </small>
                    </td>
                    <td>
                      <small>
                        {doc.has_file ? formatBytes(doc.byte_size ?? 0) : "—"}
                      </small>
                    </td>
                    <td className="staff-actions-cell">
                      <div className="row-actions">
                        {doc.has_file && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Download ${doc.file_name || doc.document_type}`}
                            onClick={() =>
                              void downloadApiFile(
                                `ops/v1/compliance-documents/${doc.id}/file`,
                                doc.file_name || "document",
                              )
                            }
                          >
                            <Download size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={`Remove ${doc.document_type}`}
                          onClick={() => void remove(doc.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="resource-cards">
            {items.map((doc) => (
              <article key={doc.id} className="resource-card">
                <div className="resource-card-head">
                  <strong>{doc.document_type}</strong>
                  <small>{formatMediumDate(doc.expires_on)}</small>
                </div>
                <p>
                  {doc.subject_name} ·{" "}
                  {doc.subject_kind === "resource" ? "Fleet" : "Staff"}
                </p>
                <small>
                  {doc.has_file
                    ? `${doc.file_name || "File"} · ${formatBytes(doc.byte_size ?? 0)}`
                    : "No file attached"}
                </small>
                <div className="row-actions">
                  {doc.has_file && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Download ${doc.file_name || doc.document_type}`}
                      onClick={() =>
                        void downloadApiFile(
                          `ops/v1/compliance-documents/${doc.id}/file`,
                          doc.file_name || "document",
                        )
                      }
                    >
                      <Download size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove ${doc.document_type}`}
                    onClick={() => void remove(doc.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <FormDialog
        open={adding}
        className="staff-docs-dialog"
        title="Add document"
        description="Attach a PDF or image under this tenant’s document library quota."
        busy={busy}
        error={error || mutation.error}
        submitLabel="Add document"
        submitDisabled={
          !form.subjectId ||
          !form.documentType ||
          !form.expiresOn ||
          (usage.data != null &&
            usage.data.usedBytes >= usage.data.quotaBytes &&
            Boolean(form.file))
        }
        onClose={() => setAdding(false)}
        onSubmit={() => void save()}
      >
        <div className="form-grid">
          <Field label="Subject type" required>
            <select
              value={form.subjectKind}
              onChange={(e) =>
                setForm((v) => ({
                  ...v,
                  subjectKind: e.target.value as "crew" | "resource",
                  subjectId: "",
                }))
              }
            >
              <option value="crew">Staff</option>
              <option value="resource">Fleet asset</option>
            </select>
          </Field>
          <Field
            label={form.subjectKind === "crew" ? "Staff member" : "Fleet asset"}
            required
          >
            <select
              required
              value={form.subjectId}
              onChange={(e) =>
                setForm((v) => ({ ...v, subjectId: e.target.value }))
              }
            >
              <option value="">Select…</option>
              {form.subjectKind === "crew"
                ? staffOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))
                : resourceOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Document type" required>
            <input
              required
              value={form.documentType}
              onChange={(e) =>
                setForm((v) => ({ ...v, documentType: e.target.value }))
              }
              placeholder="e.g. Captain license"
            />
          </Field>
          <TenantDateInput
            label="Expires on"
            value={form.expiresOn}
            onChange={(expiresOn) => setForm((v) => ({ ...v, expiresOn }))}
            locale={session.tenant.config.locale}
            dateFormat={session.tenant.config.dateFormat}
          />
        </div>
        <Field label="Notes">
          <input
            value={form.notes}
            onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))}
          />
        </Field>
        <label className="library-upload-dropzone">
          <Upload size={18} aria-hidden="true" />
          <span>
            {form.file
              ? `${form.file.name} · ${formatBytes(form.file.size)}`
              : "Upload PDF, JPG, PNG, or WebP (max 10 MB)"}
          </span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) =>
              setForm((v) => ({ ...v, file: e.target.files?.[0] ?? null }))
            }
          />
        </label>
      </FormDialog>
    </>
  );
}

/** Presentational pieces reused by Staff Manage documents. */
export function StaffDocumentAddFields({
  form,
  setForm,
  locale,
  dateFormat,
}: {
  form: {
    documentType: string;
    expiresOn: string;
    notes: string;
    file: File | null;
  };
  setForm: Dispatch<
    SetStateAction<{
      documentType: string;
      expiresOn: string;
      notes: string;
      file: File | null;
    }>
  >;
  locale: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
}) {
  return (
    <section className="staff-docs-section">
      <div className="staff-form-section-head">
        <Upload size={16} aria-hidden="true" />
        <div>
          <h3>New document</h3>
          <p>Type, expiry, and optional evidence file.</p>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Document type" required>
          <input
            required
            value={form.documentType}
            onChange={(e) =>
              setForm((v) => ({ ...v, documentType: e.target.value }))
            }
          />
        </Field>
        <TenantDateInput
          label="Expires on"
          value={form.expiresOn}
          onChange={(expiresOn) => setForm((v) => ({ ...v, expiresOn }))}
          locale={locale}
          dateFormat={dateFormat}
        />
      </div>
      <Field label="Notes">
        <input
          value={form.notes}
          onChange={(e) => setForm((v) => ({ ...v, notes: e.target.value }))}
        />
      </Field>
      <label className="library-upload-dropzone">
        <Upload size={18} aria-hidden="true" />
        <span>
          {form.file
            ? `${form.file.name} · ${formatBytes(form.file.size)}`
            : "Upload PDF, JPG, PNG, or WebP (max 10 MB)"}
        </span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) =>
            setForm((v) => ({ ...v, file: e.target.files?.[0] ?? null }))
          }
        />
      </label>
    </section>
  );
}

export function StaffDocumentArchive({
  docs,
  usage,
  busy,
  onDownload,
  onRemove,
}: {
  docs: ComplianceDocument[];
  usage: LibraryUsage | null;
  busy?: boolean;
  onDownload: (doc: ComplianceDocument) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <StorageMeter usage={usage} />
      <section className="staff-docs-section">
        <div className="staff-form-section-head">
          <FileText size={16} aria-hidden="true" />
          <div>
            <h3>Existing documents</h3>
            <p>Expired documents can block trip assignments.</p>
          </div>
        </div>
        {docs.length === 0 ? (
          <p className="staff-form-note">No documents on file yet.</p>
        ) : (
          <ul className="staff-doc-list">
            {docs.map((doc) => (
              <li key={doc.id}>
                <div>
                  <strong>{doc.document_type}</strong>
                  <small>
                    Expires {formatMediumDate(doc.expires_on)}
                    {doc.has_file
                      ? ` · ${doc.file_name || "File"} · ${formatBytes(doc.byte_size ?? 0)}`
                      : " · No file"}
                  </small>
                </div>
                <div className="row-actions">
                  {doc.has_file && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Download ${doc.file_name || doc.document_type}`}
                      onClick={() => onDownload(doc)}
                    >
                      <Download size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove ${doc.document_type}`}
                    disabled={busy}
                    onClick={() => onRemove(doc.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

