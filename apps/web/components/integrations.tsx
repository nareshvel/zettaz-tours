"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Download, Link2, Plug, Power } from "lucide-react";
import { api, dateTime, money, useMutation, useResource } from "@/lib/client";
import {
  Empty,
  Field,
  FormActions,
  Heading,
  InfoTip,
  Loading,
  Notice,
  SearchBox,
  Status,
} from "./common";
import type { Product, Session } from "@/lib/types";

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

export function Integrations({
  embedded = false,
  session = null,
}: {
  embedded?: boolean;
  session?: Session | null;
} = {}) {
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
  const [channelSearch, setChannelSearch] = useState("");
  const [tab, setTab] = useState<"channels" | "mapping" | "inbox" | "import">(
    "channels",
  );
  const [reviewReason, setReviewReason] = useState("");
  const visibleCatalog = useMemo(() => {
    const list = catalog.data ?? [];
    const q = channelSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((definition) =>
      [definition.name, definition.code, definition.description]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [catalog.data, channelSearch]);

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

  const wpAccount = accounts.data.find(
    (item) => item.connector_code === "wp_travel_engine",
  );
  const inboxNeedsReview = (inbox.data ?? []).filter((event) =>
    ["quarantined", "dead_letter", "retry_pending"].includes(event.status),
  ).length;
  const filteredInbox = (inbox.data ?? []).filter(
    (event) => inboxFilter === "all" || event.status === inboxFilter,
  );
  const inboxEmptyCopy =
    inboxFilter === "all"
      ? "Events appear here when a connected channel posts to the inbound endpoint."
      : "Try another status filter.";

  function formatWhen(value: string) {
    if (!session) return new Date(value).toLocaleString();
    return dateTime(
      value,
      session.tenant.timezone,
      session.tenant.config.locale,
      session.tenant.config.dateFormat,
      session.tenant.config.timeFormat,
    );
  }

  const sections = (
    <>
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

      <div className="view-action-bar">
        <div
          className="view-tabs compact"
          role="tablist"
          aria-label="Integration sections"
        >
          <button
            type="button"
            className="view-tab-link"
            role="tab"
            aria-selected={tab === "channels"}
            onClick={() => setTab("channels")}
          >
            Channels
            {accounts.data.length > 0 && (
              <span className="tab-count neutral">{accounts.data.length}</span>
            )}
          </button>
          <button
            type="button"
            className="view-tab-link"
            role="tab"
            aria-selected={tab === "mapping"}
            onClick={() => setTab("mapping")}
          >
            Product mapping
            {mappings.data?.length ? (
              <span className="tab-count neutral">{mappings.data.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="view-tab-link"
            role="tab"
            aria-selected={tab === "inbox"}
            onClick={() => setTab("inbox")}
          >
            Inbound queue
            {inboxNeedsReview > 0 && (
              <span className="tab-count">{inboxNeedsReview}</span>
            )}
          </button>
          <button
            type="button"
            className="view-tab-link"
            role="tab"
            aria-selected={tab === "import"}
            onClick={() => setTab("import")}
          >
            Import
          </button>
        </div>
      </div>

      {tab === "channels" && (
        <>
          {catalog.error && <Notice error>{catalog.error}</Notice>}
          {update.error && <Notice error>{update.error}</Notice>}
          {!catalog.data ? (
            <Loading />
          ) : (
            <>
              <Notice>
                WordPress / OTA transforms stay off until a representative
                payload is available. CSV dry-run import works now; connecting a
                channel still does not invent bookings.
              </Notice>
              <div className="staff-list-tools fleet-asset-bar">
                <SearchBox
                  value={channelSearch}
                  onChange={setChannelSearch}
                  placeholder="Search channels"
                />
              </div>
              {visibleCatalog.length === 0 ? (
                <Empty title="No channels match">
                  <p>Try a different name or connector code.</p>
                </Empty>
              ) : (
                <div className="settings-list">
                  {visibleCatalog.map((definition) => {
                // One row per channel, configured or not. Previously a
                // connector appeared twice — once in the catalog and again as
                // an account card below it — which read as two different
                // things to enable.
                const account = accounts.data!.find(
                  (item) => item.connector_code === definition.code,
                );
                let action: ReactNode = null;
                if (account) {
                  action = (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={update.busy}
                      onClick={() => toggleAccount(account)}
                    >
                      <Power size={16} />
                      <span className="button-label">
                        {account.status === "enabled" ? "Disable" : "Enable"}
                      </span>
                    </button>
                  );
                } else if (definition.provisioning_available) {
                  action = (
                    <button
                      type="button"
                      className="button"
                      disabled={create.busy}
                      onClick={() => void createAccount(definition.code)}
                    >
                      <Link2 size={16} />
                      <span className="button-label">Connect</span>
                    </button>
                  );
                }
                return (
                  <article key={definition.code}>
                    <div>
                      <strong>
                        {definition.name}{" "}
                        <Status
                          state={
                            account
                              ? account.status
                              : definition.lifecycle_status
                          }
                        />
                      </strong>
                      <p>{definition.description}</p>
                      <p className="integration-capabilities">
                        {definition.capabilities
                          .map((value) => value.replaceAll("_", " "))
                          .join(" · ")}
                      </p>
                      {account && (
                        <p className="integration-endpoint">
                          <code>
                            /integrations/v1/inbound/
                            {account.public_inbound_id}
                          </code>
                        </p>
                      )}
                    </div>
                    <div className="button-row">{action}</div>
                  </article>
                );
              })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "mapping" && !wpAccount ? (
        <Empty title="Connect a channel first">
          <p>
            Mapping links a channel product ID to a tour in this workspace.
            There is nothing to map until a channel is connected.
          </p>
        </Empty>
      ) : null}
      {tab === "mapping" && wpAccount ? (
        <div>
          <p className="policy-copy">
            An inbound booking names the product by the channel ID. Map each
            one to a tour here, or its events cannot be processed.
          </p>
          <form onSubmit={saveMapping}>
            <div className="form-grid">
              <Field label="External product ID" required>
                <input
                  required
                  value={externalId}
                  placeholder="As it appears in the channel"
                  onChange={(event) => setExternalId(event.target.value)}
                />
              </Field>
              <Field label="Tour in this workspace" required>
                <select
                  required
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                >
                  <option value="">Choose a tour</option>
                  {(products.data ?? []).map((product) => (
                    <option value={product.id} key={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {addMapping.error && <Notice error>{addMapping.error}</Notice>}
            <FormActions>
              <button className="button" disabled={addMapping.busy}>
                {addMapping.busy ? "Saving…" : "Save mapping"}
              </button>
            </FormActions>
          </form>
          {mappings.data?.length ? (
            <div className="settings-list">
              {mappings.data.map((mapping) => (
                <article key={mapping.id}>
                  <div>
                    <strong>{mapping.product_name}</strong>
                    <p>
                      <code>{mapping.external_id}</code> → this tour
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No products mapped yet">
              <p>Save a mapping so inbound events can match a tour.</p>
            </Empty>
          )}
        </div>
      ) : null}

      {tab === "inbox" && (
        <>
          <div className="view-action-bar">
            <p className="policy-copy">
              Events a channel has sent. Anything quarantined or dead-lettered
              is waiting on a decision here.
            </p>
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
          <Field
            label="Review reason"
            hint="Required before retrying or dead-lettering. Recorded in the audit trail."
          >
            <input
              value={reviewReason}
              minLength={8}
              maxLength={500}
              onChange={(event) => setReviewReason(event.target.value)}
              placeholder="Why this decision is being taken"
            />
          </Field>
          {reviewInbox.error && <Notice error>{reviewInbox.error}</Notice>}
          {!filteredInbox.length ? (
            <Empty title="No inbound events match">
              <p>{inboxEmptyCopy}</p>
            </Empty>
          ) : (
            <div className="settings-list">
              {filteredInbox.map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>
                      {event.external_event_id} <Status state={event.status} />
                    </strong>
                    <p>
                      {event.connector_code.replaceAll("_", " ")} ·{" "}
                      {formatWhen(event.received_at)}
                      {event.retry_count
                        ? ` · ${event.retry_count} retries`
                        : ""}
                    </p>
                    {event.failure_reason && (
                      <p className="integration-failure">
                        {event.failure_reason}
                      </p>
                    )}
                  </div>
                  <div className="button-row">
                    {["quarantined", "dead_letter"].includes(event.status) && (
                      <button
                        type="button"
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
                          type="button"
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
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "import" && (
        <>
          <div className="view-action-bar">
            <p className="policy-copy">
              Stage bookings from a previous system, see what would fail, and
              keep an acceptance record. Validation never creates bookings or
              messages guests.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={downloadTemplate}
            >
              <Download size={16} />
              <span className="button-label">CSV template</span>
            </button>
          </div>
          <form onSubmit={submitImport}>
            <div className="form-grid">
              <Field
                label="Tenant export CSV"
                hint="Parsed in the browser; nothing is uploaded until validation runs."
              >
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void selectImportFile(event)}
                />
              </Field>
            </div>
            <Field
              label="Normalized staging rows"
              hint="Amounts in minor units. Departure times must carry their UTC offset."
            >
              <textarea
                rows={9}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
              />
            </Field>
            {(importMessage || validateImport.error) && (
              <Notice error={Boolean(validateImport.error)}>
                {validateImport.error || importMessage}
              </Notice>
            )}
            <FormActions>
              <button className="button" disabled={validateImport.busy}>
                {validateImport.busy ? "Validating…" : "Run dry-run validation"}
              </button>
            </FormActions>
          </form>
          {assistedImports.data?.length ? (
            <div className="settings-list">
              {assistedImports.data.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>
                      {item.file_name || item.source}{" "}
                      <Status state={item.status} />
                    </strong>
                    <p>
                      {formatWhen(item.created_at)} ·{" "}
                      {item.valid_rows}/{item.total_rows} ready ·{" "}
                      {item.quarantined_rows} quarantined
                      {item.currency && item.total_minor !== null
                        ? ` · ${money(item.total_minor, item.currency)} total`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void downloadReport(item)}
                  >
                    <Download size={16} />
                    <span className="button-label">Report</span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No dry runs yet">
              <p>Load a CSV or JSON staging file and run validation first.</p>
            </Empty>
          )}
        </>
      )}
    </>
  );

  if (!embedded)
    return (
      <>
        <Heading
          title="Booking integrations"
          description="Channels that send bookings into this workspace. A channel stays disabled until its endpoint and signature setup are verified."
        />
        {sections}
      </>
    );

  return (
    <section>
      <div className="settings-card-head">
        <Plug size={20} />
        <div>
          <h2>
            Booking integrations
            <InfoTip label="booking integrations">
              Each channel is isolated and starts disabled. Connecting one
              issues an inbound endpoint and a signing secret shown once; events
              arriving on it are held in the inbound queue until their product
              is mapped to a tour here.
            </InfoTip>
          </h2>
          <p>Channels that send bookings into this workspace.</p>
        </div>
      </div>
      {sections}
    </section>
  );
}
