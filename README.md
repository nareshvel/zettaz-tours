# Zettaz Tours & Charters

Multi-tenant tour operations platform. The first backend slice and tenant operations workspace are implemented with NestJS, PostgreSQL and Next.js. Expo crew workflows follow the delivery plan.

Start the isolated mock demo with `npm ci` then `npm run demo:web`. Run database-backed checks with `npm test`. Requires Node 22.14+ and PostgreSQL binaries on PATH, or a disposable test database for tests.

- [Local development and limitations](docs/HANDOFF/local-development.md)
- [Product documentation](docs/README.md)
- [Accepted requirements and decisions](docs/STRATEGY/requirements-plan.md)
- [Booking changes evidence](docs/TESTING/booking-changes-evidence.md)
- [Operations and pickup planning evidence](docs/TESTING/operations-pickup-evidence.md)
- [Printable pickup-list requirements](docs/FEATURES/operations/printable-pickup-list.md)
- [Tenant workspace evidence](docs/TESTING/tenant-workspace-evidence.md)
- [First-slice evidence](docs/TESTING/first-slice-evidence.md)

Demo/test mode only. Mock tenant settings are configurable, and live payments and production identity are not enabled.

Open http://127.0.0.1:3191 and choose a synthetic tenant. If a port is occupied, update `PORT`, `WEB_PORT`, and `WEB_ORIGIN` consistently in `.env`, then run `npm run demo:web`. Ctrl-C stops the demo; data is temporary.
