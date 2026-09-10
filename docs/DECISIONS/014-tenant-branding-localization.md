# ADR 014: Tenant-local branding and presentation preferences

Tenant logos are local validated files, not arbitrary URLs. Tenant locale preferences are configuration data, and waiver content is immutable by version. This avoids cross-tenant asset leakage, broken external URL dependencies, and retroactive changes to signed evidence.
