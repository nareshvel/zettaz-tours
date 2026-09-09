"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemFilter = exports.AuthGuard = exports.keySchema = exports.CurrentActor = exports.Access = void 0;
exports.parse = parse;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const zod_1 = require("zod");
const node_crypto_1 = require("node:crypto");
const database_1 = require("./database");
const Access = (permission) => (0, common_1.SetMetadata)("access", permission);
exports.Access = Access;
exports.CurrentActor = (0, common_1.createParamDecorator)((_data, ctx) => ctx.switchToHttp().getRequest().actor);
function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new common_1.BadRequestException(result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
        })));
    return result.data;
}
exports.keySchema = zod_1.z
    .string()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9:_-]+$/);
let AuthGuard = class AuthGuard {
    db;
    reflector;
    constructor(db, reflector) {
        this.db = db;
        this.reflector = reflector;
    }
    async canActivate(ctx) {
        const required = this.reflector.get("access", ctx.getHandler());
        if (required === "public")
            return true;
        const req = ctx.switchToHttp().getRequest();
        const token = req.headers.authorization?.match(/^Bearer ([a-zA-Z0-9_-]{40,100})$/)?.[1];
        if (!token)
            throw new common_1.UnauthorizedException();
        const { rows: [session], } = await this.db.pool.query("SELECT * FROM resolve_session($1)", [
            (0, database_1.digest)(token),
        ]);
        if (!session)
            throw new common_1.UnauthorizedException();
        req.actor = {
            actorId: session.actor_id,
            tenantId: session.tenant_id,
            platform: session.platform,
            permissions: session.permissions,
            role: session.role,
        };
        if (!required || !req.actor.permissions.includes(required))
            throw new common_1.ForbiddenException();
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_1.Database,
        core_1.Reflector])
], AuthGuard);
let ProblemFilter = class ProblemFilter {
    catch(error, host) {
        const res = host.switchToHttp().getResponse();
        const code = error.code;
        let status = error instanceof common_1.HttpException ? error.getStatus() : 500;
        if (code === "23505" || code === "40001" || code === "55P03")
            status = 409;
        if (code === "23503" || code === "23514" || code === "22007")
            status = 400;
        const detail = error instanceof common_1.HttpException
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
            correlationId: res.getHeader("X-Correlation-Id") ?? (0, node_crypto_1.randomUUID)(),
        });
    }
};
exports.ProblemFilter = ProblemFilter;
exports.ProblemFilter = ProblemFilter = __decorate([
    (0, common_1.Catch)()
], ProblemFilter);
