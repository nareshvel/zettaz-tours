# Account recovery

**Status:** Database/API/web foundation implemented · **Date:** 10 September 2026

Recovery requests always return the same accepted response and do not reveal whether
an email belongs to an active user. The latest token is stored only as a SHA-256 hash,
expires after one hour, and can be used once. Completing recovery replaces the scrypt
password hash, clears the token, and revokes every existing tenant session for the
identity.

The public web flow is available at `/forgot-password`. Token delivery remains
`held_provider` until a transactional email provider and tenant sender policy are
selected. Local/test token exposure requires the explicit `EXPOSE_RECOVERY_TOKEN=1`
flag and is refused in production mode. Never enable that flag in a shared environment.
