import {
  ArgumentsHost,
  BadRequestException,
  CanActivate,
  Catch,
  createParamDecorator,
  ExecutionContext,
  ExceptionFilter,
  HttpException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Actor } from "../../../packages/shared/src/contracts";
import { Database, digest } from "./database";

type AuthRequest = Request & { actor: Actor };
export const Access = (permission: string) => SetMetadata("access", permission);
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthRequest>().actor,
);
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  return result.data;
}
export const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const required = this.reflector.get<string>("access", ctx.getHandler());
    if (required === "public") return true;
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(
      /^Bearer ([a-zA-Z0-9_-]{40,100})$/,
    )?.[1];
    if (!token) throw new UnauthorizedException();
    const {
      rows: [session],
    } = await this.db.pool.query("SELECT * FROM resolve_session($1)", [
      digest(token),
    ]);
    if (!session) throw new UnauthorizedException();
    req.actor = {
      actorId: session.actor_id,
      tenantId: session.tenant_id,
      platform: session.platform,
      permissions: session.permissions,
      role: session.role,
    };
    if (!required || !req.actor.permissions.includes(required))
      throw new ForbiddenException();
    return true;
  }
}
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const code = (error as { code?: string }).code;
    let status = error instanceof HttpException ? error.getStatus() : 500;
    if (code === "23505" || code === "40001" || code === "55P03") status = 409;
    if (code === "23503" || code === "23514" || code === "22007") status = 400;
    const detail =
      error instanceof HttpException
        ? error.getResponse()
        : status === 500
          ? "Unexpected server error"
          : "Constraint or concurrency conflict";
    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        status,
        title: status === 500 ? "Internal server error" : "Request rejected",
        detail,
        correlationId: res.getHeader("X-Correlation-Id") ?? randomUUID(),
      });
  }
}
