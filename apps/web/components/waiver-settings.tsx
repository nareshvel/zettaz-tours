"use client";

import { useState } from "react";
import { FileSignature, Pencil, Plus, Trash2 } from "lucide-react";
import type { Session } from "@/lib/types";
import { useMutation, useResource } from "@/lib/client";
import {
  ConfirmDialog,
  Empty,
  Field,
  FormDialog,
  InfoTip,
  Loading,
  Notice,
} from "./common";

type WaiverTemplate = {
  id: string;
  version: number;
  title: string;
  body: string;
  active: boolean;
  created_at: string;
  signature_count: number;
};

const emptyDraft = { title: "", body: "" };

export function WaiverSettings({ session }: { session: Session }) {
  const canPublish = session.permissions.includes("waiver.template.publish");
  const templates = useResource<WaiverTemplate[]>(
    "ops/v1/waiver-templates?history=1",
  );
  const publish = useMutation();
  const remove = useMutation();

  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [basedOn, setBasedOn] = useState<WaiverTemplate | null>(null);
  const [deleting, setDeleting] = useState<WaiverTemplate | null>(null);
  const [notice, setNotice] = useState("");

  const all = templates.data ?? [];
  const active = all.find((template) => template.active) ?? null;
  const superseded = all.filter((template) => !template.active);

  function openNew() {
    setBasedOn(null);
    setDraft(emptyDraft);
    publish.clear();
    setNotice("");
    setEditorOpen(true);
  }

  function openEdit(template: WaiverTemplate) {
    setBasedOn(template);
    setDraft({ title: template.title, body: template.body });
    publish.clear();
    setNotice("");
    setEditorOpen(true);
  }

  async function submit() {
    const result = await publish.run<WaiverTemplate>(
      "ops/v1/waiver-templates",
      { title: draft.title.trim(), body: draft.body.trim() },
    );
    if (result) {
      setEditorOpen(false);
      setDraft(emptyDraft);
      setBasedOn(null);
      setNotice(
        `Version ${result.version} is now the wording guests sign. Earlier signatures keep the version they agreed to.`,
      );
      templates.reload();
    }
  }

  async function confirmDelete(template: WaiverTemplate) {
    const result = await remove.run(
      `ops/v1/waiver-templates/${template.id}`,
      {},
      "DELETE",
    );
    if (result) {
      setDeleting(null);
      setNotice(`Version ${template.version} deleted.`);
      templates.reload();
    }
  }

  return (
    <section>
      <div className="settings-card-head">
        <FileSignature size={20} />
        <div>
          <h2>
            Waiver templates
            <InfoTip label="waiver templates">
              Editing publishes a new version rather than changing the words in
              place. A signature is only meaningful alongside the exact wording
              the guest agreed to, so past versions are held as evidence and
              their text can never be altered — which is also why a version any
              guest has signed cannot be deleted. Confirm wording with the
              tenant&apos;s legal and insurance advisers before publishing.
            </InfoTip>
          </h2>
          <p>The wording guests sign at check-in.</p>
        </div>
        {canPublish && (
          <button
            type="button"
            className="button catalog-add-btn settings-head-action"
            onClick={openNew}
            aria-label="Publish new version"
          >
            <Plus size={17} />
            <span className="button-label">New version</span>
          </button>
        )}
      </div>

      {notice && <Notice>{notice}</Notice>}
      {remove.error && <Notice error>{remove.error}</Notice>}

      {templates.error ? (
        <Notice error>{templates.error}</Notice>
      ) : !templates.data ? (
        <Loading />
      ) : !active ? (
        <Empty title="No waiver published yet">
          <p>
            Staff cannot capture a signature until one version is in place.
            Publish the wording your insurer has approved.
          </p>
          {canPublish && (
            <button type="button" className="button" onClick={openNew}>
              <Plus size={16} /> Publish first version
            </button>
          )}
        </Empty>
      ) : (
        <>
          <article className="waiver-active">
            <div className="waiver-active-head">
              <div>
                <span className="eyebrow">IN USE</span>
                <strong>{active.title}</strong>
                <p>
                  Version {active.version} · published{" "}
                  {new Date(active.created_at).toLocaleDateString()} ·{" "}
                  {active.signature_count.toLocaleString()} signature
                  {active.signature_count === 1 ? "" : "s"}
                </p>
              </div>
              {canPublish && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => openEdit(active)}
                  aria-label="Edit waiver wording"
                >
                  <Pencil size={16} />
                  <span className="button-label">Edit</span>
                </button>
              )}
            </div>
            <p className="waiver-active-body">{active.body}</p>
          </article>

          {superseded.length > 0 && (
            <>
              <div className="form-divider" />
              <h2>
                Earlier versions
                <InfoTip label="earlier versions">
                  Kept so that a signature captured under older wording can
                  still be read back exactly as it stood. One with no signatures
                  against it was replaced before anyone signed it and can be
                  cleared away.
                </InfoTip>
              </h2>
              <div className="settings-list">
                {superseded.map((template) => (
                  <article key={template.id}>
                    <div>
                      <strong>
                        v{template.version} · {template.title}
                      </strong>
                      <p>
                        Published{" "}
                        {new Date(template.created_at).toLocaleDateString()} ·{" "}
                        {template.signature_count
                          ? `${template.signature_count.toLocaleString()} signature${template.signature_count === 1 ? "" : "s"} held as evidence`
                          : "Never signed"}
                      </p>
                    </div>
                    {canPublish && (
                      <div className="button-row">
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => openEdit(template)}
                          aria-label={`Reuse version ${template.version} as a new version`}
                          title="Start a new version from this wording"
                        >
                          <Pencil size={16} />
                          <span className="button-label">Reuse</span>
                        </button>
                        {!template.signature_count && (
                          <button
                            type="button"
                            className="icon-button danger"
                            onClick={() => {
                              remove.clear();
                              setDeleting(template);
                            }}
                            aria-label={`Delete version ${template.version}`}
                            title="Delete this version"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!canPublish && (
        <Notice>
          Only the tenant owner can publish or replace waiver wording.
        </Notice>
      )}

      <FormDialog
        open={editorOpen}
        className="form-dialog-wide"
        title={
          basedOn
            ? `Edit wording (from v${basedOn.version})`
            : "New waiver version"
        }
        description={
          all.length
            ? "Saving publishes this as the next version and it becomes what guests sign from now on. Signatures already captured keep the wording they were given."
            : "This becomes the wording every guest signs at check-in."
        }
        busy={publish.busy}
        error={publish.error}
        submitLabel={publish.busy ? "Publishing…" : "Publish version"}
        submitDisabled={!draft.title.trim() || !draft.body.trim()}
        onClose={() => {
          if (!publish.busy) setEditorOpen(false);
        }}
        onSubmit={submit}
      >
        <Field label="Template title" required>
          <input
            required
            maxLength={160}
            value={draft.title}
            placeholder="For example, Tour participant waiver"
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </Field>
        <Field
          label="Approved waiver wording"
          required
          hint="Exactly as approved — this text is what a guest agrees to and cannot be changed after publishing."
        >
          <textarea
            required
            rows={14}
            maxLength={20000}
            value={draft.body}
            placeholder="Enter tenant-approved wording"
            onChange={(event) =>
              setDraft((current) => ({ ...current, body: event.target.value }))
            }
          />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title={`Delete version ${deleting?.version ?? ""}?`}
        description={
          <>
            <strong>{deleting?.title}</strong> was never signed, so nothing
            depends on it. This cannot be undone.
          </>
        }
        confirmLabel="Delete version"
        busy={remove.busy}
        error={remove.error}
        onConfirm={() => {
          if (deleting) return confirmDelete(deleting);
        }}
        onClose={() => {
          if (!remove.busy) setDeleting(null);
        }}
      />
    </section>
  );
}
