# ADR 018 — Print delivery: server-rendered PDF + shared Zettaz print agent

**Date:** 15 September 2026 · **Status:** accepted · **Supersedes** the "browser print only" position in [tax-and-printing.md](../FEATURES/tenant-settings/tax-and-printing.md).

## Context

Tours needed receipt-format **and** A4/Letter printing from any device — desk browser, tablet, phone — before a tenant is onboarded. Two prior positions were in the way: printable documents were browser-print only, and the Printers & documents settings tab published inert "templates" that no renderer consumed.

Zettaz Cloud already ships a Go print agent (`app-zettaz-cloud/print-agent`): a loopback HTTP server on `127.0.0.1:9419`, paired to a browser with a six-digit code, that submits jobs to the machine's own OS print queues. The owner asked for one method across products.

## Decision

1. **Reuse the Cloud agent verbatim.** `apps/web/lib/print-agent.ts` speaks Cloud's job contract exactly — `{id, clientId, destination:"system", printerId, contentType:"pdf", payloadBase64, copies, mediaSize}` — differing only in `clientId` (`zettaz-tours`). The contract must not be "improved" on one side: the agent is shared, and a divergence fails silently for whichever product changed.
2. **Keep Tours' server-side vector renderer.** Cloud rasterises with `html2canvas → jsPDF`; Tours renders PDF syntax directly in `apps/api/src/pdf.ts`. Adopting Cloud's approach would turn a 40-row manifest into an unsearchable bitmap. Tours keeps vector text; Cloud's *contract* is what is shared, not its renderer.
3. **Paper is a profile, not a constant.** `PAPER` in `pdf.ts` defines `a4`, `letter`, `58mm` and `80mm` (width, height, margins, type sizes). A roll has `height: null` and emits one page sized to its measured content. **Letter is real geometry** (215.9 × 279.4 mm), not Cloud's scale-to-fit approximation, because Tours' layout is computed rather than design-bound.
4. **Thermal output is a narrow-roll PDF, not ESC/POS.** The agent drives thermal printers as ordinary CUPS queues and accepts `contentType: "pdf"`, so no ESC/POS encoder is needed. Logos are skipped on rolls (monochrome, low DPI).
5. **Wrapping is measured, never counted.** Character-count wrapping overflowed 58 mm by 27% and 80 mm by 40%; A4's slack hid it. `wrapToWidth()` uses `helveticaWidth()` and hard-breaks tokens longer than a line.
6. **`mediaSize` travels with the job** (`print_jobs.media_size`, migration 079) and is sent to the agent. CUPS prints at actual size anchored to the queue's media box and **silently clips** a mismatch; the agent's `fit-to-page` is the safety net, not the plan.
7. **Routing is per document type, per browser.** A counter usually has both a roll and a sheet printer. The agent reports the same hardcoded capability list for every queue, so Tours cannot detect which is which: the queue name seeds a guess (`guessPrinterKind`), staff confirm it by assignment, and the agent's own test strip identifies the hardware. Assignments live in `localStorage` — the dock tablet and the desk PC must not share one setting.
8. **Every print is recorded.** `printDocument()` creates the `print_jobs` row first and unconditionally; `pdf()` advances the job to `rendered`; `POST /ops/v1/print-jobs/{id}/outcome` records `delivered`/`failed` with `destination_type` (`agent` | `browser`).
9. **Templates are deferred.** Prebuilt layouts only. Template ownership, versioning and design remain a later phase.

## Consequences

- A phone or tablet has no agent to pair with — loopback is not reachable across devices — and falls back to the browser print sheet (AirPrint / Mopria) with the identical PDF. This is a fallback, not a gap.
- "Print to the front-desk printer from the guide's tablet" needs the agent to **pull** jobs from the server. Fleet mode today is heartbeat/configuration only. `print_jobs.route_id` and the dormant `printer_routes` table are where that would land. Track B.
- Migration **080** grants `print.jobs.create` / `print.jobs.read` to the `reservations` and `finance` system roles. They had `bookings.write` / `payment.write` but no print permission, so the two roles that hand a guest a receipt were the two that could not record one — and the web app silently called `window.print()` instead, leaving no audit row. Granting adds no data exposure; it makes the act visible.
