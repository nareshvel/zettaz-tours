/**
 * Client for the Zettaz Print Agent.
 *
 * The agent is the same binary used by Zettaz Cloud — a loopback HTTP server on
 * 127.0.0.1:9419 that the browser talks to directly, not a cloud queue. Sharing
 * it means one install, one pairing flow and one set of signed installers per
 * venue regardless of which Zettaz product is open.
 *
 * The job contract below is Cloud's verbatim; only `clientId` differs. Do not
 * "improve" the field names here — the agent is shared, and a divergence would
 * silently fail for whichever product changed.
 *
 * Two things the agent handles that we rely on:
 *   - It passes CUPS `fit-to-page`, so a page that does not exactly match the
 *     queue's media is scaled instead of silently clipped. We still render at
 *     the declared mediaSize so that net never has to catch anything.
 *   - Thermal printers exposed as ordinary OS queues accept a PDF, which is why
 *     receipts go out as narrow-roll PDFs and we need no ESC/POS encoder.
 */

const AGENT_ORIGIN = "http://127.0.0.1:9419";
const CLIENT_ID = "zettaz-tours";
const TOKEN_KEY = "zettaz.print-agent.token";
const PRINTER_KEY = "zettaz.print-agent.printer";
const MEDIA_KEY = "zettaz.print-agent.media";

export type AgentPrinter = {
  id: string;
  name: string;
  contentTypes?: string[];
  mediaSizes?: string[];
};

export type AgentMediaSize = "a4" | "letter" | "58mm" | "80mm";

export type AgentStatus =
  | { state: "unavailable" }
  | { state: "unpaired" }
  | { state: "ready"; printers: AgentPrinter[] };

/** Paired token lives per browser, like Cloud's. Storage can throw when the
 *  browser blocks site data, so every access is defensive. */
function readStored(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — the session simply stays unpaired */
  }
}

export function agentToken() {
  return readStored(TOKEN_KEY);
}

export type PrintDocumentType = "manifest" | "pickup_list" | "receipt";

export const PRINT_DOCUMENTS: PrintDocumentType[] = [
  "manifest",
  "pickup_list",
  "receipt",
];

/**
 * Which printer handles which document, per document type.
 *
 * A single "default printer" is the wrong shape for this counter: a desk that
 * hands over receipts usually has BOTH a receipt roll and a sheet printer, and
 * sending a manifest to the roll (or a receipt to the A4 tray) is the mistake
 * that actually happens. So the assignment is per document type rather than
 * per device, and paper follows the same key.
 *
 * All of it is per browser: the tablet at the dock and the desk PC print to
 * different hardware and must not share one setting.
 */
export function documentPrinter(documentType: PrintDocumentType) {
  return (
    readStored(`${PRINTER_KEY}.${documentType}`) ||
    // Falls back to the pre-assignment single choice so a browser that paired
    // before this existed keeps printing to the printer it was already using.
    readStored(PRINTER_KEY)
  );
}

export function rememberDocumentPrinter(
  documentType: PrintDocumentType,
  printerId: string,
) {
  writeStored(`${PRINTER_KEY}.${documentType}`, printerId);
}

/** True when at least one document type has somewhere to print. */
export function hasPrinterAssignment() {
  return PRINT_DOCUMENTS.some((type) => Boolean(documentPrinter(type)));
}

export function forgetAgent() {
  writeStored(TOKEN_KEY, "");
  writeStored(PRINTER_KEY, "");
  for (const type of PRINT_DOCUMENTS) {
    writeStored(`${PRINTER_KEY}.${type}`, "");
    writeStored(`${MEDIA_KEY}.${type}`, "");
  }
}

/**
 * A guess at whether a queue is a receipt roll or a sheet printer.
 *
 * The agent cannot tell us: it reports the same hardcoded capability list
 * (80mm, 58mm, A4, Letter) for every queue on the machine, because it builds
 * that list from a constant rather than querying the driver. So the only signal
 * available here is the queue name, which on a thermal printer almost always
 * carries the model family. This is used ONLY to pre-select a sensible default
 * — the staff member's own assignment always wins, and a wrong guess costs one
 * dropdown change rather than a wasted roll.
 */
export function guessPrinterKind(printer: AgentPrinter): "roll" | "sheet" {
  const text = `${printer.id} ${printer.name ?? ""}`.toLowerCase();
  const rollHints = [
    "receipt",
    "thermal",
    "80mm",
    "58mm",
    "pos-",
    "posx",
    "tm-t",
    "tm-m",
    "tm-u",
    "srp-",
    "tsp1",
    "tsp6",
    "tsp7",
    "tsp8",
    "mc-print",
    "star ",
    "bixolon",
    "rongta",
    "xprinter",
    "munbyn",
    "epson tm",
  ];
  return rollHints.some((hint) => text.includes(hint)) ? "roll" : "sheet";
}

/**
 * Queue names come straight from CUPS, which turns a network printer into
 * something like `_192_168_1_100`. Showing that verbatim asks staff to
 * recognise their printer by its mangled IP.
 */
export function printerLabel(printer: AgentPrinter) {
  const raw = (printer.name || printer.id || "").trim();
  const asIp = raw.replace(/^_/, "").replace(/_/g, ".");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(asIp)) return `Network printer ${asIp}`;
  return raw.replace(/[_]+/g, " ").trim() || printer.id;
}

/** Short timeout: the agent is on loopback, so it answers immediately or not
 *  at all. Waiting longer only stalls the print button. */
async function agentFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = 4000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${AGENT_ORIGIN}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(): Record<string, string> {
  const token = agentToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Health is deliberately unauthenticated on the agent, so this distinguishes
 * "no agent installed" from "installed but not paired with this browser".
 */
export async function agentStatus(): Promise<AgentStatus> {
  try {
    const health = await agentFetch("/v1/health", { method: "GET" }, 1500);
    if (!health.ok) return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
  if (!agentToken()) return { state: "unpaired" };
  try {
    const res = await agentFetch("/v1/printers", {
      method: "GET",
      headers: authHeaders(),
    });
    if (res.status === 401 || res.status === 403) return { state: "unpaired" };
    if (!res.ok) return { state: "unpaired" };
    const body = (await res.json()) as
      { printers?: AgentPrinter[] } | AgentPrinter[];
    const printers = Array.isArray(body) ? body : (body.printers ?? []);
    return { state: "ready", printers };
  } catch {
    return { state: "unavailable" };
  }
}

/** Exchanges the six-digit code shown in the agent's window for a token. */
export async function pairAgent(pairingCode: string) {
  const res = await agentFetch("/v1/pair", {
    method: "POST",
    body: JSON.stringify({
      pairingCode: pairingCode.trim(),
      clientId: CLIENT_ID,
      origin: window.location.origin,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { message?: string } | null)?.message ??
        "Pairing failed. Check the code shown in the print agent window.",
    );
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("The agent did not return a pairing token.");
  writeStored(TOKEN_KEY, body.token);
  return body.token;
}

export async function unpairAgent() {
  try {
    await agentFetch("/v1/pair", { method: "DELETE", headers: authHeaders() });
  } catch {
    /* clearing locally is what matters */
  }
  forgetAgent();
}

/**
 * Submits a rendered PDF. `id` doubles as the agent's idempotency key, so we
 * pass our own print-job id: a retry of the same job never prints twice.
 */
export async function submitToAgent(input: {
  jobId: string;
  pdf: Blob;
  mediaSize: AgentMediaSize;
  printerId?: string;
  copies?: number;
}) {
  const printerId = input.printerId;
  if (!printerId) throw new Error("No printer selected for this browser.");
  const payloadBase64 = await blobToBase64(input.pdf);
  const res = await agentFetch(
    "/v1/jobs",
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        id: input.jobId,
        clientId: CLIENT_ID,
        destination: "system",
        printerId,
        contentType: "pdf",
        payloadBase64,
        copies: input.copies ?? 1,
        mediaSize: input.mediaSize,
      }),
    },
    15000,
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { message?: string } | null)?.message ??
        `The print agent rejected the job (${res.status}).`,
    );
  }
  return (await res.json().catch(() => ({}))) as {
    id?: string;
    state?: string;
  };
}

/**
 * Prints the agent's built-in test strip on one queue.
 *
 * The fastest way to answer "which of these is the receipt printer?" is to make
 * one of them move. The agent sends a short raw text line, which a thermal
 * printer prints immediately; a sheet printer may eject a page or reject the
 * job outright, and either answer still identifies the hardware.
 */
export async function testPrinter(printerId: string) {
  const res = await agentFetch(
    `/v1/printers/${encodeURIComponent(printerId)}/test`,
    { method: "POST", headers: authHeaders() },
    15000,
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { message?: string } | null)?.message ??
        `The printer did not accept the test (${res.status}).`,
    );
  }
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the document."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // strip the `data:...;base64,` prefix the agent does not want
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

// ─── Paper defaults ──────────────────────────────────────────────────────────

/**
 * Paper for a document type, remembered per browser.
 *
 * The fallbacks are deliberate rather than server-side: a receipt belongs on a
 * roll only when there is actually a roll printer to send it to. With no agent
 * paired the document is going to a browser print dialog or a download, where
 * an 80mm page would be useless, so it falls back to a sheet.
 */
export function documentMedia(
  documentType: PrintDocumentType,
  rollAvailable: boolean,
): AgentMediaSize {
  const stored = readStored(`${MEDIA_KEY}.${documentType}`) as AgentMediaSize;
  if (stored === "a4" || stored === "letter") return stored;
  // A roll size is only honoured while a roll is actually reachable. Without
  // one the document is heading for a browser print dialog or a download,
  // where an 80mm page is useless, so it falls back to a sheet.
  if (stored === "58mm" || stored === "80mm")
    return rollAvailable ? stored : "a4";
  return documentType === "receipt" && rollAvailable ? "80mm" : "a4";
}

export function rememberDocumentMedia(
  documentType: PrintDocumentType,
  media: AgentMediaSize,
) {
  writeStored(`${MEDIA_KEY}.${documentType}`, media);
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export type PrintRequest = {
  documentType: PrintDocumentType;
  sourceType: "departure" | "booking";
  sourceId: string;
  /** Overrides the remembered paper for this one print. */
  mediaSize?: AgentMediaSize;
  /** Filename used when the document is saved rather than printed. */
  fallbackName: string;
};

export type PrintOutcome = {
  via: "agent" | "browser";
  jobId: string;
  printerId?: string;
  mediaSize: AgentMediaSize;
};

/**
 * One path for every print, from any device.
 *
 * The job row is created FIRST and unconditionally. Each call site previously
 * skipped the record when the user lacked `print.jobs.create` and simply called
 * window.print(), so the audit trail was silently missing exactly the staff it
 * most needed to cover. Printing without a record is no longer possible here.
 *
 * Delivery is then decided by what the device can actually reach: a paired
 * agent prints the PDF directly, and otherwise the identical bytes are handed
 * to the browser — so a tablet with no local printer still gets the document.
 */
export async function printDocument(
  request: PrintRequest,
  run: <T>(
    path: string,
    body: unknown,
    method?: string,
  ) => Promise<T | undefined>,
  fetchFile: (
    path: string,
    fallbackName: string,
  ) => Promise<{ blob: Blob; filename: string }>,
): Promise<PrintOutcome> {
  // Asked before rendering: the answer decides the paper the PDF is built for.
  const status = await agentStatus();
  const printerId =
    status.state === "ready" ? documentPrinter(request.documentType) : "";
  const viaAgent = Boolean(printerId);
  // The paper follows the printer this document type is actually assigned to,
  // not merely whether an agent exists: a receipt only belongs on a roll if the
  // receipt printer is the one receiving it.
  const assigned =
    status.state === "ready"
      ? status.printers.find((item) => item.id === printerId)
      : undefined;
  const rollAvailable = Boolean(
    assigned && guessPrinterKind(assigned) === "roll",
  );
  const mediaSize =
    request.mediaSize ?? documentMedia(request.documentType, rollAvailable);

  const job = await run<{ id: string }>("ops/v1/print-jobs", {
    documentType: request.documentType,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    mediaSize,
  });
  if (!job?.id) throw new Error("The document could not be requested.");

  const { blob } = await fetchFile(
    `ops/v1/print-jobs/${job.id}/pdf`,
    request.fallbackName,
  );

  // Whatever happens next, say so: a job left at 'requested' records that a
  // document was asked for but not whether it ever reached paper.
  const report = (
    status: "delivered" | "failed",
    deliveredBy: "agent" | "browser",
    detail?: string,
  ) =>
    run(`ops/v1/print-jobs/${job.id}/outcome`, {
      status,
      deliveredBy,
      ...(detail ? { detail: detail.slice(0, 500) } : {}),
    }).catch(() => {
      /* the document is already printed; a failed report must not undo that */
    });

  if (viaAgent) {
    try {
      await submitToAgent({ jobId: job.id, pdf: blob, mediaSize, printerId });
    } catch (error) {
      await report("failed", "agent", (error as Error).message);
      throw error;
    }
    await report("delivered", "agent");
    return { via: "agent", jobId: job.id, printerId, mediaSize };
  }

  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  if (!opened) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = request.fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  await report("delivered", "browser");
  return { via: "browser", jobId: job.id, mediaSize };
}
