"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Link2Off, Printer, RefreshCw } from "lucide-react";
import type { Session } from "@/lib/types";
import {
  agentStatus,
  documentMedia,
  documentPrinter,
  guessPrinterKind,
  pairAgent,
  printerLabel,
  rememberDocumentMedia,
  rememberDocumentPrinter,
  testPrinter,
  unpairAgent,
  type AgentMediaSize,
  type AgentPrinter,
  type AgentStatus,
  type PrintDocumentType,
} from "@/lib/print-agent";
import { Empty, Field, InfoTip, Loading, Notice, Status } from "./common";

const MEDIA_OPTIONS: { value: AgentMediaSize; text: string }[] = [
  { value: "a4", text: "A4 (210 × 297 mm)" },
  { value: "letter", text: "Letter (8.5 × 11 in)" },
  { value: "80mm", text: "80 mm receipt roll" },
  { value: "58mm", text: "58 mm receipt roll" },
];

const DOCUMENTS: { type: PrintDocumentType; title: string; note: string }[] = [
  {
    type: "manifest",
    title: "Departure manifest",
    note: "Passenger list for the dock. Usually a sheet.",
  },
  {
    type: "pickup_list",
    title: "Pickup list",
    note: "Driver handoff with ordered stops.",
  },
  {
    type: "receipt",
    title: "Guest receipt",
    note: "Handed over at the desk. A roll if one is connected.",
  },
];

/**
 * Printers & documents.
 *
 * Two different things live here and the split matters: the agent pairing and
 * the paper choices belong to THIS browser on THIS device — a tablet at the
 * dock and the desk PC print to different hardware and should not fight over
 * one shared setting — while the job history is tenant-wide and comes from the
 * API. Nothing on this page is part of the tenant config form, so it has no
 * Save button; each control takes effect as it is changed.
 */
export function PrintersSettings({ session }: { session: Session }) {
  const canPrint = session.permissions.includes("print.jobs.create");

  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [printers, setPrinters] = useState<Record<string, string>>({});
  const [tested, setTested] = useState("");
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  const [media, setMedia] = useState<Record<string, AgentMediaSize>>({});

  const ready = status?.state === "ready";

  const refresh = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const next = await agentStatus();
      setStatus(next);
      if (next.state !== "ready") {
        setPrinters({});
        return next;
      }
      // A remembered printer the agent no longer lists (unplugged, or a queue
      // removed) must not stay assigned, or every print would fail at
      // submission with nothing on this page hinting why. Where there is no
      // usable assignment, each document type falls to the printer whose name
      // looks like the right kind of hardware for it.
      const rolls = next.printers.filter(
        (item) => guessPrinterKind(item) === "roll",
      );
      const sheets = next.printers.filter(
        (item) => guessPrinterKind(item) === "sheet",
      );
      const resolved: Record<string, string> = {};
      for (const document of DOCUMENTS) {
        const remembered = documentPrinter(document.type);
        const known = next.printers.some((item) => item.id === remembered);
        const preferred =
          document.type === "receipt"
            ? (rolls[0] ?? sheets[0])
            : (sheets[0] ?? rolls[0]);
        const chosen = known ? remembered : (preferred?.id ?? "");
        if (chosen !== remembered)
          rememberDocumentPrinter(document.type, chosen);
        resolved[document.type] = chosen;
      }
      setPrinters(resolved);
      return next;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh().then((next) => {
      const rollFor = (type: PrintDocumentType) => {
        if (next.state !== "ready") return false;
        const assigned = next.printers.find(
          (item) => item.id === documentPrinter(type),
        );
        return Boolean(assigned && guessPrinterKind(assigned) === "roll");
      };
      setMedia({
        manifest: documentMedia("manifest", rollFor("manifest")),
        pickup_list: documentMedia("pickup_list", rollFor("pickup_list")),
        receipt: documentMedia("receipt", rollFor("receipt")),
      });
    });
  }, [refresh]);

  async function pair() {
    setPairing(true);
    setError("");
    try {
      await pairAgent(code);
      setCode("");
      await refresh();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setPairing(false);
    }
  }

  async function unpair() {
    await unpairAgent();
    await refresh();
  }

  function chooseMedia(type: PrintDocumentType, value: AgentMediaSize) {
    rememberDocumentMedia(type, value);
    setMedia((current) => ({ ...current, [type]: value }));
  }

  function choosePrinter(type: PrintDocumentType, value: string) {
    rememberDocumentPrinter(type, value);
    setPrinters((current) => ({ ...current, [type]: value }));
  }

  async function test(printerId: string) {
    setError("");
    setTested("");
    try {
      await testPrinter(printerId);
      setTested(printerId);
    } catch (issue) {
      setError((issue as Error).message);
    }
  }

  return (
    <section>
      <div className="settings-card-head">
        <Printer size={20} />
        <div>
          <h2>
            Printers &amp; documents
            <InfoTip label="printers and documents">
              Pair this device with the print agent to send documents straight
              to a printer. Without it — on a phone or tablet, for instance —
              documents still open for browser printing, AirPrint or download.
              Every job is recorded either way.
            </InfoTip>
          </h2>
          <p>Where this device sends each document it prints.</p>
        </div>
        <button
          type="button"
          className="button secondary catalog-add-btn settings-head-action"
          onClick={() => void refresh()}
          disabled={checking}
          aria-label="Check for the print agent"
        >
          <RefreshCw size={17} />
          <span className="button-label">
            {checking ? "Checking…" : "Check again"}
          </span>
        </button>
      </div>

      {error && <Notice error>{error}</Notice>}
      {!canPrint && (
        <Notice>
          Your role cannot record a print job, so the print buttons on
          departures, pickup lists and reservations are hidden. An owner or
          admin can grant the print permission on the Members tab.
        </Notice>
      )}

      <h2>
        This device
        <InfoTip label="this device">
          Pairing is per browser, so the tablet at the dock and the desk
          computer each keep their own printers. The agent only accepts jobs
          from the machine it runs on, which is why a phone has no agent to pair
          with and falls back to browser printing.
        </InfoTip>
      </h2>
      {!status ? (
        <Loading />
      ) : status.state === "unavailable" ? (
        <Empty title="No print agent on this device">
          <p>
            The Zettaz print agent is not running here. Documents will open in
            the browser to print or save — which is all a phone or tablet needs.
            Install the agent on the machine that holds the counter printer.
          </p>
        </Empty>
      ) : status.state === "unpaired" ? (
        <div className="settings-list">
          <article>
            <div>
              <strong>Print agent found — not paired</strong>
              <p>
                Enter the six-digit code shown in the print agent window to let
                this browser send jobs to it.
              </p>
            </div>
          </article>
          <div className="form-grid">
            <Field label="Pairing code" required>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                placeholder="123456"
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </Field>
            <Field label="&nbsp;">
              <button
                type="button"
                className="button"
                disabled={pairing || code.length !== 6}
                onClick={() => void pair()}
              >
                {pairing ? "Pairing…" : "Pair this device"}
                <Check size={17} />
              </button>
            </Field>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-list">
            <article>
              <div>
                <strong>
                  Print agent paired <Status state="confirmed" />
                </strong>
                <p>
                  {status.printers.length
                    ? `${status.printers.length} printer${status.printers.length === 1 ? "" : "s"} available on this machine.`
                    : "Paired, but the agent reports no printers. Check the machine's print queues."}
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => void unpair()}
                aria-label="Unpair this device"
              >
                <Link2Off size={16} />
                <span className="button-label">Unpair</span>
              </button>
            </article>
          </div>
          {status.printers.length > 0 && (
            <div className="settings-list">
              {status.printers.map((item: AgentPrinter) => (
                <article key={item.id}>
                  <div>
                    <strong>
                      {printerLabel(item)}{" "}
                      <span className="status inactive">
                        {guessPrinterKind(item) === "roll"
                          ? "Receipt roll"
                          : "Sheet printer"}
                      </span>
                    </strong>
                    <p>
                      {tested === item.id
                        ? "Test sent — check which printer produced it."
                        : item.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void test(item.id)}
                    aria-label={`Test ${printerLabel(item)}`}
                  >
                    <Printer size={16} />
                    <span className="button-label">Test</span>
                  </button>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      <div className="form-divider" />

      <h2>
        Document routing
        <InfoTip label="document routing">
          A counter usually has two printers, and sending a manifest to the
          receipt roll is the mistake that actually happens — so each document
          type gets its own printer and paper here, remembered on this device.
          The page is built at the size chosen, so the document and the paper
          loaded agree; a mismatch is what clips edges. The roll and sheet
          labels above are read from the queue name, so correct one here if a
          printer is mislabelled.
        </InfoTip>
      </h2>
      <div className="print-routing">
        {DOCUMENTS.map((document) => (
          <div className="print-routing-row" key={document.type}>
            <div className="print-routing-doc">
              <strong>{document.title}</strong>
              <p>{document.note}</p>
            </div>
            <div className="form-grid">
              <Field label="Printer">
                <select
                  value={printers[document.type] ?? ""}
                  disabled={!ready}
                  onChange={(event) =>
                    choosePrinter(document.type, event.target.value)
                  }
                >
                  <option value="">
                    {ready ? "Browser print / download" : "No agent — browser"}
                  </option>
                  {ready &&
                    status.printers.map((item: AgentPrinter) => (
                      <option key={item.id} value={item.id}>
                        {printerLabel(item)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Paper">
                <select
                  value={media[document.type] ?? "a4"}
                  onChange={(event) =>
                    chooseMedia(
                      document.type,
                      event.target.value as AgentMediaSize,
                    )
                  }
                >
                  {MEDIA_OPTIONS.filter(
                    (option) =>
                      // Roll sizes only where a printer is assigned to take
                      // them; a browser print dialog cannot use one.
                      Boolean(printers[document.type]) ||
                      (option.value !== "58mm" && option.value !== "80mm"),
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.text}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
