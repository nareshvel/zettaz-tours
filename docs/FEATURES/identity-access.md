# Identity and access foundation

Tenant memberships and their server-authoritative role grants control access. The interface does not grant access by itself.

The data model deliberately separates three concerns:

- `staff_users` is a global person/profile record. It does not contain a tenant ID because one person may work for several tenants.
- `memberships` assigns that person to a tenant, role and active state.
- `user_credentials` holds credential lifecycle data. Tokens are stored only as hashes and TOTP material is reserved for encrypted ciphertext; plaintext MFA secrets are prohibited.

Phone, profile image path, email verification, sign-up completion, last-login and active status live with the global profile. Tenant-specific activation and roles remain in memberships. Location/store assignment will be modeled separately because an operator can have multiple depots, vessels or locations.

The local workspace authenticates against the persistent database through the API. The server verifies the stored password hash, creates a tenant-scoped short-lived session and reads accessible memberships from database functions; no local access-file fallback exists. The seeded local password is development-only.

Tenant-defined roles are assignable from Team & access. System roles remain protected. The API resolves permissions from `role_permissions` for every session; the stored membership permission snapshot is kept as an audit-friendly denormalization, not the authorization source.

Signing out revokes the server-side session before the browser cookie is removed. Revoking a tenant membership revokes every active session for that tenant membership immediately.

Authenticated users can change their own password after presenting the current password. Tenant administrators can create a seven-day, one-time invitation for an existing tenant role. Only a SHA-256 hash of the opaque invitation token is stored. Accepting it proves control of the delivery channel, creates the global user and tenant membership atomically, sets the initial password, marks the email verified and issues a tenant-scoped session. A token is returned exactly once to the authorized administrator until the transactional email adapter is delivered; it must be sent only through an approved channel.

Account-wide session revocation and persistent sign-in throttling are implemented. Production identity provider selection, transactional invitation delivery, password reset, privileged MFA and account recovery remain required E01 work.

## Platform support access

Platform support identities remain separate from tenant staff and have no standing tenant membership. An identified platform user submits a request for one tenant, a purpose and a fixed subset of read-only permissions. `catalog.read` is always included so the resulting session can render tenant context safely. Only an active tenant owner can approve the request, for one to eight hours, or reject it with a reason.

Using an approved grant issues a separate opaque support session bounded by the grant expiry. The workspace session includes the grant purpose and expiry for a persistent support-access banner. Revoking the grant immediately revokes every derived support session. Request, approval, use and revocation write tenant audit and outbox records. Expired, rejected, revoked, cross-tenant and write attempts fail at the server boundary.

Elevated support writes, emergency access and standing support credentials are unavailable. They require a separately approved policy and are not inferred from platform administrator status.
