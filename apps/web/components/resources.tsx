"use client";
import { useState } from "react";
import { Plus, UsersRound, Truck } from "lucide-react";
import { useMutation, useResource } from "@/lib/client";
import { Field, Heading, Loading, Notice } from "./common";
import type { Member } from "@/lib/types";

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
};
type Departure = { id: string; product_name: string; starts_at: string };
export function Resources() {
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
  const addResource = useMutation(),
    addCrew = useMutation(),
    addDocument = useMutation(),
    addAssignment = useMutation();
  const [resource, setResource] = useState({
    code: "",
    name: "",
    type: "vehicle",
    capacity: "",
    notes: "",
  });
  const [crewMember, setCrewMember] = useState(""),
    [operationalName, setOperationalName] = useState("");
  const [subject, setSubject] = useState(""),
    [documentType, setDocumentType] = useState(""),
    [expiresOn, setExpiresOn] = useState("");
  const [assignmentDeparture, setAssignmentDeparture] = useState(""),
    [assignmentSubject, setAssignmentSubject] = useState(""),
    [assignmentRole, setAssignmentRole] = useState(""),
    [overrideReason, setOverrideReason] = useState("");
  const reload = () => {
    resources.reload();
    crew.reload();
  };
  if (resources.error || crew.error || documents.error)
    return (
      <Notice error>{resources.error || crew.error || documents.error}</Notice>
    );
  if (
    !resources.data ||
    !crew.data ||
    !members.data ||
    !documents.data ||
    !departures.data
  )
    return <Loading />;
  return (
    <>
      <Heading
        title="Team & resources"
        description="Operational crew and assets available for departure assignment."
      />
      <div className="settings-grid">
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await addResource.run("ops/v1/resources", {
              ...resource,
              capacity: resource.capacity ? Number(resource.capacity) : null,
            });
            if (result) {
              setResource({
                code: "",
                name: "",
                type: "vehicle",
                capacity: "",
                notes: "",
              });
              reload();
            }
          }}
        >
          <h2>
            <Truck size={19} /> Add resource
          </h2>
          <Field label="Name">
            <input
              required
              value={resource.name}
              onChange={(e) =>
                setResource((v) => ({
                  ...v,
                  name: e.target.value,
                  code:
                    v.code ||
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "_")
                      .replace(/^_|_$/g, ""),
                }))
              }
            />
          </Field>
          <Field label="Code">
            <input
              required
              pattern="[a-z][a-z0-9_-]{1,49}"
              value={resource.code}
              onChange={(e) =>
                setResource((v) => ({ ...v, code: e.target.value }))
              }
            />
          </Field>
          <Field label="Type">
            <input
              required
              value={resource.type}
              onChange={(e) =>
                setResource((v) => ({ ...v, type: e.target.value }))
              }
              placeholder="Vehicle, vessel, equipment"
            />
          </Field>
          <Field label="Capacity">
            <input
              type="number"
              min="1"
              value={resource.capacity}
              onChange={(e) =>
                setResource((v) => ({ ...v, capacity: e.target.value }))
              }
            />
          </Field>
          <button className="button" disabled={addResource.busy}>
            <Plus size={16} /> Add resource
          </button>
          {addResource.error && <Notice error>{addResource.error}</Notice>}
        </form>
        <form
          className="panel form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await addCrew.run("ops/v1/crew", {
              actorId: crewMember,
              operationalName,
            });
            if (result) {
              setCrewMember("");
              setOperationalName("");
              reload();
            }
          }}
        >
          <h2>
            <UsersRound size={19} /> Add crew profile
          </h2>
          <Field label="Tenant member">
            <select
              required
              value={crewMember}
              onChange={(e) => setCrewMember(e.target.value)}
            >
              <option value="">Select a member</option>
              {members.data.items
                .filter((m) => !crew.data!.some((c) => c.actor_id === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Operational name">
            <input
              required
              value={operationalName}
              onChange={(e) => setOperationalName(e.target.value)}
              placeholder="Guide, driver or skipper name"
            />
          </Field>
          <button className="button" disabled={addCrew.busy}>
            <Plus size={16} /> Add crew profile
          </button>
          {addCrew.error && <Notice error>{addCrew.error}</Notice>}
        </form>
      </div>
      <section className="panel">
        <h2>Resources</h2>
        {resources.data.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Capacity</th>
                </tr>
              </thead>
              <tbody>
                {resources.data.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small>{item.code}</small>
                    </td>
                    <td>{item.type}</td>
                    <td>{item.capacity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No resources configured.</p>
        )}
      </section>
      <section className="panel form-panel">
        <h2>Compliance documents</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const [kind, id] = subject.split(":");
            const result = await addDocument.run(
              "ops/v1/compliance-documents",
              {
                documentType,
                expiresOn,
                resourceId: kind === "resource" ? id : undefined,
                crewActorId: kind === "crew" ? id : undefined,
              },
            );
            if (result) {
              setSubject("");
              setDocumentType("");
              setExpiresOn("");
              documents.reload();
            }
          }}
        >
          <div className="form-grid three">
            <Field label="Subject">
              <select
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">Select resource or crew</option>
                {resources.data.map((x) => (
                  <option key={x.id} value={`resource:${x.id}`}>
                    {x.name}
                  </option>
                ))}
                {crew.data.map((x) => (
                  <option key={x.actor_id} value={`crew:${x.actor_id}`}>
                    {x.operational_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Document type">
              <input
                required
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="License or insurance"
              />
            </Field>
            <Field label="Expiry date">
              <input
                type="date"
                required
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
              />
            </Field>
          </div>
          <button className="button" disabled={addDocument.busy}>
            Add document
          </button>
          {addDocument.error && <Notice error>{addDocument.error}</Notice>}
        </form>
        {documents.data.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {documents.data.map((x) => (
                  <tr key={x.id}>
                    <td>{x.document_type}</td>
                    <td>{x.expires_on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No compliance documents recorded.</p>
        )}
      </section>
      <section className="panel form-panel">
        <h2>Departure assignment</h2>
        <p className="muted">
          Assignments are checked against active compliance documents and
          overlapping operating windows.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const [kind, id] = assignmentSubject.split(":");
            const result = await addAssignment.run("ops/v1/assignments", {
              departureId: assignmentDeparture,
              assignmentRole,
              resourceId: kind === "resource" ? id : undefined,
              crewActorId: kind === "crew" ? id : undefined,
              ...(overrideReason ? { overrideReason } : {}),
            });
            if (result) {
              setAssignmentDeparture("");
              setAssignmentSubject("");
              setAssignmentRole("");
              setOverrideReason("");
            }
          }}
        >
          <div className="form-grid three">
            <Field label="Departure">
              <select
                required
                value={assignmentDeparture}
                onChange={(e) => setAssignmentDeparture(e.target.value)}
              >
                <option value="">Select departure</option>
                {departures.data.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.product_name} · {new Date(d.starts_at).toLocaleString()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Crew or resource">
              <select
                required
                value={assignmentSubject}
                onChange={(e) => setAssignmentSubject(e.target.value)}
              >
                <option value="">Select subject</option>
                {resources.data.map((x) => (
                  <option key={x.id} value={`resource:${x.id}`}>
                    {x.name}
                  </option>
                ))}
                {crew.data.map((x) => (
                  <option key={x.actor_id} value={`crew:${x.actor_id}`}>
                    {x.operational_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assignment role">
              <input
                required
                value={assignmentRole}
                onChange={(e) => setAssignmentRole(e.target.value)}
                placeholder="Driver, guide, vessel"
              />
            </Field>
          </div>
          <Field label="Safety override reason (only for expired documents)">
            <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Explain why this temporary assignment is safe." />
          </Field>
          <button className="button" disabled={addAssignment.busy}>
            Assign to departure
          </button>
          {addAssignment.error && <Notice error>{addAssignment.error}</Notice>}
        </form>
      </section>
      <section className="panel">
        <h2>Crew profiles</h2>
        {crew.data.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Operational name</th>
                  <th>Member</th>
                </tr>
              </thead>
              <tbody>
                {crew.data.map((item) => (
                  <tr key={item.actor_id}>
                    <td>{item.operational_name}</td>
                    <td>
                      <strong>{item.name}</strong>
                      <small>{item.email}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No crew profiles configured.</p>
        )}
      </section>
    </>
  );
}
