"use client";

import { useState } from "react";
import { Link2, Power } from "lucide-react";
import { api, money, useMutation, useResource } from "@/lib/client";
import { Heading, Loading, Notice, Status } from "./common";
import type { Product } from "@/lib/types";

type Account = {
  id: string;
  connector_code: string;
  public_inbound_id: string;
  status: "enabled" | "disabled";
};
type ConnectorDefinition = {
  code: string;
  name: string;
  category: string;
  lifecycle_status: "available" | "approval_required" | "planned";
  provisioning_available: boolean;
  capabilities: string[];
  description: string;
};
type Mapping = { id: string; external_id: string; product_name: string };
type InboxEvent = {
  id: string;
  external_event_id: string;
  status: string;
  failure_reason: string | null;
  retry_count: number;
  next_attempt_at: string | null;
  received_at: string;
  connector_code: string;
};
type AssistedImport = {
  id: string;
  source: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  quarantined_rows: number;
  duplicate_rows: number;
  currency: string | null;
  total_minor: number | null;
  paid_minor: number | null;
  created_at: string;
};
const importFields = [
  "externalReference",
  "externalProductId",
  "departureAt",
  "partySize",
  "leadName",
  "leadEmail",
  "source",
  "sourceStatus",
  "pickupDisposition",
  "currency",
  "totalMinor",
  "paidMinor",
  "partnerReference",
  "invoiceOwner",
] as const;
const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
function parseCsv(text: string) {
  const records: string[][] = [];
  let record: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  record.push(field);
  if (record.some((value) => value.trim())) records.push(record);
  if (!records.length) throw new Error("The CSV file is empty.");
  const headers = records[0].map((value) => value.trim());
  const missing = importFields.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
  return records
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        importFields.map((name) => [
          name,
          values[headers.indexOf(name)]?.trim() ?? "",
        ]),
      ),
    );
}

export function Integrations({ embedded = false }: { embedded?: boolean }) {
  const catalog = useResource<ConnectorDefinition[]>("integrations/v1/catalog");
  const accounts = useResource<Account[]>("integrations/v1/accounts");
  const mappings = useResource<Mapping[]>("integrations/v1/mappings");
  const products = useResource<Product[]>("admin/v1/products");
  const inbox = useResource<InboxEvent[]>("integrations/v1/inbox");
  const assistedImports = useResource<AssistedImport[]>(
    "integrations/v1/assisted-imports",
  );
  const create = useMutation();
  const update = useMutation();
  const addMapping = useMutation();
  const validateImport = useMutation();
  const reviewInbox = useMutation();
  const [secret, setSecret] = useState<{
    publicInboundId: string;
    secret: string;
  } | null>(null);
  const [externalId, setExternalId] = useState("");
  const [productId, setProductId] = useState("");
  const [importText, setImportText] = useState("[]");
  const [importFileName, setImportFileName] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [inboxFilter, setInboxFilter] = useState("all");
  const [reviewReason, setReviewReason] = useState("");

  if (accounts.error) return <Notice error>{accounts.error}</Notice>;
  if (!accounts.data) return <Loading />;

  async function createAccount(connectorCode: string) {
    const result = await create.run<{
      publicInboundId: string;
      secret: string;
    }>("integrations/v1/accounts", { connectorCode });
    if (result) {
      setSecret(result);
      accounts.reload();
    }
  }

  async function toggleAccount(account: Account) {
    const result = await update.run(
      `integrations/v1/accounts/${account.id}`,
      { status: account.status === "enabled" ? "disabled" : "enabled" },
      "PATCH",
    );
    if (result) accounts.reload();
  }

  async function saveMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = accounts.data?.find(
      (item) => item.connector_code === "wp_travel_engine",
    );
    if (!account) return;
    const result = await addMapping.run("integrations/v1/mappings", {
      connectorAccountId: account.id,
      entityType: "product",
      externalId,
      internalProductId: productId,
    });
    if (result) {
      setExternalId("");
      setProductId("");
      mappings.reload();
    }
  }

  async function submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportMessage("");
    try {
      const rows = JSON.parse(importText);
      if (!Array.isArray(rows)) throw new Error("Rows must be an array");
      const result = await validateImport.run<{
        valid: number;
        quarantined: number;
        duplicates: number;
        dryRun: boolean;
      }>("integrations/v1/assisted-imports", {
        source: "tenant_cutover",
        fileName: importFileName || undefined,
        connectorAccountId: accounts.data?.find(
          (item) => item.connector_code === "wp_travel_engine",
        )?.id,
        rows,
      });
      if (result) {
        setImportMessage(
          `Dry run complete: ${result.valid} ready, ${result.quarantined} quarantined, ${result.duplicates} duplicates. No bookings were created.`,
        );
        assistedImports.reload();
      }
    } catch {
      setImportMessage("Enter a valid JSON array.");
    }
  }
  function downloadTemplate() {
    const example = [
      "BOOKING-001",
      "external-tour-id",
      "2026-10-15T09:00:00-04:00",
      "2",
      "Guest Name",
      "guest@example.com",
      "spreadsheet",
      "confirmed",
      "resolved",
      "USD",
      "15000",
      "5000",
      "PARTNER-001",
      "guest",
    ];
    const blob = new Blob(
      [importFields.join(",") + "\n" + example.map(csvCell).join(",") + "\n"],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "zettaz-booking-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function selectImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportMessage("");
    try {
      const rows = parseCsv(await file.text());
      setImportText(JSON.stringify(rows, null, 2));
      setImportFileName(file.name);
      setImportMessage(
        `${rows.length} rows loaded from ${file.name}. Review and run validation.`,
      );
    } catch (error) {
      setImportMessage((error as Error).message);
    }
    event.target.value = "";
  }
  async function downloadReport(item: AssistedImport) {
    try {
      const report = await api<unknown>(
        `integrations/v1/assisted-imports/${item.id}/report`,
      );
      const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `import-acceptance-${item.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setImportMessage((error as Error).message);
    }
  }
  async function review(event: InboxEvent, action: "retry" | "dead_letter") {
    const result = await reviewInbox.run(
      `integrations/v1/inbox/${event.id}/review`,
      { action, reason: reviewReason },
    );
    if (result) {
      setReviewReason("");
      inbox.reload();
    }
  }

  return (
    <>
      {embedded ? (
        <section className="panel form-panel">
          <div className="panel-heading plain">
            <div>
              <h2>Integrations</h2>
              <p className="muted">
                Connect and manage tenant-owned booking channels and service
                providers. Each integration remains isolated and disabled until
                its setup is verified.
              </p>
            </div>
            <button
              className="button"
              disabled={
                create.busy ||
                accounts.data.some(
                  (item) => item.connector_code === "wp_travel_engine",
                )
              }
              onClick={() => void createAccount("wp_travel_engine")}
            >
              <Link2 size={16} /> Add WP Travel Engine
            </button>
          </div>
        </section>
      ) : (
        <Heading
          title="Integrations"
          description="Manage inbound connector accounts. A connector stays disabled until its endpoint and signature setup are verified."
          action={
            <button
              className="button"
              disabled={
                create.busy ||
                accounts.data.some(
                  (item) => item.connector_code === "wp_travel_engine",
                )
              }
              onClick={() => void createAccount("wp_travel_engine")}
            >
              <Link2 size={16} /> Add WP Travel Engine
            </button>
          }
        />
      )}
      {create.error && <Notice error>{create.error}</Notice>}
      {secret && (
        <Notice>
          <strong>Copy this inbound secret now.</strong> It is shown once and is
          not stored in plaintext.
          <br />
          Endpoint:{" "}
          <code>/integrations/v1/inbound/{secret.publicInboundId}</code>
          <br />
          <code>{secret.secret}</code>
        </Notice>
      )}

      {catalog.error && <Notice error>{catalog.error}</Notice>}
      {catalog.data && (
        <section className="panel form-panel">
          <div className="panel-heading plain">
            <div>
              <h2>Connector catalog</h2>
              <p className="muted">
                Channels translate into Zettaz's standard booking model.
                Provider approval and certification remain visible
                prerequisites.
              </p>
            </div>
          </div>
          <div className="stack-list">
            {catalog.data.map((definition) => {
              const configured = accounts.data!.some(
                (account) => account.connector_code === definition.code,
              );
              return (
                <div className="detail-row" key={definition.code}>
                  <span>
                    <strong>{definition.name}</strong>
                    <small>{definition.description}</small>
                    <small>
                      {definition.capabilities
                        .map((value) => value.replaceAll("_", " "))
                        .join(" · ")}
                    </small>
                  </span>
                  <div className="button-row">
                    <Status
                      state={
                        configured ? "configured" : definition.lifecycle_status
                      }
                    />
                    {definition.provisioning_available && !configured && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={create.busy}
                        onClick={() => void createAccount(definition.code)}
                      >
                        Configure
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!accounts.data.length ? (
        <Notice>No connector account exists yet.</Notice>
      ) : (
        <div className="stack-list">
          {accounts.data.map((account) => (
            <article className="panel finance-claim" key={account.id}>
              <div className="panel-heading plain">
                <div>
                  <p className="eyebrow">
                    {account.connector_code.replaceAll("_", " ")}
                  </p>
                  <h2>Inbound account</h2>
                  <p>Public ID: {account.public_inbound_id}</p>
                </div>
                <Status state={account.status} />
              </div>
              <button
                className="button secondary"
                disabled={update.busy}
                onClick={() => toggleAccount(account)}
              >
                <Power size={16} />{" "}
                {account.status === "enabled"
                  ? "Disable connector"
                  : "Enable connector"}
              </button>
            </article>
          ))}
        </div>
      )}
      {update.error && <Notice error>{update.error}</Notice>}

      {accounts.data.some(
        (item) => item.connector_code === "wp_travel_engine",
      ) &&
        products.data && (
          <section className="panel form-panel">
            <h2>Product mappings</h2>
            <p className="muted">
              Map the external WP product or option ID before event processing
              is enabled.
            </p>
            <form onSubmit={saveMapping}>
              <div className="form-grid">
                <label className="field">
                  <span>External WP product ID</span>
                  <input
                    required
                    value={externalId}
                    onChange={(event) => setExternalId(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Internal tour</span>
                  <select
                    required
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                  >
                    <option value="">Choose a tour</option>
                    {products.data.map((product) => (
                      <option value={product.id} key={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="button" disabled={addMapping.busy}>
                Save mapping
              </button>
              {addMapping.error && <Notice error>{addMapping.error}</Notice>}
            </form>
            {mappings.data?.map((mapping) => (
              <p key={mapping.id} className="decision-note">
                <Link2 size={16} />
                {mapping.external_id} → {mapping.product_name}
              </p>
            ))}
          </section>
        )}

      {inbox.data && (
        <section className="panel form-panel">
          <div className="panel-heading">
            <h2>Inbound review queue</h2>
            <select
              aria-label="Filter inbox state"
              value={inboxFilter}
              onChange={(event) => setInboxFilter(event.target.value)}
            >
              <option value="all">All events</option>
              <option value="received">Received</option>
              <option value="quarantined">Quarantined</option>
              <option value="retry_pending">Retry pending</option>
              <option value="dead_letter">Dead letter</option>
              <option value="processed">Processed</option>
            </select>
          </div>
          <label className="field">
            <span>Review reason</span>
            <input
              value={reviewReason}
              minLength={8}
              maxLength={500}
              onChange={(event) => setReviewReason(event.target.value)}
              placeholder="Required for retry or dead-letter action"
            />
          </label>
          {reviewInbox.error && <Notice error>{reviewInbox.error}</Notice>}
          {!inbox.data.filter(
            (event) => inboxFilter === "all" || event.status === inboxFilter,
          ).length ? (
            <p className="muted">No inbound events match this filter.</p>
          ) : (
            inbox.data
              .filter(
                (event) =>
                  inboxFilter === "all" || event.status === inboxFilter,
              )
              .map((event) => (
                <div className="detail-row" key={event.id}>
                  <span>
                    <strong>{event.external_event_id}</strong>
                    <small>
                      {event.connector_code.replaceAll("_", " ")} ·{" "}
                      {new Date(event.received_at).toLocaleString()} ·{" "}
                      {event.retry_count} retries
                    </small>
                    {event.failure_reason && (
                      <small>{event.failure_reason}</small>
                    )}
                  </span>
                  <div className="button-row">
                    <Status state={event.status} />
                    {["quarantined", "dead_letter"].includes(event.status) && (
                      <button
                        className="button secondary"
                        disabled={
                          reviewInbox.busy || reviewReason.trim().length < 8
                        }
                        onClick={() => void review(event, "retry")}
                      >
                        Queue retry
                      </button>
                    )}
                    {event.status !== "processed" &&
                      event.status !== "dead_letter" && (
                        <button
                          className="text-button danger"
                          disabled={
                            reviewInbox.busy || reviewReason.trim().length < 8
                          }
                          onClick={() => void review(event, "dead_letter")}
                        >
                          Dead letter
                        </button>
                      )}
                  </div>
                </div>
              ))
          )}
        </section>
      )}

      <section className="panel form-panel">
        <div className="panel-heading plain">
          <div>
            <h2>Booking import reconciliation</h2>
            <p className="muted">
              Stage future bookings, detect exceptions, and preserve an
              acceptance record. Validation never creates bookings or sends
              customer messages.
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={downloadTemplate}
          >
            Download CSV template
          </button>
        </div>
        <form onSubmit={submitImport}>
          <label className="field">
            <span>Tenant export CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void selectImportFile(event)}
            />
          </label>
          <label className="field">
            <span>Normalized staging rows</span>
            <textarea
              rows={9}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
          </label>
          <p className="muted">
            Amounts use minor units. Departure time must include its UTC offset.
            Pickup disposition, payment balance, invoice owner, partner
            reference, and product mapping are retained for manual acceptance.
          </p>
          <button className="button" disabled={validateImport.busy}>
            Run dry-run validation
          </button>
          {(importMessage || validateImport.error) && (
            <Notice error={Boolean(validateImport.error)}>
              {validateImport.error || importMessage}
            </Notice>
          )}
        </form>
        {assistedImports.data?.map((item) => (
          <div className="detail-row" key={item.id}>
            <span>
              <strong>{item.file_name || item.source}</strong>
              <small>
                {new Date(item.created_at).toLocaleString()} · {item.valid_rows}
                /{item.total_rows} ready · {item.quarantined_rows} quarantined
                {item.currency && item.total_minor !== null
                  ? ` · ${money(item.total_minor, item.currency)} total`
                  : ""}
              </small>
            </span>
            <div className="button-row">
              <Status state={item.status} />
              <button
                type="button"
                className="button secondary"
                onClick={() => void downloadReport(item)}
              >
                Acceptance report
              </button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
