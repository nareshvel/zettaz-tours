import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Post,
  NotFoundException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import {
  Actor,
  ProductInput,
  productSchema,
  scheduleSchema,
} from "../../../packages/shared/src/contracts";
import { Database, record, Tx } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { tenant } from "./tenant";

export function validDay(value: string) {
  const d = DateTime.fromISO(value, { zone: "UTC" });
  if (!d.isValid || d.toISODate() !== value)
    throw new BadRequestException("Invalid calendar date");
  return d;
}
export function validateProduct(data: ProductInput) {
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
        "INSERT INTO products(tenant_id,id,name,definition) VALUES($1,$2,$3,$4)",
        [actor.tenantId, productId, data.name, data],
      );
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
      const scheduleId = randomUUID();
      await tx.query("INSERT INTO schedules VALUES($1,$2,$3,$4)", [
        actor.tenantId,
        scheduleId,
        data.productId,
        data,
      ]);
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
          "INSERT INTO departures(tenant_id,id,product_id,schedule_id,starts_at,local_date,capacity) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            actor.tenantId,
            departureId,
            data.productId,
            scheduleId,
            startsAt,
            localDate,
            data.capacity,
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
      return { scheduleId, departures };
    });
  }
}
@Controller("admin/v1")
export class CatalogController {
  constructor(
    private readonly service: CatalogService,
    private readonly db: Database,
  ) {}
  @Post("products")
  @Access("catalog.write")
  create(
    @CurrentActor() a: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
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
            "SELECT id,name,definition,version FROM products WHERE tenant_id=$1 ORDER BY id LIMIT 100",
            [a.tenantId],
          )
        ).rows,
    );
  }
}
