"use client";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  dateOnly,
  dateTime,
  label,
  useMutation,
  useResource,
} from "@/lib/client";
import type { Member, Session } from "@/lib/types";
import {
  ConfirmDialog,
  Empty,
  Field,
  FormDialog,
  Heading,
  Loading,
  Notice,
  Status,
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
type Crew = {
  actor_id: string;
  operational_name: string;
  notes: string;
  active: boolean;
  name: string;
  email: string;
};
type ComplianceDocument = {
  id: string;
  resource_id: string | null;
  crew_actor_id: string | null;
  document_type: string;
  expires_on: string;
  notes?: string;
};
type Departure = { id: string; product_name: string; starts_at: string };
type Assignment = {
  id: string;
  departure_id: string;
  assignment_role: string;
  status: string;
  starts_at: string;
  ends_at: string;
  override_reason: string | null;
  resource_id: string | null;
  resource_name: string | null;
  crew_actor_id: string | null;
  crew_name: string | null;
  departure_starts_at: string;
  local_date: string;
  product_name: string;
};

type Editor =
  | { kind: "crew"; mode: "create" }
  | { kind: "crew"; mode: "edit"; item: Crew }
  | { kind: "resource"; mode: "create" }
  | { kind: "resource"; mode: "edit"; item: Resource }
  | { kind: "document"; mode: "create" }
  | { kind: "document"; mode: "edit"; item: ComplianceDocument }
  | { kind: "assignment"; mode: "create" }
  | { kind: "assignment"; mode: "edit"; item: Assignment };

type PendingDelete =
  | { kind: "crew"; item: Crew }
  | { kind: "resource"; item: Resource }
  | { kind: "document"; item: ComplianceDocument }
  | { kind: "assignment"; item: Assignment };

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

function localDateFromInstant(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function documentStatus(expiresOn: string, today: string, soon: string) {
  if (expiresOn < today) return "expired";
  if (expiresOn <= soon) return "expiring";
  return "valid";
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
  const crew = useResource<Crew[]>("ops/v1/crew");
  const documents = useResource<ComplianceDocument[]>(
    "ops/v1/compliance-documents",
  );
  const departures = useResource<{ items: Departure[] }>(
    "staff/v1/workspace/departures",
  );
  const members = useResource<{ items: Member[] }>(
    "staff/v1/workspace/members",
  );
  const save = useMutation();
  const remove = useMutation();

  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [crewForm, setCrewForm] = useState({
    actorId: "",
    operationalName: "",
    notes: "",
    active: true,
  });
  const [resourceForm, setResourceForm] = useState(emptyResource);
  const [documentForm, setDocumentForm] = useState({
    subject: "",
    documentType: "",
    expiresOn: "",
    notes: "",
  });
  const [assignmentForm, setAssignmentForm] = useState({
    departureId: "",
    subject: "",
    assignmentRole: "",
    overrideReason: "",
  });
  const [tab, setTab] = useState<
    "crew" | "resources" | "documents" | "assignments"
  >("crew");

  const today = localDateIso(session.tenant.timezone);
  const soon = localDateIso(session.tenant.timezone, 14);
  const dateFormat = session.tenant.config.dateFormat;
  const canOverride = session.permissions.includes(
    "safety.assignment.override",
  );
  const canAssign = session.permissions.includes("assignments.write");
  const assignments = useResource<Assignment[]>(
    canAssign ? "ops/v1/assignments" : null,
  );

  const subjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of resources.data ?? []) {
      map.set(`resource:${item.id}`, item.name);
    }
    for (const item of crew.data ?? []) {
      map.set(`crew:${item.actor_id}`, item.operational_name);
    }
    return (doc: ComplianceDocument) => {
      if (doc.resource_id)
        return map.get(`resource:${doc.resource_id}`) ?? "Resource";
      if (doc.crew_actor_id)
        return map.get(`crew:${doc.crew_actor_id}`) ?? "Crew member";
      return "Unknown subject";
    };
  }, [crew.data, resources.data]);

  const activeResources =
    resources.data?.filter((item) => item.active).length ?? 0;
  const activeCrew = crew.data?.filter((item) => item.active).length ?? 0;
  const expiredDocs =
    documents.data?.filter((doc) => doc.expires_on < today).length ?? 0;
  const expiringDocs =
    documents.data?.filter(
      (doc) => doc.expires_on >= today && doc.expires_on <= soon,
    ).length ?? 0;

  const attentionDocs = useMemo(() => {
    if (!documents.data) return [];
    return [...documents.data]
      .filter((doc) => doc.expires_on <= soon)
      .sort((a, b) => a.expires_on.localeCompare(b.expires_on));
  }, [documents.data, soon]);

  const reload = () => {
    resources.reload();
    crew.reload();
    documents.reload();
    assignments.reload();
  };

  function openCrewCreate() {
    setCrewForm({
      actorId: "",
      operationalName: "",
      notes: "",
      active: true,
    });
    setEditor({ kind: "crew", mode: "create" });
  }
  function openCrewEdit(item: Crew) {
    setCrewForm({
      actorId: item.actor_id,
      operationalName: item.operational_name,
      notes: item.notes ?? "",
      active: item.active,
    });
    setEditor({ kind: "crew", mode: "edit", item });
  }
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
  function openDocumentCreate() {
    setDocumentForm({
      subject: "",
      documentType: "",
      expiresOn: "",
      notes: "",
    });
    setEditor({ kind: "document", mode: "create" });
  }
  function openDocumentEdit(item: ComplianceDocument) {
    setDocumentForm({
      subject: item.resource_id
        ? `resource:${item.resource_id}`
        : `crew:${item.crew_actor_id}`,
      documentType: item.document_type,
      expiresOn: item.expires_on,
      notes: item.notes ?? "",
    });
    setEditor({ kind: "document", mode: "edit", item });
  }
  function openAssignmentCreate() {
    setAssignmentForm({
      departureId: "",
      subject: "",
      assignmentRole: "",
      overrideReason: "",
    });
    setEditor({ kind: "assignment", mode: "create" });
  }
  function openAssignmentEdit(item: Assignment) {
    setAssignmentForm({
      departureId: item.departure_id,
      subject: item.resource_id
        ? `resource:${item.resource_id}`
        : `crew:${item.crew_actor_id}`,
      assignmentRole: item.assignment_role,
      overrideReason: "",
    });
    setEditor({ kind: "assignment", mode: "edit", item });
  }

  const blockingDocuments = useMemo(() => {
    if (editor?.kind !== "assignment" || editor.mode !== "create") return [];
    if (!assignmentForm.departureId || !assignmentForm.subject) return [];
    const departure = departures.data?.items.find(
      (item) => item.id === assignmentForm.departureId,
    );
    if (!departure || !documents.data) return [];
    const localDate = localDateFromInstant(
      departure.starts_at,
      session.tenant.timezone,
    );
    const [kind, id] = assignmentForm.subject.split(":");
    return documents.data.filter(
      (doc) =>
        doc.expires_on < localDate &&
        ((kind === "resource" && doc.resource_id === id) ||
          (kind === "crew" && doc.crew_actor_id === id)),
    );
  }, [
    assignmentForm.departureId,
    assignmentForm.subject,
    departures.data,
    documents.data,
    editor,
    session.tenant.timezone,
  ]);

  async function submitEditor() {
    if (!editor) return;
    if (editor.kind === "crew") {
      const result =
        editor.mode === "create"
          ? await save.run("ops/v1/crew", {
              actorId: crewForm.actorId,
              operationalName: crewForm.operationalName,
              notes: crewForm.notes,
            })
          : await save.run(
              `ops/v1/crew/${editor.item.actor_id}`,
              {
                operationalName: crewForm.operationalName,
                notes: crewForm.notes,
                active: crewForm.active,
              },
              "PATCH",
            );
      if (result) {
        setEditor(null);
        reload();
      }
      return;
    }
    if (editor.kind === "resource") {
      const payload = {
        code: resourceCodeFrom(resourceForm.code),
        name: resourceForm.name,
        type: resourceForm.type,
        capacity: resourceForm.capacity
          ? Number(resourceForm.capacity)
          : null,
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
        reload();
      }
      return;
    }
    if (editor.kind === "document") {
      const [kind, id] = documentForm.subject.split(":");
      const result =
        editor.mode === "create"
          ? await save.run("ops/v1/compliance-documents", {
              documentType: documentForm.documentType,
              expiresOn: documentForm.expiresOn,
              notes: documentForm.notes,
              resourceId: kind === "resource" ? id : undefined,
              crewActorId: kind === "crew" ? id : undefined,
            })
          : await save.run(
              `ops/v1/compliance-documents/${editor.item.id}`,
              {
                documentType: documentForm.documentType,
                expiresOn: documentForm.expiresOn,
                notes: documentForm.notes,
              },
              "PATCH",
            );
      if (result) {
        setEditor(null);
        reload();
      }
      return;
    }
    if (editor.kind === "assignment") {
      if (editor.mode === "edit") {
        const result = await save.run(
          `ops/v1/assignments/${editor.item.id}`,
          { assignmentRole: assignmentForm.assignmentRole },
          "PATCH",
        );
        if (result) {
          setEditor(null);
          reload();
        }
        return;
      }
      if (blockingDocuments.length && !canOverride) return;
      if (
        blockingDocuments.length &&
        assignmentForm.overrideReason.trim().length < 8
      )
        return;
      const [kind, id] = assignmentForm.subject.split(":");
      const result = await save.run("ops/v1/assignments", {
        departureId: assignmentForm.departureId,
        assignmentRole: assignmentForm.assignmentRole,
        resourceId: kind === "resource" ? id : undefined,
        crewActorId: kind === "crew" ? id : undefined,
        ...(blockingDocuments.length
          ? { overrideReason: assignmentForm.overrideReason.trim() }
          : {}),
      });
      if (result) {
        setEditor(null);
        reload();
      }
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const result =
      pendingDelete.kind === "crew"
        ? await remove.run(
            `ops/v1/crew/${pendingDelete.item.actor_id}`,
            {},
            "DELETE",
          )
        : pendingDelete.kind === "resource"
          ? await remove.run(
              `ops/v1/resources/${pendingDelete.item.id}`,
              {},
              "DELETE",
            )
          : pendingDelete.kind === "document"
            ? await remove.run(
                `ops/v1/compliance-documents/${pendingDelete.item.id}`,
                {},
                "DELETE",
              )
            : await remove.run(
                `ops/v1/assignments/${pendingDelete.item.id}`,
                {},
                "DELETE",
              );
    if (result) {
      setPendingDelete(null);
      reload();
    }
  }

  if (resources.error || crew.error || documents.error || assignments.error)
    return (
      <Notice error>
        {resources.error ||
          crew.error ||
          documents.error ||
          assignments.error}
      </Notice>
    );
  if (
    !resources.data ||
    !crew.data ||
    !members.data ||
    !documents.data ||
    !departures.data ||
    (canAssign && !assignments.data)
  )
    return <Loading />;

  const resourceList = resources.data;
  const crewList = crew.data;
  const documentList = documents.data;
  const memberList = members.data.items;
  const departureList = departures.data.items;
  const assignmentList = assignments.data ?? [];
  const availableMembers = memberList.filter(
    (member) =>
      !crewList.some((profile) => profile.actor_id === member.id) ||
      (editor?.kind === "crew" &&
        editor.mode === "edit" &&
        editor.item.actor_id === member.id),
  );

  return (
    <>
      <Heading
        eyebrow="OPERATIONS"
        title="Team & resources"
        description="Manage crew, assets, compliance documents, and departure assignments. Use the tabs to work one list at a time as records grow."
      />

      <div className="resource-metrics">
        <button
          type="button"
          className={tab === "crew" ? "active-metric" : undefined}
          onClick={() => setTab("crew")}
        >
          <strong>{activeCrew}</strong>
          <span>Active crew</span>
        </button>
        <button
          type="button"
          className={tab === "resources" ? "active-metric" : undefined}
          onClick={() => setTab("resources")}
        >
          <strong>{activeResources}</strong>
          <span>Active resources</span>
        </button>
        <button
          type="button"
          className={
            (expiredDocs ? "attention" : "") +
            (tab === "documents" ? " active-metric" : "")
          }
          onClick={() => setTab("documents")}
        >
          <strong>{expiredDocs}</strong>
          <span>Expired documents</span>
        </button>
        <button
          type="button"
          className={
            (expiringDocs ? "attention" : "") +
            (tab === "documents" ? " active-metric" : "")
          }
          onClick={() => setTab("documents")}
        >
          <strong>{expiringDocs}</strong>
          <span>Expiring in 14 days</span>
        </button>
      </div>

      {(expiredDocs > 0 || expiringDocs > 0) && tab !== "documents" && (
        <button
          type="button"
          className="resource-attention-callout"
          onClick={() => setTab("documents")}
        >
          <div>
            <strong>Expiry attention</strong>
            <span>
              {expiredDocs} expired · {expiringDocs} due within 14 days. Review
              documents.
            </span>
          </div>
          <span className="text-link">Open documents</span>
        </button>
      )}

      <div className="view-action-bar resource-view-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Team and resources sections"
        >
          {(
            [
              ["crew", "Crew"],
              ["resources", "Resources"],
              ["documents", "Documents"],
              ["assignments", "Assignments"],
            ] as const
          ).map(([id, caption]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {caption}
              {id === "documents" && expiredDocs + expiringDocs > 0 ? (
                <span className="tab-count">{expiredDocs + expiringDocs}</span>
              ) : null}
            </button>
          ))}
        </div>
        {tab === "crew" ? (
          <button
            type="button"
            className="button catalog-add-btn"
            aria-label="Add crew"
            onClick={openCrewCreate}
          >
            <Plus size={17} />
            <span className="button-label">Add crew</span>
          </button>
        ) : tab === "resources" ? (
          <button
            type="button"
            className="button catalog-add-btn"
            aria-label="Add resource"
            onClick={openResourceCreate}
          >
            <Plus size={17} />
            <span className="button-label">Add resource</span>
          </button>
        ) : tab === "documents" ? (
          <button
            type="button"
            className="button catalog-add-btn"
            aria-label="Add document"
            onClick={openDocumentCreate}
          >
            <Plus size={17} />
            <span className="button-label">Add document</span>
          </button>
        ) : canAssign ? (
          <button
            type="button"
            className="button catalog-add-btn"
            aria-label="Add assignment"
            onClick={openAssignmentCreate}
          >
            <Plus size={17} />
            <span className="button-label">Add assignment</span>
          </button>
        ) : null}
      </div>

{tab === "crew" && (
      <section className="panel" role="tabpanel" aria-label="Crew profiles">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Crew profiles</h2>
            <p className="muted">
              Operational names used on manifests and assignments — separate
              from login roles.
            </p>
          </div>
        </div>
        {crewList.length ? (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Operational name</th>
                    <th>Member</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {crewList.map((item) => (
                    <tr key={item.actor_id}>
                      <td>
                        <strong>{item.operational_name}</strong>
                      </td>
                      <td>
                        <strong>{item.name}</strong>
                        <small>{item.email}</small>
                      </td>
                      <td>
                        <Status state={item.active ? "active" : "inactive"} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => openCrewEdit(item)}
                          >
                            Edit
                          </button>
                          {item.active && (
                            <button
                              type="button"
                              className="text-link danger-text"
                              onClick={() =>
                                setPendingDelete({ kind: "crew", item })
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
              {crewList.map((item) => (
                <article key={item.actor_id} className="resource-card">
                  <div className="resource-card-head">
                    <strong>{item.operational_name}</strong>
                    <Status state={item.active ? "active" : "inactive"} />
                  </div>
                  <small>
                    {item.name} · {item.email}
                  </small>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => openCrewEdit(item)}
                    >
                      Edit
                    </button>
                    {item.active && (
                      <button
                        type="button"
                        className="text-link danger-text"
                        onClick={() =>
                          setPendingDelete({ kind: "crew", item })
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
          <Empty title="No crew profiles yet">
            Add a tenant member as operational crew to assign them to
            departures.
          </Empty>
        )}
      </section>

)}

{tab === "resources" && (
      <section className="panel" role="tabpanel" aria-label="Resources">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Resources</h2>
            <p className="muted">
              Vehicles, vessels, and equipment available for departure
              assignment.
            </p>
          </div>
        </div>
        {resourceList.length ? (
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
                  {resourceList.map((item) => (
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
              {resourceList.map((item) => (
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
          <Empty title="No resources yet">
            Add a vehicle, vessel, or equipment item for assignment.
          </Empty>
        )}
      </section>

)}

{tab === "documents" && (
      <section className="panel" role="tabpanel" aria-label="Documents">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Documents</h2>
            <p className="muted">
              Licenses and insurance tied to one crew member or resource.
              Expiry blocks new assignments.
            </p>
          </div>
        </div>
        {attentionDocs.length > 0 && (
          <ul className="resource-attention-list resource-attention-inset">
            {attentionDocs.map((doc) => {
              const state = documentStatus(doc.expires_on, today, soon);
              return (
                <li key={doc.id}>
                  <div>
                    <strong>{subjectName(doc)}</strong>
                    <small>
                      {doc.document_type} · expires{" "}
                      {dateOnly(doc.expires_on, dateFormat)}
                    </small>
                  </div>
                  <Status state={state} />
                </li>
              );
            })}
          </ul>
        )}
        {documentList.length ? (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Document</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {documentList.map((doc) => {
                    const state = documentStatus(doc.expires_on, today, soon);
                    return (
                      <tr key={doc.id}>
                        <td>
                          <strong>{subjectName(doc)}</strong>
                        </td>
                        <td>{doc.document_type}</td>
                        <td>{dateOnly(doc.expires_on, dateFormat)}</td>
                        <td>
                          <Status state={state} />
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => openDocumentEdit(doc)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-link danger-text"
                              onClick={() =>
                                setPendingDelete({ kind: "document", item: doc })
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {documentList.map((doc) => {
                const state = documentStatus(doc.expires_on, today, soon);
                return (
                  <article key={doc.id} className="resource-card">
                    <div className="resource-card-head">
                      <strong>{subjectName(doc)}</strong>
                      <Status state={state} />
                    </div>
                    <small>
                      {doc.document_type} · expires{" "}
                      {dateOnly(doc.expires_on, dateFormat)}
                    </small>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => openDocumentEdit(doc)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-link danger-text"
                        onClick={() =>
                          setPendingDelete({ kind: "document", item: doc })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <Empty title="No compliance documents">
            Record licenses and insurance against crew or resources.
          </Empty>
        )}
      </section>

)}

{tab === "assignments" && (
      <section className="panel" role="tabpanel" aria-label="Departure assignments">
        <div className="panel-heading plain resource-tab-intro">
          <div>
            <h2>Departure assignments</h2>
            <p className="muted">
              Active crew and resource assignments. Expired documents block
              new assignments unless an authorized override is recorded.
            </p>
          </div>
        </div>
        {!canAssign ? (
          <p className="muted resource-empty-note">
            You can manage crew and resources here. Assignment changes need
            dispatch permission.
          </p>
        ) : assignmentList.length ? (
          <>
            <div className="table-scroll resource-table">
              <table>
                <thead>
                  <tr>
                    <th>Departure</th>
                    <th>Subject</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {assignmentList.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.product_name}</strong>
                        <small>
                          {dateTime(
                            item.departure_starts_at,
                            session.tenant.timezone,
                          )}
                        </small>
                      </td>
                      <td>
                        {item.crew_name
                          ? `Crew · ${item.crew_name}`
                          : `Resource · ${item.resource_name}`}
                      </td>
                      <td>{label(item.assignment_role)}</td>
                      <td>
                        <Status
                          state={item.override_reason ? "expiring" : "active"}
                        />
                        {item.override_reason ? (
                          <small>Override</small>
                        ) : null}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => openAssignmentEdit(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-link danger-text"
                            onClick={() =>
                              setPendingDelete({ kind: "assignment", item })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="resource-cards">
              {assignmentList.map((item) => (
                <article key={item.id} className="resource-card">
                  <div className="resource-card-head">
                    <strong>{item.product_name}</strong>
                    <Status
                      state={item.override_reason ? "expiring" : "active"}
                    />
                  </div>
                  <small>
                    {item.crew_name
                      ? `Crew · ${item.crew_name}`
                      : `Resource · ${item.resource_name}`}{" "}
                    · {label(item.assignment_role)}
                    {item.override_reason ? " · override" : ""}
                  </small>
                  <small>
                    {dateTime(
                      item.departure_starts_at,
                      session.tenant.timezone,
                    )}
                  </small>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => openAssignmentEdit(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-link danger-text"
                      onClick={() =>
                        setPendingDelete({ kind: "assignment", item })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <Empty title="No active assignments">
            Assign crew or resources to upcoming departures.
          </Empty>
        )}
      </section>

)}

      <FormDialog
        open={editor?.kind === "crew"}
        title={
          editor?.kind === "crew" && editor.mode === "edit"
            ? "Edit crew profile"
            : "Add crew profile"
        }
        description="Operational names appear on manifests and assignments."
        busy={save.busy}
        error={save.error}
        submitLabel={
          editor?.kind === "crew" && editor.mode === "edit"
            ? "Save crew"
            : "Add crew"
        }
        onClose={() => setEditor(null)}
        onSubmit={submitEditor}
      >
        {editor?.kind === "crew" && editor.mode === "create" ? (
          <Field label="Tenant member" required>
            <select
              required
              value={crewForm.actorId}
              onChange={(e) =>
                setCrewForm((v) => ({ ...v, actorId: e.target.value }))
              }
            >
              <option value="">Select a member</option>
              {availableMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="muted">
            Linked member stays fixed. Change access in Staff & access.
          </p>
        )}
        <Field label="Operational name" required>
          <input
            required
            value={crewForm.operationalName}
            onChange={(e) =>
              setCrewForm((v) => ({
                ...v,
                operationalName: e.target.value,
              }))
            }
            placeholder="Guide, driver or skipper name"
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={crewForm.notes}
            onChange={(e) =>
              setCrewForm((v) => ({ ...v, notes: e.target.value }))
            }
          />
        </Field>
        {editor?.kind === "crew" && editor.mode === "edit" && (
          <Toggle
            label="Active for assignment"
            checked={crewForm.active}
            onChange={(active) => setCrewForm((v) => ({ ...v, active }))}
          />
        )}
      </FormDialog>

      <FormDialog
        open={editor?.kind === "resource"}
        title={
          editor?.kind === "resource" && editor.mode === "edit"
            ? "Edit resource"
            : "Add resource"
        }
        description="Vehicles, vessels, and equipment for departure assignment."
        busy={save.busy}
        error={save.error}
        submitLabel={
          editor?.kind === "resource" && editor.mode === "edit"
            ? "Save resource"
            : "Add resource"
        }
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
        {editor?.kind === "resource" && editor.mode === "edit" && (
          <Toggle
            label="Active for assignment"
            checked={resourceForm.active}
            onChange={(active) =>
              setResourceForm((v) => ({ ...v, active }))
            }
          />
        )}
      </FormDialog>

      <FormDialog
        open={editor?.kind === "document"}
        title={
          editor?.kind === "document" && editor.mode === "edit"
            ? "Edit document"
            : "Add document"
        }
        description="Expiry is evaluated against the departure’s local date."
        busy={save.busy}
        error={save.error}
        submitLabel={
          editor?.kind === "document" && editor.mode === "edit"
            ? "Save document"
            : "Add document"
        }
        onClose={() => setEditor(null)}
        onSubmit={submitEditor}
      >
        <Field label="Subject" required>
          <select
            required
            disabled={editor?.kind === "document" && editor.mode === "edit"}
            value={documentForm.subject}
            onChange={(e) =>
              setDocumentForm((v) => ({ ...v, subject: e.target.value }))
            }
          >
            <option value="">Select resource or crew</option>
            {resourceList.map((x) => (
              <option key={x.id} value={`resource:${x.id}`}>
                Resource · {x.name}
              </option>
            ))}
            {crewList.map((x) => (
              <option key={x.actor_id} value={`crew:${x.actor_id}`}>
                Crew · {x.operational_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Document type" required>
          <input
            required
            value={documentForm.documentType}
            onChange={(e) =>
              setDocumentForm((v) => ({
                ...v,
                documentType: e.target.value,
              }))
            }
            placeholder="License or insurance"
          />
        </Field>
        <Field label="Expiry date" required>
          <input
            type="date"
            required
            value={documentForm.expiresOn}
            onChange={(e) =>
              setDocumentForm((v) => ({ ...v, expiresOn: e.target.value }))
            }
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={documentForm.notes}
            onChange={(e) =>
              setDocumentForm((v) => ({ ...v, notes: e.target.value }))
            }
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={editor?.kind === "assignment"}
        title={
          editor?.kind === "assignment" && editor.mode === "edit"
            ? "Edit assignment"
            : "Add assignment"
        }
        description={
          editor?.kind === "assignment" && editor.mode === "edit"
            ? "Update the assignment role. To change departure or subject, remove this assignment and add a new one."
            : "Assign active crew or resources to a departure."
        }
        busy={save.busy}
        error={
          save.error ||
          (editor?.kind === "assignment" &&
          editor.mode === "create" &&
          blockingDocuments.length &&
          !canOverride
            ? "This subject has an expired compliance document. An authorized safety override is required."
            : null)
        }
        submitLabel={
          editor?.kind === "assignment" && editor.mode === "edit"
            ? "Save assignment"
            : "Add assignment"
        }
        onClose={() => setEditor(null)}
        onSubmit={submitEditor}
      >
        <Field label="Departure" required>
          <select
            required
            disabled={editor?.kind === "assignment" && editor.mode === "edit"}
            value={assignmentForm.departureId}
            onChange={(e) =>
              setAssignmentForm((v) => ({
                ...v,
                departureId: e.target.value,
                overrideReason: "",
              }))
            }
          >
            <option value="">Select departure</option>
            {departureList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.product_name} ·{" "}
                {dateTime(d.starts_at, session.tenant.timezone)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Crew or resource" required>
          <select
            required
            disabled={editor?.kind === "assignment" && editor.mode === "edit"}
            value={assignmentForm.subject}
            onChange={(e) =>
              setAssignmentForm((v) => ({
                ...v,
                subject: e.target.value,
                overrideReason: "",
              }))
            }
          >
            <option value="">Select subject</option>
            {resourceList
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={`resource:${x.id}`}>
                  Resource · {x.name}
                </option>
              ))}
            {crewList
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.actor_id} value={`crew:${x.actor_id}`}>
                  Crew · {x.operational_name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Assignment role" required>
          <input
            required
            value={assignmentForm.assignmentRole}
            onChange={(e) =>
              setAssignmentForm((v) => ({
                ...v,
                assignmentRole: e.target.value,
              }))
            }
            placeholder="Driver, guide, vessel"
          />
        </Field>
        {editor?.kind === "assignment" &&
          editor.mode === "create" &&
          blockingDocuments.length > 0 && (
            <>
              <Notice error>
                Expired document
                {blockingDocuments.length > 1 ? "s" : ""}:{" "}
                {blockingDocuments.map((doc) => doc.document_type).join(", ")}.
                A safety override is required to assign this subject.
              </Notice>
              {canOverride && (
                <Field
                  label="Safety override reason"
                  required
                  hint="Explain why this temporary assignment is safe. Audited."
                >
                  <textarea
                    required
                    minLength={8}
                    value={assignmentForm.overrideReason}
                    onChange={(e) =>
                      setAssignmentForm((v) => ({
                        ...v,
                        overrideReason: e.target.value,
                      }))
                    }
                    placeholder="Manager confirmed temporary replacement inspection."
                  />
                </Field>
              )}
            </>
          )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.kind === "document"
            ? "Delete document?"
            : pendingDelete?.kind === "crew"
              ? "Remove crew profile?"
              : pendingDelete?.kind === "assignment"
                ? "Remove assignment?"
                : "Remove resource?"
        }
        description={
          pendingDelete?.kind === "document"
            ? `${pendingDelete.item.document_type} for ${subjectName(pendingDelete.item)} will be permanently deleted.`
            : pendingDelete?.kind === "crew"
              ? `${pendingDelete.item.operational_name} will be deactivated and cannot be assigned to new departures. Past assignments stay on record.`
              : pendingDelete?.kind === "assignment"
                ? `${pendingDelete.item.product_name} · ${label(pendingDelete.item.assignment_role)} will be cancelled. The historical assignment record stays available.`
                : pendingDelete?.kind === "resource"
                  ? `${pendingDelete.item.name} will be deactivated and cannot be assigned to new departures. Past assignments stay on record.`
                  : undefined
        }
        confirmLabel={
          pendingDelete?.kind === "document"
            ? "Delete document"
            : pendingDelete?.kind === "assignment"
              ? "Remove assignment"
              : "Remove"
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
