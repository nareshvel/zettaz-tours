import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { countryName } from "../../../packages/shared/src/countries";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { id } from "../../../packages/shared/src/contracts";
import { DateTime } from "luxon";
import { loadTenantLogo, receiptPdf, textPdf } from "./pdf";

function currencyDigits(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

function moneyMinor(amountMinor: number, currency: string, locale = "en") {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(amountMinor / 10 ** digits);
}

function formatWhen(
  value: string | Date,
  timezone: string,
  locale: string,
  dateFormat?: string,
  timeFormat?: string,
) {
  const dt = DateTime.fromJSDate(new Date(value), { zone: "utc" }).setZone(
    timezone || "UTC",
  );
  if (!dt.isValid) return String(value);
  const hour12 = timeFormat !== "24h";
  const time = dt.toFormat(hour12 ? "h:mm a" : "HH:mm");
  const day = dt.day.toString().padStart(2, "0");
  const month = dt.month.toString().padStart(2, "0");
  const year = dt.year.toString();
  const date =
    dateFormat === "DD/MM/YYYY"
      ? `${day}/${month}/${year}`
      : dateFormat === "YYYY-MM-DD"
        ? `${year}-${month}-${day}`
        : `${month}/${day}/${year}`;
  return `${date} ${time}`;
}

function titleCaseStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const documentType = z.enum(["manifest", "pickup_list", "receipt", "waiver"]);
const object = z.record(z.string(), z.unknown());
const templateSchema = z
  .object({
    templateKey: z.string().uuid().optional(),
    documentType,
    name: z.string().trim().min(1).max(120),
    outputProfile: object.default({}),
    payload: object.default({}),
    isDefault: z.boolean().default(false),
  })
  .strict();
const jobSchema = z
  .object({
    documentType,
    sourceType: z.enum(["departure", "booking"]),
    sourceId: z.string().uuid(),
    templateId: z.string().uuid().optional(),
  })
  .strict();

@Injectable()
export class PrintService {
  constructor(private readonly db: Database) {}
  templates(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT id,template_key,version,document_type,name,output_profile,payload,status,is_default,created_at
             FROM print_templates WHERE tenant_id=$1 AND status='published'
             ORDER BY document_type,is_default DESC,created_at DESC,id`,
            [actor.tenantId],
          )
        ).rows,
    );
  }
  jobs(actor: Actor) {
    return this.db.transaction(
      actor,
      async (tx) =>
        (
          await tx.query(
            `SELECT id,document_type,source_type,source_id,template_id,route_id,destination_type,status,attempts,error_detail,requested_at,completed_at
             FROM print_jobs WHERE tenant_id=$1 ORDER BY requested_at DESC,id LIMIT 100`,
            [actor.tenantId],
          )
        ).rows,
    );
  }
  publishTemplate(actor: Actor, key: string, raw: unknown) {
    const input = parse(templateSchema, raw);
    return this.db.command(
      actor,
      "print_template.publish",
      key,
      input,
      async (tx) => {
        const templateKey = input.templateKey ?? randomUUID();
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${actor.tenantId}:print-template:${templateKey}`,
        ]);
        const { rows: prior } = await tx.query(
          `SELECT id,version,document_type,name,output_profile,payload,status,is_default
         FROM print_templates WHERE tenant_id=$1 AND template_key=$2
         ORDER BY version DESC LIMIT 1 FOR UPDATE`,
          [actor.tenantId, templateKey],
        );
        if (prior[0] && prior[0].document_type !== input.documentType)
          throw new BadRequestException(
            "A template cannot change document type",
          );
        const version = (prior[0]?.version ?? 0) + 1;
        if (input.isDefault)
          await tx.query(
            "UPDATE print_templates SET is_default=false WHERE tenant_id=$1 AND document_type=$2 AND status='published' AND is_default",
            [actor.tenantId, input.documentType],
          );
        const result = {
          id: randomUUID(),
          templateKey,
          version,
          documentType: input.documentType,
          name: input.name,
          outputProfile: input.outputProfile,
          payload: input.payload,
          status: "published",
          isDefault: input.isDefault,
        };
        await tx.query(
          `INSERT INTO print_templates(tenant_id,id,template_key,version,document_type,name,output_profile,payload,status,is_default,published_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            actor.tenantId,
            result.id,
            result.templateKey,
            result.version,
            result.documentType,
            result.name,
            JSON.stringify(result.outputProfile),
            JSON.stringify(result.payload),
            result.status,
            result.isDefault,
            actor.actorId,
          ],
        );
        await record(
          tx,
          actor,
          "print_template.published",
          result.id,
          prior[0] ?? null,
          result,
        );
        return result;
      },
    );
  }
  requestBrowserJob(actor: Actor, key: string, raw: unknown) {
    const input = parse(jobSchema, raw);
    return this.db.command(
      actor,
      "print_job.request",
      key,
      input,
      async (tx) => {
        const expectedSource = ["manifest", "pickup_list"].includes(
          input.documentType,
        )
          ? "departure"
          : "booking";
        if (input.sourceType !== expectedSource)
          throw new BadRequestException(
            `${input.documentType} documents require a ${expectedSource} source`,
          );
        const { rows: source } = await tx.query(
          input.sourceType === "departure"
            ? "SELECT id FROM departures WHERE tenant_id=$1 AND id=$2"
            : "SELECT id FROM bookings WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, input.sourceId],
        );
        if (!source[0])
          throw new BadRequestException("Document source is unavailable");
        const { rows: templates } = await tx.query(
          input.templateId
            ? "SELECT id FROM print_templates WHERE tenant_id=$1 AND id=$2 AND status='published'"
            : "SELECT id FROM print_templates WHERE tenant_id=$1 AND document_type=$2 AND status='published' AND is_default",
          input.templateId
            ? [actor.tenantId, input.templateId]
            : [actor.tenantId, input.documentType],
        );
        if (input.templateId && !templates[0])
          throw new BadRequestException("Published print template not found");
        const result = {
          id: randomUUID(),
          ...input,
          templateId: templates[0]?.id ?? null,
          destinationType: "browser",
          status: "requested",
          downloadUrl: "",
        };
        await tx.query(
          `INSERT INTO print_jobs(tenant_id,id,document_type,source_type,source_id,template_id,destination_type,status,requested_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            actor.tenantId,
            result.id,
            result.documentType,
            result.sourceType,
            result.sourceId,
            result.templateId,
            result.destinationType,
            result.status,
            actor.actorId,
          ],
        );
        await record(tx, actor, "print_job.requested", result.id, null, result);
        return {
          ...result,
          downloadUrl: `/ops/v1/print-jobs/${result.id}/pdf`,
        };
      },
    );
  }

  pdf(actor: Actor, jobId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: jobs } = await tx.query(
        `SELECT id,document_type,source_type,source_id FROM print_jobs
         WHERE tenant_id=$1 AND id=$2 AND document_type IN ('manifest','pickup_list','receipt')`,
        [actor.tenantId, jobId],
      );
      const job = jobs[0];
      if (!job) throw new NotFoundException("Printable job not found");
      const { rows: tenants } = await tx.query(
        "SELECT name,timezone,logo_path,config,business_profile FROM tenants WHERE id=$1",
        [actor.tenantId],
      );
      const tenant = tenants[0];
      if (job.document_type === "receipt") {
        const {
          rows: [booking],
        } = await tx.query(
          `SELECT b.id,b.lead_name,b.lead_email,b.source,b.state,b.pickup,b.purchaser,
            h.party,h.quote,d.starts_at,p.name AS product_name
           FROM bookings b
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
           WHERE b.tenant_id=$1 AND b.id=$2`,
          [actor.tenantId, job.source_id],
        );
        if (!booking)
          throw new NotFoundException("Document source is unavailable");
        const quote = booking.quote as {
          currency: string;
          totalMinor: number;
          subtotalMinor?: number;
          taxMinor?: number;
          discountMinor?: number;
          lines?: {
            category: string;
            quantity: number;
            amountMinor: number;
          }[];
        };
        const config = (tenant.config ?? {}) as {
          locale?: string;
          dateFormat?: string;
          timeFormat?: string;
        };
        const locale = config.locale || "en";
        const timezone = tenant.timezone || "UTC";
        const profile = (tenant.business_profile ?? {}) as {
          displayName?: string;
          streetAddress?: string;
          suite?: string;
          city?: string;
          stateParish?: string;
          postalCode?: string;
          country?: string;
          email?: string;
          phone?: string;
        };
        const tenantName =
          (profile.displayName || "").trim() || tenant.name || "Operator";
        const countryLabel = profile.country
          ? countryName(profile.country)
          : "";
        const locality = [
          profile.city,
          profile.stateParish,
          profile.postalCode,
          countryLabel,
        ]
          .filter(Boolean)
          .join(", ");
        const street = [profile.streetAddress, profile.suite]
          .filter(Boolean)
          .join(", ");
        const contactLines = [
          street,
          locality,
          [profile.phone, profile.email].filter(Boolean).join(" | "),
        ].filter((line): line is string => Boolean(line));
        const { rows: paidRows } = await tx.query(
          `SELECT COALESCE(SUM(p.amount_minor),0)::text AS paid FROM payments p
           WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled'
           AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)`,
          [actor.tenantId, booking.id],
        );
        const paidMinor = Number(paidRows[0]?.paid ?? 0);
        const { rows: creditRows } = await tx.query(
          `SELECT COALESCE(SUM(c.amount_minor),0)::text AS credit
           FROM partner_collection_claims c
           JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
           WHERE c.tenant_id=$1 AND c.booking_id=$2`,
          [actor.tenantId, booking.id],
        );
        const partnerCreditMinor = Number(creditRows[0]?.credit ?? 0);
        const balanceMinor = Math.max(
          0,
          quote.totalMinor - paidMinor - partnerCreditMinor,
        );
        const { rows: passengers } = await tx.query(
          `SELECT name,category,is_minor FROM booking_passengers
           WHERE tenant_id=$1 AND booking_id=$2 AND superseded_at IS NULL
           ORDER BY created_at,id`,
          [actor.tenantId, booking.id],
        );
        const { rows: payments } = await tx.query(
          `SELECT p.amount_minor::float8,p.currency,p.method,p.status,p.reference,p.occurred_at,
            bp.name AS passenger_name
           FROM payments p
           LEFT JOIN booking_passengers bp ON bp.tenant_id=p.tenant_id AND bp.id=p.passenger_id
           LEFT JOIN payment_adjustments a ON a.tenant_id=p.tenant_id AND a.payment_id=p.id
           WHERE p.tenant_id=$1 AND p.booking_id=$2 AND a.id IS NULL
           ORDER BY p.occurred_at,p.id`,
          [actor.tenantId, booking.id],
        );
        const {
          rows: [partner],
        } = await tx.query(
          `SELECT org.name AS partner_name,a.collection_mode,a.external_reference
           FROM booking_partner_attributions a
           JOIN partner_organizations org ON org.tenant_id=a.tenant_id AND org.id=a.partner_id
           WHERE a.tenant_id=$1 AND a.booking_id=$2`,
          [actor.tenantId, booking.id],
        );
        const party = Object.entries(booking.party as Record<string, number>)
          .filter(([, count]) => count > 0)
          .map(([category, count]) => `${count} ${category}`)
          .join(", ");
        const purchaser = (booking.purchaser ?? {}) as { phone?: string };
        const chargeLines = (quote.lines ?? []).map((line) => ({
          label: `${line.quantity} x ${line.category}`,
          amount: moneyMinor(line.amountMinor, quote.currency, locale),
        }));
        if (!chargeLines.length && quote.subtotalMinor != null) {
          chargeLines.push({
            label: "Subtotal",
            amount: moneyMinor(quote.subtotalMinor, quote.currency, locale),
          });
        }
        if ((quote.taxMinor ?? 0) > 0) {
          chargeLines.push({
            label: "Tax",
            amount: moneyMinor(quote.taxMinor!, quote.currency, locale),
          });
        }
        if ((quote.discountMinor ?? 0) > 0) {
          chargeLines.push({
            label: "Discount",
            amount: `-${moneyMinor(quote.discountMinor!, quote.currency, locale)}`,
          });
        }
        const totals = [
          {
            label: "Total",
            amount: moneyMinor(quote.totalMinor, quote.currency, locale),
            emphasize: true,
          },
          {
            label: "Paid",
            amount: moneyMinor(paidMinor, quote.currency, locale),
          },
          ...(partnerCreditMinor
            ? [
                {
                  label: "Partner credit",
                  amount: moneyMinor(
                    partnerCreditMinor,
                    quote.currency,
                    locale,
                  ),
                },
              ]
            : []),
          {
            label: "Balance due",
            amount: moneyMinor(balanceMinor, quote.currency, locale),
            emphasize: true,
          },
        ];
        const logo = await loadTenantLogo(tenant.logo_path);
        return {
          bytes: receiptPdf({
            tenantName,
            contactLines,
            logo,
            reservationRef: String(booking.id).slice(0, 8).toUpperCase(),
            status: titleCaseStatus(String(booking.state)),
            issuedAt: formatWhen(
              new Date().toISOString(),
              timezone,
              locale,
              config.dateFormat,
              config.timeFormat,
            ),
            productName: booking.product_name,
            departureAt: formatWhen(
              booking.starts_at,
              timezone,
              locale,
              config.dateFormat,
              config.timeFormat,
            ),
            leadName: booking.lead_name,
            leadEmail: booking.lead_email,
            leadPhone: purchaser.phone || undefined,
            source: String(booking.source).replace(/_/g, " "),
            party: party || "-",
            travellers: passengers.map(
              (row) =>
                `${row.name} (${row.category}${row.is_minor ? ", minor" : ""})`,
            ),
            partnerLine: partner
              ? `${partner.partner_name} | ${String(partner.collection_mode).replace(/_/g, " ")}${
                  partner.external_reference
                    ? ` | ${partner.external_reference}`
                    : ""
                }`
              : undefined,
            chargeLines,
            totals,
            payments: payments.map((row) => ({
              when: formatWhen(
                row.occurred_at,
                timezone,
                locale,
                config.dateFormat,
                config.timeFormat,
              ),
              amount: moneyMinor(
                Number(row.amount_minor),
                String(row.currency),
                locale,
              ),
              method: String(row.method),
              status: String(row.status),
              detail: [
                row.reference ? `Ref ${row.reference}` : "",
                row.passenger_name ? `Attributed to ${row.passenger_name}` : "",
              ]
                .filter(Boolean)
                .join(" | "),
            })),
            footerNote: `Official reservation receipt for ${tenantName}. Amounts reflect recorded payments and accepted partner credit. This document is generated on demand and is not retained as a permanent fiscal archive.`,
          }),
          filename: `receipt-${String(booking.id).slice(0, 8)}.pdf`,
        };
      }
      const { rows: departures } = await tx.query(
        `SELECT d.id,d.starts_at,p.name AS product_name FROM departures d
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.id=$2`,
        [actor.tenantId, job.source_id],
      );
      const departure = departures[0];
      if (!departure)
        throw new NotFoundException("Document source is unavailable");
      const heading = `${tenant.name} | ${departure.product_name} | ${new Date(departure.starts_at).toISOString()}`;
      let lines: string[];
      if (job.document_type === "manifest") {
        const { rows } = await tx.query(
          `SELECT b.id,b.lead_name,b.pickup,h.party,
           COALESCE((SELECT string_agg(p.name || ' (' || p.category || ')', ', ' ORDER BY p.created_at,p.id)
             FROM booking_passengers p WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.superseded_at IS NULL),'') AS passengers
           FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
           WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' ORDER BY b.lead_name,b.id`,
          [actor.tenantId, job.source_id],
        );
        lines = [
          heading,
          `Confirmed bookings: ${rows.length}`,
          "",
          ...rows.map((row, index) => {
            const party = Object.entries(row.party as Record<string, number>)
              .filter(([, count]) => count > 0)
              .map(([category, count]) => `${count} ${category}`)
              .join(", ");
            const pickup = (row.pickup as { kind?: string }).kind ?? "none";
            return `${index + 1}. ${row.lead_name} | ${party} | pickup: ${pickup} | ${row.passengers || "roster not recorded"} | ref ${String(row.id).slice(0, 8).toUpperCase()}`;
          }),
        ];
      } else {
        const { rows: plans } = await tx.query(
          "SELECT version,notes FROM departure_pickup_plans WHERE tenant_id=$1 AND departure_id=$2",
          [actor.tenantId, job.source_id],
        );
        const { rows: stops } = await tx.query(
          `SELECT s.sequence,s.pickup_at,s.notes,l.name AS location_name,b.lead_name,
           (SELECT SUM(value::int) FROM jsonb_each_text(h.party))::int AS party_size
           FROM pickup_stops s JOIN pickup_locations l ON l.tenant_id=s.tenant_id AND l.id=s.location_id
           JOIN bookings b ON b.tenant_id=s.tenant_id AND b.id=s.booking_id
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
           WHERE s.tenant_id=$1 AND s.departure_id=$2 ORDER BY s.sequence`,
          [actor.tenantId, job.source_id],
        );
        const { rows: exceptions } = await tx.query(
          `SELECT b.lead_name,b.pickup->>'kind' AS pickup_kind FROM bookings b
           WHERE b.tenant_id=$1 AND b.departure_id=$2 AND b.state='confirmed' AND
           (b.pickup->>'kind'='unresolved' OR (b.pickup->>'kind'='selected' AND NOT EXISTS
             (SELECT 1 FROM pickup_stops s WHERE s.tenant_id=b.tenant_id AND s.departure_id=b.departure_id AND s.booking_id=b.id)))
           ORDER BY b.lead_name,b.id`,
          [actor.tenantId, job.source_id],
        );
        lines = [
          heading,
          `Plan version: ${plans[0]?.version ?? "not saved"}`,
          ...(plans[0]?.notes ? [`Dispatcher note: ${plans[0].notes}`] : []),
          "",
          ...stops.map(
            (stop) =>
              `${stop.sequence}. ${new Date(stop.pickup_at).toISOString()} | ${stop.location_name} | ${stop.lead_name} | ${stop.party_size} guests${stop.notes ? ` | ${stop.notes}` : ""}`,
          ),
          "",
          `Exceptions: ${exceptions.length}`,
          ...exceptions.map(
            (item) =>
              `${item.lead_name} | ${item.pickup_kind === "unresolved" ? "pickup unresolved" : "not in saved plan"}`,
          ),
        ];
      }
      return {
        bytes: textPdf(
          job.document_type === "manifest"
            ? "Departure manifest"
            : "Pickup list",
          lines,
        ),
        filename: `${job.document_type.replace("_", "-")}-${String(job.source_id).slice(0, 8)}.pdf`,
      };
    });
  }
}

@Controller("ops/v1")
export class PrintController {
  constructor(private readonly service: PrintService) {}
  @Get("print-templates") @Access("print.jobs.read") templates(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.templates(actor);
  }
  @Post("print-templates") @Access("print.templates.manage") publish(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.publishTemplate(actor, parse(keySchema, key), body);
  }
  @Get("print-jobs") @Access("print.jobs.read") jobs(
    @CurrentActor() actor: Actor,
  ) {
    return this.service.jobs(actor);
  }
  @Post("print-jobs") @Access("print.jobs.create") create(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.requestBrowserJob(actor, parse(keySchema, key), body);
  }
  @Get("print-jobs/:id/pdf") @Access("print.jobs.read") async pdf(
    @CurrentActor() actor: Actor,
    @Param("id") value: string,
    @Res() response: Response,
  ) {
    const result = await this.service.pdf(actor, parse(id, value));
    response
      .status(200)
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      })
      .send(result.bytes);
  }
}
