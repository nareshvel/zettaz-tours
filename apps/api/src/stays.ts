import { Body, Controller, Get, Headers, Injectable, NotFoundException, Patch, Param, Post, Query } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

// A vessel is just a ship name a booking can point at. Platform-seeded rows
// (tenant_id IS NULL) are visible to everyone; a tenant may add its own when the
// seed misses one. RLS in 076 stops a tenant writing a seeded row.
const vesselSchema = z.object({ name:z.string().trim().min(1).max(160), cruiseLine:z.string().trim().max(160).optional(), imo:z.string().trim().regex(/^\d{7}$/).optional(), passengerCapacity:z.number().int().positive().max(20000).optional() }).strict();
const vesselUpdateSchema = z.object({ name:z.string().trim().min(1).max(160).optional(), cruiseLine:z.string().trim().max(160).nullable().optional(), active:z.boolean().optional() }).strict().refine(d=>Object.keys(d).length>0,{message:"At least one field must be supplied"});
const accommodationSchema = z.object({ name:z.string().trim().min(1).max(160), address:z.string().trim().max(300).default("") }).strict();
const listQuerySchema = z.object({ q:z.string().trim().max(80).optional() }).strict();

@Injectable()
export class StayService {
  constructor(private readonly db: Database) {}

  /** Everything the booking and settings screens need to offer a stay. */
  options(actor: Actor) { return this.db.transaction(actor, async tx => ({
    vessels:(await tx.query("SELECT id,name,cruise_line,imo,tenant_id IS NOT NULL AS tenant_owned FROM vessels WHERE active ORDER BY name,id")).rows,
    accommodations:(await tx.query("SELECT id,name,address,tenant_id IS NOT NULL AS tenant_owned FROM accommodation_properties WHERE active ORDER BY name,id")).rows,
  })); }

  /** Vessel list for settings, with an optional search term. */
  listVessels(actor: Actor, rawQuery: unknown) { const q=parse(listQuerySchema,rawQuery); const term=q.q?`%${q.q}%`:null; return this.db.transaction(actor, async tx =>
    (await tx.query("SELECT id,name,cruise_line,imo,passenger_capacity,active,tenant_id IS NOT NULL AS tenant_owned FROM vessels WHERE ($1::text IS NULL OR name ILIKE $1 OR cruise_line ILIKE $1) ORDER BY name,id LIMIT 500",[term])).rows
  ); }

  createVessel(actor: Actor,key:string,raw:unknown) { const input=parse(vesselSchema,raw); return this.db.command(actor,"vessel.create",key,input,async tx=>{
    // Offer the shared row instead of letting a tenant shadow it with a duplicate.
    const {rows:[existing]}=await tx.query("SELECT id,name,tenant_id FROM vessels WHERE lower(name)=lower($1) AND active LIMIT 1",[input.name]);
    if(existing) return { id:existing.id, name:existing.name, alreadyListed:true };
    const result={id:randomUUID(),...input};
    await tx.query("INSERT INTO vessels(id,tenant_id,name,cruise_line,imo,passenger_capacity) VALUES($1,$2,$3,$4,$5,$6)",[result.id,actor.tenantId,input.name,input.cruiseLine??null,input.imo??null,input.passengerCapacity??null]);
    await record(tx,actor,"vessel.created",result.id,null,result);
    return result; }); }

  updateVessel(actor: Actor,vesselId:string,key:string,raw:unknown) { const input=parse(vesselUpdateSchema,raw); return this.db.command(actor,`vessel.update:${vesselId}`,key,input,async tx=>{
    // RLS restricts UPDATE to the tenant's own rows, so a seeded row simply
    // matches nothing here rather than needing a separate ownership check.
    const {rows:[before]}=await tx.query("SELECT id,name,cruise_line,active FROM vessels WHERE id=$1 AND tenant_id IS NOT NULL FOR UPDATE",[vesselId]);
    if(!before) throw new NotFoundException("Vessel not found, or it is a shared entry you cannot edit");
    const {rows:[after]}=await tx.query("UPDATE vessels SET name=COALESCE($2,name), cruise_line=CASE WHEN $3::boolean THEN $4 ELSE cruise_line END, active=COALESCE($5,active) WHERE id=$1 RETURNING id,name,cruise_line,active",[vesselId,input.name??null,"cruiseLine" in input,input.cruiseLine??null,input.active??null]);
    await record(tx,actor,"vessel.updated",vesselId,before,after);
    return after; }); }

  createAccommodation(actor: Actor,key:string,raw:unknown) { const input=parse(accommodationSchema,raw); return this.db.command(actor,"accommodation.create",key,input,async tx=>{
    const {rows:[existing]}=await tx.query("SELECT id,name FROM accommodation_properties WHERE lower(name)=lower($1) AND active LIMIT 1",[input.name]);
    if(existing) return { id:existing.id, name:existing.name, alreadyListed:true };
    const result={id:randomUUID(),...input};
    await tx.query("INSERT INTO accommodation_properties(id,tenant_id,name,address,created_by) VALUES($1,$2,$3,$4,$5)",[result.id,actor.tenantId,input.name,input.address,actor.actorId]);
    await record(tx,actor,"accommodation.created",result.id,null,result);
    return result; }); }
}

@Controller("ops/v1/stays")
export class StayController {
  constructor(private readonly service:StayService){}
  @Get("options") @Access("bookings.read") options(@CurrentActor() actor:Actor){return this.service.options(actor);}
  @Get("vessels") @Access("bookings.read") vessels(@CurrentActor() actor:Actor,@Query() query:unknown){return this.service.listVessels(actor,query);}
  @Post("vessels") @Access("operations.write") createVessel(@CurrentActor() actor:Actor,@Headers("idempotency-key") key:string,@Body() body:unknown){return this.service.createVessel(actor,parse(keySchema,key),body);}
  @Patch("vessels/:id") @Access("operations.write") updateVessel(@CurrentActor() actor:Actor,@Param("id") id:string,@Headers("idempotency-key") key:string,@Body() body:unknown){return this.service.updateVessel(actor,parse(z.string().uuid(),id),parse(keySchema,key),body);}
  @Post("accommodations") @Access("operations.write") accommodation(@CurrentActor() actor:Actor,@Headers("idempotency-key") key:string,@Body() body:unknown){return this.service.createAccommodation(actor,parse(keySchema,key),body);}
}
