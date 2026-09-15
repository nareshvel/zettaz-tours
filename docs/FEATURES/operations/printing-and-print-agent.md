# Printing: documents, paper and the print agent

Supersedes the "Printable documents" section of [tax-and-printing.md](../tenant-settings/tax-and-printing.md). Architecture rationale: [ADR 018](../../DECISIONS/018-print-delivery-and-agent.md).

## Documents

Three prebuilt layouts, rendered server-side as vector PDF by `apps/api/src/pdf.ts`:

| Document | Source | Default paper |
| --- | --- | --- |
| Departure manifest | confirmed parties for a departure | A4 |
| Pickup list | saved pickup-plan version, ordered stops, exceptions | A4 |
| Guest receipt | booking, party, money | 80 mm roll when one is assigned, else A4 |

Tenant-designed templates are **not** in scope for this phase.

## Paper

`PAPER` profiles: `a4` (210 × 297 mm), `letter` (215.9 × 279.4 mm), `80mm`, `58mm`. Sheets paginate; rolls emit a single page measured to their content. Text wraps by measured Helvetica width, so a narrow roll never overflows.

The page is built at the size chosen, so the document and the paper loaded agree. A mismatch is what clips edges — CUPS anchors to the queue's media box and drops the overflow rather than scaling.

## Delivery

`printDocument()` (`apps/web/lib/print-agent.ts`) is the single path for every print, from any device:

1. Ask the agent for status — the answer decides the paper the PDF is built for.
2. Create the `print_jobs` row. **Always**, before rendering, whatever the delivery path.
3. Fetch the rendered PDF.
4. Paired agent and an assigned printer → submit to the queue. Otherwise open the same bytes for the browser to print or save.
5. Report the outcome back (`delivered` / `failed`, and which path).

A job's lifecycle is therefore `requested → rendered → delivered | failed`, with `attempts`, `error_detail` and `completed_at` populated. The job id is also the agent's idempotency key, so retrying never prints twice.

## The agent

The shared Zettaz Go agent, unchanged. Loopback on `127.0.0.1:9419`; pairing is per browser with a six-digit code shown in the agent window; jobs carry `clientId: "zettaz-tours"`.

**Settings → Printers & documents** covers pairing, the printer inventory with a test strip per queue, and the per-document printer + paper assignment. Everything there is per device, because the tablet at the dock and the desk PC print to different hardware.

**Receipt vs sheet printer:** the agent reports an identical hardcoded capability list for every queue and names queues as CUPS does (`_192_168_1_100` for a network printer). Tours therefore *guesses* from the queue name, labels the guess, lets staff override it by assignment, and offers the agent's test strip as the definitive answer.

## Devices without an agent

Phones and tablets cannot reach another machine's loopback. They receive the identical PDF through the browser print sheet — AirPrint on iOS, Mopria on Android — or save it. The audit record is the same. `apps/mobile` would use `expo-print` against the same endpoint.

## Not in scope

Tenant-designed templates; ESC/POS; server-pushed jobs to a remote agent (needs agent-side polling — see ADR 018); retained PDF records; printer routing shared across a tenant (`printer_routes` stays dormant).
