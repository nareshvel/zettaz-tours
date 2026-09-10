import { Body, Controller, Get, Headers, Injectable, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";

const cruiseCallSchema = z.object({ vesselName:z.string().trim().min(1).max(120), callDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), portName:z.string().trim().min(1).max(120), scheduledArrival:z.string().datetime({offset:true}).optional(), scheduledDeparture:z.string().datetime({offset:true}).optional(), allAboardAt:z.string().datetime({offset:true}).optional(), tenderRequired:z.boolean().default(false) }).strict();
const accommodationSchema = z.object({ name:z.string().trim().min(1).max(160), address:z.string().trim().max(300).default("") }).strict();

@Injectable()
export class StayService {
  constructor(private readonly db: Database) {}
  options(actor: Actor) { return this.db.transaction(actor, async tx => ({
    cruiseCalls:(await tx.query("SELECT id,vessel_name,call_date,port_name,scheduled_arrival,scheduled_departure,all_aboard_at,tender_required FROM cruise_calls WHERE tenant_id=$1 AND active AND call_date>=current_date-1 ORDER BY call_date,vessel_name,id",[actor.tenantId])).rows,
    accommodations:(await tx.query("SELECT id,name,address FROM accommodation_properties WHERE tenant_id=$1 AND active ORDER BY name,id",[actor.tenantId])).rows,
  })); }
  createCruiseCall(actor: Actor,key:string,raw:unknown) { const input=parse(cruiseCallSchema,raw); return this.db.command(actor,"cruise_call.create",key,input,async tx=>{ const result={id:randomUUID(),...input}; await tx.query("INSERT INTO cruise_calls(tenant_id,id,vessel_name,call_date,port_name,scheduled_arrival,scheduled_departure,all_aboard_at,tender_required,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[actor.tenantId,result.id,input.vesselName,input.callDate,input.portName,input.scheduledArrival??null,input.scheduledDeparture??null,input.allAboardAt??null,input.tenderRequired,actor.actorId]); await record(tx,actor,"cruise_call.created",result.id,null,result); return result; }); }
  createAccommodation(actor: Actor,key:string,raw:unknown) { const input=parse(accommodationSchema,raw); return this.db.command(actor,"accommodation.create",key,input,async tx=>{ const result={id:randomUUID(),...input}; await tx.query("INSERT INTO accommodation_properties(tenant_id,id,name,address,created_by) VALUES($1,$2,$3,$4,$5)",[actor.tenantId,result.id,input.name,input.address,actor.actorId]); await record(tx,actor,"accommodation.created",result.id,null,result); return result; }); }
}
@Controller("ops/v1/stays")
export class StayController {
  constructor(private readonly service:StayService){}
  @Get("options") @Access("bookings.read") options(@CurrentActor() actor:Actor){return this.service.options(actor);}
  @Post("cruise-calls") @Access("operations.write") cruise(@CurrentActor() actor:Actor,@Headers("idempotency-key") key:string,@Body() body:unknown){return this.service.createCruiseCall(actor,parse(keySchema,key),body);}
  @Post("accommodations") @Access("operations.write") accommodation(@CurrentActor() actor:Actor,@Headers("idempotency-key") key:string,@Body() body:unknown){return this.service.createAccommodation(actor,parse(keySchema,key),body);}
}
