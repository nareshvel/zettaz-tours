import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import {
  Actor,
  ProductInput,
  availabilityRuleUpdateSchema,
  id,
  productSchema,
  productUpdateSchema,
  scheduleSchema,
} from "../../../packages/shared/src/contracts";
import { Database, record, Tx } from "./database";
import { LimitsService } from "./limits";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { tenant } from "./tenant";

const productSelect = `
SELECT p.id,p.name,p.definition,p.version,p.internal_name,p.customer_title,
       p.description,p.product_kind,p.availability_mode,p.status,
       count(DISTINCT o.id)::int option_count,
       min(r.amount_minor) FILTER (WHERE r.amount_minor > 0)::bigint price_from_minor,
       min(d.starts_at) FILTER (WHERE d.starts_at >= clock_timestamp() AND d.status='scheduled') next_departure_at,
       count(DISTINCT a.id) FILTER (WHERE a.status='active')::int availability_rule_count
FROM products p
LEFT JOIN product_options o ON o.tenant_id=p.tenant_id AND o.product_id=p.id AND o.active
LEFT JOIN rate_plans r ON r.tenant_id=o.tenant_id AND r.option_id=o.id AND r.active
LEFT JOIN availability_rules a ON a.tenant_id=o.tenant_id AND a.option_id=o.id
LEFT JOIN departures d ON d.tenant_id=o.tenant_id AND d.option_id=o.id`;

const ruleSelect = `
SELECT ar.id,ar.version,ar.mode,ar.status,to_char(ar.start_date,'YYYY-MM-DD') start_date,
       to_char(ar.end_date,'YYYY-MM-DD') end_date,ar.weekdays,ar.capacity,
       ar.timezone,ar.minimum_notice_minutes,ar.cutoff_minutes,p.id product_id,
       p.name product_name,p.availability_mode product_availability_mode,
       o.customer_title option_name,
       COALESCE((SELECT array_agg(to_char(t.local_time,'HH24:MI') ORDER BY t.sort_order)
         FROM availability_rule_times t WHERE t.tenant_id=ar.tenant_id AND t.rule_id=ar.id),'{}') times,
       COALESCE((SELECT array_agg(to_char(e.local_date,'YYYY-MM-DD') ORDER BY e.local_date)
         FROM availability_exceptions e WHERE e.tenant_id=ar.tenant_id AND e.rule_id=ar.id AND e.kind='closed'),'{}') blackouts,
       (SELECT count(*)::int FROM departures d WHERE d.tenant_id=ar.tenant_id
         AND d.availability_rule_id=ar.id AND d.starts_at >= clock_timestamp()) upcoming_departures
FROM availability_rules ar
JOIN product_options o ON o.tenant_id=ar.tenant_id AND o.id=ar.option_id
JOIN products p ON p.tenant_id=o.tenant_id AND p.id=o.product_id`;

export function validDay(value: string) {
  const d = DateTime.fromISO(value, { zone: "UTC" });
  if (!d.isValid || d.toISODate() !== value)
    throw new BadRequestException("Invalid calendar date");
  return d;
}
export function validateProduct(data: ReturnType<typeof productSchema.parse>) {
  const categories = data.categories.map((c) => c.slug);
  if (new Set(categories).size !== categories.length)
    throw new BadRequestException("Duplicate categories");
  for (const rate of data.rates) {
    validDay(rate.startDate);
    validDay(rate.endDate);
    if (!categories.includes(rate.category) || rate.startDate > rate.endDate)
      throw new BadRequestException("Invalid rate/category");
    if (
      data.rates.some(
        (other) =>
          other !== rate &&
          rate.category === other.category &&
          rate.startDate <= other.endDate &&
          other.startDate <= rate.endDate,
      )
    )
      throw new BadRequestException("Overlapping seasonal rates");
  }
}
@Injectable()
export class CatalogService {
  constructor(private readonly db: Database) {}
  async definition(
    tx: Tx,
    actor: Actor,
    productId: string,
  ): Promise<{ definition: ProductInput; version: number }> {
    const {
      rows: [row],
    } = await tx.query(
      "SELECT definition,version FROM products WHERE tenant_id=$1 AND id=$2",
      [actor.tenantId, productId],
    );
    if (!row) throw new NotFoundException();
    return row;
  }
  create(actor: Actor, key: string, input: unknown) {
    const data = parse(productSchema, input);
    validateProduct(data);
    return this.db.command(actor, "product.create", key, data, async (tx) => {
      await tenant(tx, actor, true);
      const productId = randomUUID();
      await tx.query(
        `INSERT INTO products
           (tenant_id,id,name,definition,internal_name,customer_title,description,product_kind,availability_mode)
         VALUES($1,$2,$3,$4,$3,$3,$5,$6,$7)`,
        [actor.tenantId, productId, data.name, data, data.description, data.productKind, data.availabilityMode],
      );
      const optionId = randomUUID();
      await tx.query(
        `INSERT INTO product_options
           (tenant_id,id,product_id,internal_name,customer_title,duration_minutes,confirmation_mode,pricing_model,private_booking)
         VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8)`,
        [actor.tenantId, optionId, productId, data.optionName, data.durationMinutes, data.confirmationMode, data.pricingModel, data.privateBooking],
      );
      for (const [sortOrder, category] of data.categories.entries()) {
        const unitId = randomUUID();
        await tx.query(
          `INSERT INTO passenger_units(tenant_id,id,option_id,code,label,counts_toward_capacity,sort_order)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [actor.tenantId, unitId, optionId, category.slug, category.label, category.countsTowardCapacity, sortOrder],
        );
        for (const rate of data.rates.filter((item) => item.category === category.slug))
          await tx.query(
            `INSERT INTO rate_plans(tenant_id,id,option_id,unit_id,start_date,end_date,amount_minor)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [actor.tenantId, randomUUID(), optionId, unitId, rate.startDate, rate.endDate, rate.amountMinor],
          );
      }
      await record(tx, actor, "catalog.configured", productId, null, data);
      return { productId, ...data, version: 1 };
    });
  }
  schedule(actor: Actor, key: string, input: unknown) {
    const data = parse(scheduleSchema, input);
    const start = validDay(data.startDate),
      end = validDay(data.endDate);
    if (end < start || end.diff(start, "days").days > 365)
      throw new BadRequestException("Schedule must span 0–365 days");
    data.blackoutDates.forEach(validDay);
    return this.db.command(actor, "schedule.create", key, data, async (tx) => {
      const settings = await tenant(tx, actor);
      const option = (await tx.query(
        `SELECT o.id,o.duration_minutes,p.availability_mode FROM product_options o
         JOIN products p ON p.tenant_id=o.tenant_id AND p.id=o.product_id
         WHERE o.tenant_id=$1 AND o.product_id=$2 AND o.active ORDER BY o.created_at LIMIT 1`,
        [actor.tenantId, data.productId],
      )).rows[0];
      if (!option) throw new BadRequestException("Product has no active option");
      if (option.availability_mode !== "fixed_departure")
        throw new BadRequestException(
          "This editor creates fixed departures only; use the product's availability-mode editor",
        );
      const scheduleId = randomUUID();
      await tx.query("INSERT INTO schedules VALUES($1,$2,$3,$4)", [
        actor.tenantId,
        scheduleId,
        data.productId,
        data,
      ]);
      const ruleId = randomUUID();
      await tx.query(
        `INSERT INTO availability_rules
           (tenant_id,id,option_id,schedule_id,mode,start_date,end_date,weekdays,capacity,timezone)
         VALUES($1,$2,$3,$4,'fixed_departure',$5,$6,$7,$8,$9)`,
        [actor.tenantId, ruleId, option.id, scheduleId, data.startDate, data.endDate, data.weekdays, data.capacity, settings.timezone],
      );
      await tx.query(
        `INSERT INTO availability_rule_times(tenant_id,id,rule_id,local_time)
         VALUES($1,$2,$3,$4)`,
        [actor.tenantId, randomUUID(), ruleId, data.localTime],
      );
      for (const date of data.blackoutDates)
        await tx.query(
          `INSERT INTO availability_exceptions(tenant_id,id,rule_id,local_date)
           VALUES($1,$2,$3,$4)`,
          [actor.tenantId, randomUUID(), ruleId, date],
        );
      const departures: { departureId: string; startsAt: string }[] = [];
      for (let date = start; date <= end; date = date.plus({ days: 1 })) {
        const localDate = date.toISODate()!;
        if (
          !data.weekdays.includes(date.weekday) ||
          data.blackoutDates.includes(localDate)
        )
          continue;
        const local = `${localDate}T${data.localTime}`;
        const zoned = DateTime.fromISO(local, { zone: settings.timezone });
        if (
          !zoned.isValid ||
          zoned.toFormat("yyyy-MM-dd'T'HH:mm") !== local ||
          zoned.getPossibleOffsets().length !== 1
        )
          throw new BadRequestException(
            "Ambiguous or nonexistent local departure time",
          );
        const departureId = randomUUID(),
          startsAt = zoned.toUTC().toISO()!;
        await tx.query(
          `INSERT INTO departures
             (tenant_id,id,product_id,schedule_id,starts_at,local_date,capacity,option_id,availability_rule_id,ends_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$5::timestamptz + make_interval(mins => $10))`,
          [
            actor.tenantId,
            departureId,
            data.productId,
            scheduleId,
            startsAt,
            localDate,
            data.capacity,
            option.id,
            ruleId,
            option.duration_minutes,
          ],
        );
        await record(tx, actor, "departure.created", departureId, null, {
          productId: data.productId,
          startsAt,
          capacity: data.capacity,
        });
        departures.push({ departureId, startsAt });
      }
      if (!departures.length)
        throw new BadRequestException("Schedule generates no departures");
      await record(tx, actor, "schedule.created", scheduleId, null, data);
      return { scheduleId, ruleId, departures };
    });
  }
  updateProduct(actor: Actor, productId: string, key: string, input: unknown) {
    const data = parse(productUpdateSchema, input);
    return this.db.command(actor, "product.update", key, data, async (tx) => {
      await tenant(tx, actor, true);
      const {
        rows: [before],
      } = await tx.query(
        `SELECT id,name,description,status,version,definition,availability_mode
         FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [actor.tenantId, productId],
      );
      if (!before) throw new NotFoundException();
      if (before.version !== data.version)
        throw new ConflictException("Product was updated by someone else");
      const definition = {
        name: data.name,
        description: data.description,
        productKind: data.productKind,
        availabilityMode: before.availability_mode,
        optionName: data.optionName,
        durationMinutes: data.durationMinutes,
        pricingModel: data.pricingModel,
        privateBooking: data.privateBooking,
        confirmationMode: data.confirmationMode,
        categories: data.categories,
        rates: data.rates,
      };
      validateProduct(definition);
      const {
        rows: [option],
      } = await tx.query(
        `SELECT id FROM product_options
         WHERE tenant_id=$1 AND product_id=$2 AND active
         ORDER BY created_at LIMIT 1`,
        [actor.tenantId, productId],
      );
      if (!option) throw new BadRequestException("Product has no active option");
      await tx.query(
        `UPDATE product_options
            SET internal_name=$3,customer_title=$3,duration_minutes=$4,
                confirmation_mode=$5,pricing_model=$6,private_booking=$7,
                updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND id=$2`,
        [
          actor.tenantId,
          option.id,
          data.optionName,
          data.durationMinutes,
          data.confirmationMode,
          data.pricingModel,
          data.privateBooking,
        ],
      );
      const codes = data.categories.map((category) => category.slug);
      await tx.query(
        `UPDATE passenger_units SET active=false
          WHERE tenant_id=$1 AND option_id=$2 AND NOT (code = ANY($3::text[]))`,
        [actor.tenantId, option.id, codes],
      );
      for (const [sortOrder, category] of data.categories.entries()) {
        await tx.query(
          `INSERT INTO passenger_units
             (tenant_id,id,option_id,code,label,counts_toward_capacity,sort_order,active)
           VALUES($1,$2,$3,$4,$5,$6,$7,true)
           ON CONFLICT (tenant_id,option_id,code) DO UPDATE
             SET label=EXCLUDED.label,
                 counts_toward_capacity=EXCLUDED.counts_toward_capacity,
                 sort_order=EXCLUDED.sort_order,
                 active=true`,
          [
            actor.tenantId,
            randomUUID(),
            option.id,
            category.slug,
            category.label,
            category.countsTowardCapacity,
            sortOrder,
          ],
        );
      }
      await tx.query(
        `UPDATE rate_plans SET active=false WHERE tenant_id=$1 AND option_id=$2`,
        [actor.tenantId, option.id],
      );
      const { rows: units } = await tx.query(
        `SELECT id,code FROM passenger_units
         WHERE tenant_id=$1 AND option_id=$2 AND active`,
        [actor.tenantId, option.id],
      );
      const unitId = Object.fromEntries(
        units.map((unit: { id: string; code: string }) => [unit.code, unit.id]),
      );
      for (const rate of data.rates) {
        const unit = unitId[rate.category];
        if (!unit) throw new BadRequestException("Rate category is missing");
        await tx.query(
          `INSERT INTO rate_plans
             (tenant_id,id,option_id,unit_id,start_date,end_date,amount_minor)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            actor.tenantId,
            randomUUID(),
            option.id,
            unit,
            rate.startDate,
            rate.endDate,
            rate.amountMinor,
          ],
        );
      }
      const {
        rows: [row],
      } = await tx.query(
        `UPDATE products
            SET name=$3,customer_title=$3,internal_name=$3,description=$4,status=$5,
                product_kind=$6,definition=$7,version=version+1,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND id=$2 AND version=$8
        RETURNING id,name,description,status,version,definition,product_kind,availability_mode`,
        [
          actor.tenantId,
          productId,
          data.name,
          data.description,
          data.status,
          data.productKind,
          definition,
          data.version,
        ],
      );
      if (!row) throw new ConflictException("Product was updated by someone else");
      await record(tx, actor, "catalog.updated", productId, before, data);
      return row;
    });
  }
  updateRule(actor: Actor, ruleId: string, key: string, input: unknown) {
    const data = parse(availabilityRuleUpdateSchema, input);
    return this.db.command(
      actor,
      "availability-rule.update",
      key,
      data,
      async (tx) => {
        await tenant(tx, actor, true);
        const {
          rows: [before],
        } = await tx.query(
          "SELECT id,status,version FROM availability_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [actor.tenantId, ruleId],
        );
        if (!before) throw new NotFoundException();
        if (before.version !== data.version)
          throw new ConflictException("Availability rule was updated by someone else");
        const {
          rows: [row],
        } = await tx.query(
          `UPDATE availability_rules
              SET status=$3,version=version+1,updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND id=$2 AND version=$4
          RETURNING id,status,version`,
          [actor.tenantId, ruleId, data.status, data.version],
        );
        if (!row)
          throw new ConflictException("Availability rule was updated by someone else");
        await record(tx, actor, "availability-rule.updated", ruleId, before, data);
        return row;
      },
    );
  }
}
@Controller("admin/v1")
export class CatalogController {
  constructor(
    private readonly service: CatalogService,
    private readonly db: Database,
    private readonly limits: LimitsService,
  ) {}
  @Post("products")
  @Access("catalog.write")
  async create(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    await this.limits.enforce(a, "products");
    return this.service.create(a, parse(keySchema, key), body);
  }
  @Post("schedules")
  @Access("catalog.write")
  schedule(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.schedule(a, parse(keySchema, key), body);
  }
  @Get("products")
  @Access("catalog.read")
  list(@CurrentActor() a: Actor) {
    return this.db.transaction(
      a,
      async (tx) =>
        (
          await tx.query(
            `${productSelect}
             WHERE p.tenant_id=$1
             GROUP BY p.tenant_id,p.id ORDER BY p.customer_title LIMIT 100`,
            [a.tenantId],
          )
        ).rows,
    );
  }
  @Get("products/:id")
  @Access("catalog.read")
  async product(@CurrentActor() a: Actor, @Param("id") value: string) {
    const productId = parse(id, value);
    return this.db.transaction(a, async (tx) => {
      const {
        rows: [row],
      } = await tx.query(
        `${productSelect}
         WHERE p.tenant_id=$1 AND p.id=$2
         GROUP BY p.tenant_id,p.id`,
        [a.tenantId, productId],
      );
      if (!row) throw new NotFoundException();
      return row;
    });
  }
  @Patch("products/:id")
  @Access("catalog.write")
  updateProduct(
    @CurrentActor() a: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateProduct(
      a,
      parse(id, value),
      parse(keySchema, key),
      body,
    );
  }
  @Get("availability-rules")
  @Access("catalog.read")
  availability(@CurrentActor() a: Actor) {
    return this.db.transaction(
      a,
      async (tx) =>
        (
          await tx.query(
            `${ruleSelect}
             WHERE ar.tenant_id=$1
             ORDER BY ar.start_date DESC LIMIT 100`,
            [a.tenantId],
          )
        ).rows,
    );
  }
  @Get("availability-rules/:id")
  @Access("catalog.read")
  async rule(@CurrentActor() a: Actor, @Param("id") value: string) {
    const ruleId = parse(id, value);
    return this.db.transaction(a, async (tx) => {
      const {
        rows: [row],
      } = await tx.query(
        `${ruleSelect}
         WHERE ar.tenant_id=$1 AND ar.id=$2`,
        [a.tenantId, ruleId],
      );
      if (!row) throw new NotFoundException();
      const { rows: departures } = await tx.query(
        `SELECT d.id,d.starts_at,d.capacity,d.status,(d.committed+d.overbooked)::int AS committed,
                GREATEST(0,d.capacity-d.committed-d.overbooked-COALESCE((
                  SELECT SUM(h.seats) FROM holds h
                  WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id
                    AND NOT h.consumed AND h.expires_at>clock_timestamp()
                ),0))::int AS available
         FROM departures d
         WHERE d.tenant_id=$1 AND d.availability_rule_id=$2 AND d.starts_at >= clock_timestamp()
         ORDER BY d.starts_at LIMIT 50`,
        [a.tenantId, ruleId],
      );
      return { ...row, departures };
    });
  }
  @Patch("availability-rules/:id")
  @Access("catalog.write")
  updateRule(
    @CurrentActor() a: Actor,
    @Param("id") value: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.service.updateRule(
      a,
      parse(id, value),
      parse(keySchema, key),
      body,
    );
  }
}
