> **Superseded — 5 September 2026**
>
> This file is historical (v1.1, 1 September 2026). It is **not** the working product spec.
> Use [docs/README.md](../README.md) as the index. Working spec lives under STRATEGY, ARCHITECTURE, and DECISIONS.

# Zettaz Tours & Charters

**Product & Engineering Blueprint**

Multi-tenant booking, reseller, dispatch, fleet and field-operations platform

> **Launch customer**
>
> Rock Adventures Antigua - tours, tuk-tuks, kayaks, boats, transfers and private charters.

**Prepared for**

**Naresh Velusamy, Founder & CEO - Zettaz Global LLC**

**Purpose**

A build-ready product requirements document, domain model, architecture plan, implementation roadmap and AI coding-agent prompt.

| **Decision**  | **Baseline**                                                                                                           |
|---------------|------------------------------------------------------------------------------------------------------------------------|
| Product model | Multi-tenant SaaS; Rock Adventures is tenant one                                                                       |
| Release scope | Full platform including reseller portal                                                                                |
| Surfaces      | Cloud admin, operations dashboard, staff mobile app, reseller portal, customer booking/portal                          |
| Core channels | Direct web, Viator, GetYourGuide, hotels, cruise/travel agents, Island Routes, WhatsApp, phone and walk-ins            |
| Field scope   | Resources, assignments, routes, trip status, payments, commissions, waivers, check-in, maintenance, fuel and incidents |

*Version 1.1 \| 1 September 2026*

# 1. Executive recommendation

> **Recommendation**
>
> Build one modular SaaS core with tenant-specific branding and configuration. Do not build a Rock Adventures-only database or hard-code its tour names, payment rules, pickup locations or commission agreements.

The product should sit between a booking platform and an operational command center. Established platforms are strong at checkout, calendars, OTA distribution and manifests, but Rock Adventures also needs Caribbean-specific contracted-reseller invoicing, hotel pickups, mixed vehicles and vessels, offline field execution, maintenance and incident records. That combination is the differentiation Zettaz can sell to other island tour, charter, excursion and transport operators.

## Product thesis

- One source of truth for every booking, passenger, departure, resource, payment and reseller obligation.

- Real-time availability derived from seats plus constrained resources: vehicle, vessel, guide, captain, driver, equipment and pickup capacity.

- A field-first mobile workflow that remains usable with unreliable mobile data and synchronizes safely.

- A channel-neutral commercial layer: direct, OTA, hotel, cruise, DMC, travel agent, concierge, phone, WhatsApp and walk-in.

- A configurable finance ledger for deposits, balances, refunds, commissions, invoices and partner settlements in multiple currencies.

- Open integration architecture based on adapters and an OCTO-compatible external API.

## Success definition

| **Outcome**                                 | **Target after stabilization**                               |
|---------------------------------------------|--------------------------------------------------------------|
| Manual re-entry                             | At least 80% reduction                                       |
| Overbooking caused by disconnected channels | Zero                                                         |
| Daily manifest preparation                  | Under 5 minutes                                              |
| Passenger check-in                          | Under 30 seconds per booking                                 |
| Balance/commission visibility               | Real time by booking and partner                             |
| Crew access                                 | Current assignments and passenger needs available offline    |
| Month-end partner invoicing                 | Generated from completed trips, not reconstructed from notes |

# 2. Evidence from the existing operation

The August 2026 workbook contains a blank template plus one worksheet for each calendar day. Each day repeats product rows and stores operational and financial meaning in free text. The principal columns are Tour, Ship/Hotel, Last Name, Room Number, Pickup Info, Adults, Kids, Total, Min, Max, Start Time, Return Time, Payment Type, Booked By and Comments.

## Observed patterns

- Bookings arrive from Viator, GetYourGuide, Island Routes, direct staff, hotels and local partners.

- Payment states such as paid in full, collect balance, collect in full and invoice are mixed with collection instructions and amounts.

- Partner settlements and commissions are implied in notes such as collect balance, pay commission and to be invoiced.

- Pickup instructions combine hotel, cruise ship, meeting time, transport count and special route directions.

- Operational exceptions such as no-show, moved date, closed attraction and cancellation tasks are typed into ordinary cells.

- Adults, children and infants are not modeled consistently; some days insert an infant column and change formulas.

- Dates, names, room numbers, phone numbers and exchange-rate calculations are inconsistently typed.

- Daily sheets make cross-day resource conflicts, customer history, revenue reporting and audit trails difficult.

## Current-to-future mapping

| **Spreadsheet field / practice** | **Future structured record**                     | **Automation gained**                        |
|----------------------------------|--------------------------------------------------|----------------------------------------------|
| Daily worksheet                  | Departure calendar and manifest                  | Search, filters and cross-day planning       |
| Tour text                        | Product + option + departure                     | Capacity and pricing rules                   |
| Ship/Hotel                       | Accommodation, cruise call or pickup zone        | Route grouping and arrival context           |
| Last name / room                 | Customer, booking contact and accommodation stay | Reusable CRM and communication               |
| Pickup info                      | Pickup stop + scheduled pickup + notes           | Route board and driver workflow              |
| Adults/Kids/Infants              | Passenger categories and individual guests       | Capacity, waivers and passenger requirements |
| Payment type/comments            | Payment ledger, balance and collection task      | Automatic reminders and reconciliation       |
| Booked by                        | Sales channel + reseller account + agent         | Commission and attribution                   |
| Comments                         | Typed notes, tasks, exceptions and audit events  | Ownership, status and alerts                 |

# 3. Market benchmark and opportunity

The benchmark is not one product. The strongest design combines capabilities from several categories.

| **Platform** | **Strength to learn from**                                                        | **Gap/opportunity for Zettaz**                                                                   |
|--------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| FareHarbor   | Mature booking, availability, payments, distribution and mobile operations        | Caribbean partner invoicing and mixed transport/fleet workflows can be more configurable         |
| Bókun        | Large reseller/OTA network and channel management                                 | Operational dispatch, maintenance and locally negotiated partner processes need deeper treatment |
| Rezdy        | Real-time inventory, resource scheduling, manifests, communications and reporting | Create a simpler field workflow and stronger transport/pickup command center                     |
| Peek Pro     | Modern mobile apps, resources, waivers and conversion-focused customer journey    | Provide transparent modular pricing and Caribbean gateway flexibility                            |
| Checkfront   | Check-in, waivers, invoices, receipts and daily manifests                         | Add richer reseller settlement, routing and vehicle/vessel lifecycle                             |
| Ventrata     | Enterprise ticketing, dynamic pricing, POS and vehicle/guide allocation           | Serve small and mid-size operators without enterprise implementation weight                      |
| Zaui         | Routes, timetables, fleet resources, drivers and vessel manifests                 | Blend this transport depth with reseller CRM and island excursion workflows                      |

## Recommended competitive position

> **Category**
>
> Operations and distribution OS for island tours, charters and excursions - not merely an online booking widget.

- Caribbean-first: multi-currency, invoice-based resellers, manual/card/bank/cash collection, flexible gateway adapters and unreliable-connectivity support.

- Mixed resource types in one departure: tuk-tuks, vans, boats, kayaks, clear boats, equipment, drivers, captains and guides.

- Partner-first selling: hotel, concierge, cruise, DMC, agent and affiliate portal with contract rates, allocations and settlement.

- Day-of-operations superiority: pickup clusters, dispatch board, readiness checks, QR/manual check-in, live status and incident escalation.

- Commercially reusable: configuration instead of custom forks; white-label customer/reseller surfaces; feature flags by subscription tier.

# 4. Product boundaries and release strategy

## Included in the product

- Product catalog, schedules, pricing and availability

- Central reservations and customer/passenger records

- Direct booking widget/API and customer self-service portal

- Reseller contracting, portal, allocations, commission and invoicing

- Channel connectors and reconciliation workbench

- Resource, staff, route and dispatch planning

- Crew mobile app with offline manifest and trip workflow

- Payments, balances, refunds, partner receivables and settlement

- Waivers, documents, QR tickets and check-in

- Fleet/vessel/equipment maintenance, fuel, inspections and incidents

- Notifications, tasks, reports, dashboards, audit and tenant administration

## Deliberately deferred or integrated

- Full general ledger accounting: export/sync to accounting products rather than recreating an accounting suite.

- Payroll: integrate with PayTime later; store only assignment and operational time needed by this product.

- Public marketplace across all operators: begin with tenant-specific selling and reseller networks.

- Advanced automatic route optimization: start with pickup clustering and ordered stops; add optimization after real trip data exists.

- Native public consumer app: begin with responsive booking and customer portal; reserve native mobile for staff/crew.

# 5. Users, roles and permissions

| **Role**                  | **Primary responsibilities**                                             | **Sensitive permissions**                             |
|---------------------------|--------------------------------------------------------------------------|-------------------------------------------------------|
| Zettaz platform admin     | Tenant provisioning, subscriptions, support, feature flags               | Cross-tenant access only through audited support mode |
| Tenant owner/admin        | Business configuration, users, products, pricing, integrations           | Financial settings, exports, void/refund policies     |
| Reservations agent        | Create/change bookings, customer service, collect payments               | Discount and override limits                          |
| Operations/dispatcher     | Departures, assignments, pickups, readiness and live status              | Operational overrides and resource substitution       |
| Finance                   | Payments, refunds, invoices, commissions, settlements and reconciliation | Financial exports and adjustments                     |
| Fleet/maintenance manager | Assets, inspections, service schedules, fuel and incidents               | Return-to-service approval                            |
| Driver/captain/guide      | Assigned trips, manifest, navigation, check-in and trip events           | Only necessary passenger/contact information          |
| Reseller admin            | Own contract, agents, bookings, invoices and reports                     | Own organization only                                 |
| Reseller agent            | Quote/book/manage permitted products                                     | Rate and discount rules per contract                  |
| Customer/lead traveler    | Own booking, payments, passengers, waiver and changes                    | Own booking only                                      |
| Auditor/read-only         | Reports, history and compliance evidence                                 | No operational mutation                               |

Authorization must use tenant-scoped RBAC plus record-level rules. Every mutation of bookings, inventory, money, permissions, integration mappings and safety records must create an immutable audit event.

# 6. Functional modules

## 6.1 Product and departure setup

- Products and categories: shared tour, private charter, transfer, rental/add-on.

- Variants/options for route, duration, language, pickup policy and private/shared mode.

- Passenger categories, age rules, minimum/maximum counts, accessibility and safety constraints.

- Recurring schedules, seasonal calendars, blackout dates, closures, weather holds and manual departures.

- Resource requirements expressed as rules, not hard-coded asset IDs.

- Pricing: retail, child, infant, group, private charter, seasonal, channel-specific, contract/net, promotion, add-on, pickup and fee.

## 6.2 Availability and inventory

- Availability is the minimum of sellable passenger capacity and all required resource pools.

- Support pooled capacity, exclusive resources, shared resources, allotments, release periods, holds and waitlists.

- Temporary reservation holds expire automatically; confirmation is idempotent.

- Capacity changes emit channel-sync events and recalculate affected departures.

- Manual overbooking requires permission, reason and audit event.

## 6.3 Reservations and CRM

- Create from every channel using a common booking aggregate.

- Booking states: draft, held, pending payment, confirmed, checked in, in progress, completed, cancelled, no-show and disputed.

- Separate lead traveler, passengers, purchaser, accommodation, pickup and emergency contact.

- Change date/time, product, party size or pickup using quote-difference and policy checks.

- Customer timeline consolidates messages, waivers, payments, changes, incidents and prior trips.

- Duplicate detection by email, phone, channel reference and fuzzy name/date matching.

## 6.4 Reseller and partner management

- Organization hierarchy for hotel, cruise/DMC, travel agency, concierge and affiliate.

- Contracts with effective dates, permitted products, retail/net prices, commission rules, taxes, payment terms, credit limits, allocations and cancellation terms.

- Portal availability based on contract and allotment.

- Agent-level attribution, vouchers, invoice references and booking documents.

- Settlement by gross less commission, net invoice, prepaid deposit or collect-on-site models.

- Partner statements, disputed lines, credit notes and aging.

## 6.5 Dispatch and live operations

- Visual board by date, departure, pickup route, asset and staff.

- Assign vehicles/vessels, drivers/captains/guides and equipment with conflict validation.

- Pre-departure readiness: staff accepted, resource serviceable, fuel/safety checks, passenger details, digital-waiver status and balance-payment status.

- Pickup route with ordered stops, times, guest counts, contact and navigation link.

- Trip states: preparing, en route to pickup, boarding, departed, at stop, delayed, completed, cancelled and emergency.

- Operations timeline and alert rules for late departure, missing resource, unsigned waiver, unpaid balance, payment failure, authorized override and incident.

## 6.6 Mobile crew app

- Today/next assignment list and push notifications.

- Offline encrypted manifest, pickup list, passenger notes and emergency contacts.

- Accept assignment; start shift/trip; inspection checklist; odometer/engine hours; fuel.

- QR scan or manual check-in opens a check-in checklist showing the booking balance, payment responsibility and waiver status for every required guest.

- Staff can collect the remaining balance at check-in using an approved card terminal/payment link, cash or another tenant-enabled method and immediately issue a receipt.

- Each adult guest signs the current digital waiver on the staff device or their own phone. A parent or authorized guardian completes the configured minor-consent flow.

- Boarding status remains blocked until required balances are settled and required waivers are signed, unless an authorized user records a permitted exception with a reason and audit trail.

- Offline check-in can capture signatures, payment method/reference and evidence locally; card authorization still requires an available supported payment connection unless an approved offline-terminal process exists.

- Call/message lead traveler without exposing unrelated customer data.

- Status updates, GPS breadcrumb opt-in, photos, signatures and incident reporting.

- Conflict-aware background sync with visible offline/synced state.

## 6.7 Payments and finance

- Multiple payment intents/transactions per booking: deposit, installments, balance, add-on, adjustment, refund and chargeback.

- Currencies stored as integer minor units; capture booking, settlement and reporting currency with recorded exchange rate.

- Gateway adapter model; never store raw card data.

- Cash, card terminal, payment link, bank transfer, voucher, invoice and complimentary payment methods.

- Balance collection task with responsible role and due event.

- Check-in payment workflow displays amount due, currency, collector, accepted methods and whether the booking is prepaid, partner-invoiced, complimentary or requires guest collection.

- A successful check-in payment updates the payment ledger and booking balance atomically; failed or pending payments do not mark the balance as settled.

- Partner commission accrual on configured trigger: confirmed, departure, completion or payment.

- Invoice/statement generation and accounting export.

## 6.8 Waivers, tickets and check-in

- Versioned waiver templates by product and participant category.

- Guardian flow for minors; consent timestamp, IP/device metadata and signature evidence.

- Pre-arrival link, on-site kiosk/phone workflow and reminder automation.

- Digital signature evidence records the waiver version, guest or guardian identity, signature image/strokes or accepted electronic-signature method, signed timestamp, staff/device context and consent declaration.

- QR booking/ticket codes with signed, non-sequential tokens.

- Passenger-level requirements: waiver, medical/accessibility note, equipment size and dietary information.

- Check-in status is passenger-aware: not arrived, arrived, balance pending, waiver pending, cleared to board, boarded, no-show or exception approved.

- The final **Cleared to board** action validates both financial clearance and required digital signatures. Partner-invoiced, prepaid and complimentary bookings satisfy financial clearance according to configured policy without taking a new payment.

- Retention and access policies configurable by jurisdiction and insurer guidance.

## 6.9 Assets, maintenance and safety

- Asset types: road vehicle, vessel, kayak/board, trailer, safety gear and other equipment.

- Registration, capacity, serial/VIN/hull data, insurance, licenses and document expiry.

- Usage by mileage, engine hours, trip count or calendar interval.

- Inspection templates, defects, work orders, parts/cost, downtime and return-to-service approval.

- Fuel log with quantity, cost, vendor, asset, odometer/hours, receipt photo and anomaly reporting.

- Incident workflow with severity, people, asset, location, narrative, media, witnesses, actions and restricted access.

## 6.10 Communications and tasks

- Event-driven templates for email, SMS, WhatsApp and push.

- Confirmation, payment request, reminder, pickup change, delay, waiver, cancellation, review and partner invoice messages.

- Inbound conversation linking where supported; otherwise log manual contact.

- Task queues for call-back, payment collection, cancellation, invoice review and exception resolution.

- Consent, quiet hours, delivery status and template localization.

## 6.11 Reporting and analytics

- Daily operations: departures, guests, pickups, resources, staff and exceptions.

- Sales by product/channel/reseller/agent/source, booking date and travel date.

- Gross sales, collected, receivable, refunds, commission, net revenue and payment-method reconciliation.

- Capacity utilization, load factor, no-show/cancellation and pickup performance.

- Asset utilization, downtime, maintenance/fuel cost and incident metrics.

- Export with tenant timezone, currency and permission-aware data fields.

# 7. Critical end-to-end workflows

## 7.1 Direct booking

1.  Customer selects product/date/time and party composition.

2.  System returns price, pickup options and real-time availability.

3.  A short inventory hold is created.

4.  Customer supplies traveler and passenger data, accepts policies and pays required amount.

5.  Gateway webhook confirms payment; booking confirmation is idempotent.

6.  Capacity is committed and outbound channel updates are queued.

7.  Confirmation, receipt, ticket/QR, waiver and pickup instructions are sent.

8.  Booking appears on operations board and future manifest.

## 7.2 OTA/channel booking

9.  Connector receives booking or polls according to channel rules.

10. Raw payload is stored securely and deduplicated using channel reference/idempotency key.

11. Channel product/option is mapped to the canonical product and departure.

12. Booking is created with channel financial ownership and voucher/payment status.

13. Passenger/pickup questions are normalized; missing required data creates an exception task.

14. Inventory commit triggers sync to all channels.

15. Cancellation/amendment events update the same booking and preserve history.

## 7.3 Hotel/reseller booking

16. Authenticated agent sees only contract-eligible products, rates and allotments.

17. Agent creates a quote/hold or confirmed booking and identifies hotel room/guest.

18. System calculates retail, net, commission and collection responsibility.

19. Voucher and confirmation are issued; booking enters manifest.

20. After completion, commission/invoice lines accrue according to contract.

21. Finance approves statement/invoice, sends it, records settlement and resolves disputes.

## 7.4 Day-of operation

22. Dispatcher reviews readiness board and unresolved exceptions.

23. Resources and staff are assigned; crew receives assignment.

24. Crew completes inspection/fuel/readiness steps and downloads offline manifest.

25. Driver follows pickup sequence; customers may receive pickup status messages.

26. Crew scans the booking QR code or finds the booking manually and confirms the arriving passengers.

27. The check-in screen displays the exact balance due, currency, payment responsibility and accepted payment methods. Staff collects and records the balance when required; prepaid, complimentary and approved partner-invoiced bookings are recognized automatically.

28. Every required adult signs the current digital waiver. The configured parent/guardian signs for minors. The system links each signature to the passenger, waiver version, booking, time and device context.

29. The system marks each passenger **Cleared to board** only when the required payment and waiver conditions are satisfied. An authorized exception requires a reason and immutable audit event.

30. Crew records boarded passengers and no-shows; offline events and signatures synchronize when connectivity returns.

31. Trip starts; delays, stops and incidents update operations.

32. Completion records final passenger/resource/usage data and triggers finance, review and maintenance events.

## 7.5 Cancellation and refund

33. User or channel requests cancellation.

34. Policy engine calculates eligible refund, fee, partner liability and capacity release.

35. Authorized user confirms or overrides with reason.

36. Refund is requested through the original gateway where possible.

37. Booking/capacity/channel state changes only through an idempotent workflow.

38. Customer/partner communication and accounting entries are produced.

# 8. Domain model

Use UUID/ULID identifiers, tenant_id on every tenant-owned row, UTC timestamps plus tenant timezone, soft deletion only where legally and operationally appropriate, optimistic concurrency, and append-only financial/audit events.

| **Domain**   | **Core entities**                                                                                    |
|--------------|------------------------------------------------------------------------------------------------------|
| Platform     | Tenant, Subscription, FeatureFlag, TenantDomain, TenantSetting                                       |
| Identity     | User, Role, Permission, Membership, SupportAccessGrant, Device                                       |
| Catalog      | Product, ProductOption, PassengerCategory, AddOn, Policy, Media                                      |
| Schedule     | ScheduleRule, Departure, Blackout, CapacityPool, InventoryHold, WaitlistEntry                        |
| Resources    | ResourceType, Resource, ResourcePool, RequirementRule, ResourceAssignment                            |
| People       | StaffProfile, Qualification, Availability, StaffAssignment                                           |
| Customer     | Customer, Passenger, ContactMethod, AccommodationStay, CustomerConsent                               |
| Booking      | Booking, BookingItem, PassengerAllocation, PickupSelection, BookingChange, Note, Task                |
| Partner      | PartnerOrganization, PartnerAgent, Contract, ContractRate, Allotment, CommissionRule                 |
| Finance      | Payment, PaymentTransaction, Refund, Invoice, InvoiceLine, CreditNote, CommissionAccrual, Settlement |
| Operations   | PickupLocation, Route, RouteStop, TripRun, TripEvent, CheckIn                                        |
| Documents    | WaiverTemplate, WaiverVersion, WaiverSignature, Ticket, Voucher, Attachment                          |
| Fleet/Safety | InspectionTemplate, Inspection, Defect, WorkOrder, FuelLog, Incident, AssetDocument                  |
| Integration  | ConnectorAccount, ExternalMapping, WebhookInbox, WebhookDelivery, SyncJob, ReconciliationIssue       |
| Governance   | AuditEvent, DataExport, RetentionRule, Notification, Message                                         |

## Key invariants

- Confirmed capacity cannot exceed configured capacity unless an authorized override event exists.

- A resource or staff member cannot have overlapping incompatible assignments.

- Booking totals equal priced items plus fees/tax less discounts; payments and refunds never rewrite those commercial facts.

- External events are processed exactly once logically, even when delivered more than once.

- Financial transactions, signed waivers, audit events and incident history are append-only; corrections use reversals or superseding versions.

- Tenant isolation is enforced in database access, cache keys, object storage paths, queues, logs and analytics.

- A completed trip cannot silently change partner commission; changes create an adjustment and approval trail.

## Booking status model

| **State**       | **Entry condition**                                 | **Typical next states**             |
|-----------------|-----------------------------------------------------|-------------------------------------|
| Draft           | Incomplete internal/reseller entry                  | Held, pending payment, cancelled    |
| Held            | Capacity reserved until expiry                      | Pending payment, confirmed, expired |
| Pending payment | Booking data valid; payment/credit approval pending | Confirmed, cancelled                |
| Confirmed       | Capacity committed                                  | Checked in, cancelled, no-show      |
| Checked in      | At least one/required passengers boarded            | In progress, no-show, cancelled     |
| In progress     | Departure started                                   | Completed, incident hold            |
| Completed       | Operational completion recorded                     | Financially closed, disputed        |
| Cancelled       | Cancellation recorded                               | Refund pending, closed              |
| No-show         | Guest failed to attend                              | Completed/closed, disputed          |

# 9. Architecture

> **Architecture choice**
>
> Start as a modular monolith with strict domain modules, a relational database and durable event/outbox processing. This is faster and safer for the first product than premature microservices, while preserving clean extraction boundaries.

## Recommended stack (adaptable to team standards)

| **Layer**                         | **Recommended baseline**                              | **Reason**                                                        |
|-----------------------------------|-------------------------------------------------------|-------------------------------------------------------------------|
| Cloud admin/reseller/customer web | Next.js + TypeScript + responsive PWA                 | Shared components, SEO/direct booking and strong agent tooling    |
| Staff mobile                      | React Native + Expo, SQLite encrypted offline store   | iOS/Android delivery, camera/QR/GPS/push and offline workflow     |
| API/backend                       | NestJS or equivalent TypeScript service               | Modular domain boundaries, validation and shared types            |
| Primary data                      | PostgreSQL with tenant-aware access patterns          | Transactions, constraints, reporting and mature geospatial option |
| Cache/locks                       | Redis                                                 | Rate limits, short holds, distributed locks and queues            |
| Async jobs                        | Durable queue + transactional outbox                  | Reliable channel sync, notifications and documents                |
| Files                             | S3-compatible object storage                          | Waivers, receipts, inspections, incidents and exports             |
| Search                            | Postgres search initially; external search later      | Avoid unnecessary infrastructure at launch                        |
| Observability                     | Structured logs, traces, metrics and error monitoring | Audit integrations, sync latency and field issues                 |
| Deployment                        | Containerized managed cloud; infrastructure as code   | Repeatability, backups and multi-environment controls             |

## Logical components

- API gateway/authentication

- Tenant and subscription module

- Catalog/pricing/availability engine

- Reservation/customer module

- Partner/reseller module

- Operations/dispatch module

- Finance ledger/invoicing module

- Fleet/safety module

- Document/waiver/ticket service

- Notification service

- Integration hub and reconciliation workbench

- Reporting read models

## Event examples

booking.held, booking.confirmed, booking.amended, booking.cancelled, payment.succeeded, payment.failed, waiver.signed, departure.capacity_changed, assignment.changed, trip.started, trip.completed, incident.created, commission.accrued, invoice.issued, connector.sync_failed.

## Offline synchronization

- Mobile downloads only assigned date windows and minimum passenger data.

- Local commands receive device-generated IDs and monotonic client timestamps.

- Server validates current version and returns accepted, rejected or conflict status.

- Field events such as check-in and trip status are append-oriented to reduce conflicts.

- Sensitive cached data is encrypted, expires after assignment window and is remotely revocable.

- Photos upload separately with resumable transfer; the event can sync before media completes.

# 10. Integration strategy

## 10.1 Integration hub pattern

- Canonical internal schemas for Product, Availability, Booking, Cancellation, Customer Question and Payment Ownership.

- Adapter per external system; raw payload retention with redaction and retention policy.

- Inbound webhook inbox with signature verification, deduplication, retry and quarantine.

- Outbound outbox with exponential backoff, rate-limit handling and dead-letter review.

- Mapping UI for external product/option/rate/pickup IDs.

- Reconciliation dashboard comparing channel bookings/cancellations/capacity with internal records.

## 10.2 Channel priorities

| **Priority** | **Connector**                              | **Approach**                                                                                        |
|--------------|--------------------------------------------|-----------------------------------------------------------------------------------------------------|
| P0           | Rock Adventures website / WP Travel Engine | Use its Webhooks & API add-on for transition; new direct widget/API becomes target system of record |
| P0           | Manual assisted channels                   | Fast reservation entry for WhatsApp, phone and walk-in; source attribution and payment link         |
| P0           | Hotel/agent/Island Routes                  | Native reseller portal plus CSV/email-assisted import during onboarding                             |
| P1           | Viator                                     | Apply as reservation-system provider; implement only after formal approval and contract testing     |
| P1           | GetYourGuide                               | Partner access required; build connector shell and mapping/reconciliation before credentials        |
| P1           | OCTO                                       | Publish/consume standard product, availability, booking and pickup interfaces                       |
| P2           | Other OTAs/channel managers                | Add by commercial demand through adapter framework                                                  |

> **Do not promise direct OTA integration dates yet**
>
> Viator documentation states access is restricted to registered operators and authorized reservation-system providers and requires technical evaluation. GetYourGuide likewise requires a partner account. The MVP must therefore support reliable manual/CSV/email reconciliation while approval is pursued.

## 10.3 Payments

Implement a gateway-neutral Payments interface: create payment session, authorize/capture, refund, retrieve, verify webhook, create payment link and reconcile settlement. Choose Rock Adventures’ launch gateway only after merchant jurisdiction, settlement bank, currencies, fees, 3-D Secure, card-present needs and API/webhook support are confirmed. The data model must support Stripe in eligible markets and Caribbean gateways such as Powertranz or bank-provided processors without changing booking logic.

## 10.4 Communications

Use provider adapters for email, SMS, WhatsApp Business and push. WhatsApp-assisted reservation entry should begin as a staff workflow with conversation/reference capture; a full bot should be added only after templates, consent, handoff and operational ownership are defined.

# 11. API and external contract

## API principles

- REST/JSON for primary public/admin API; OpenAPI generated and versioned.

- Idempotency-Key required for booking, payment, refund and channel mutation endpoints.

- Cursor pagination, filterable timestamps/status, tenant timezone and explicit currency minor units.

- ETag/version for concurrent edits; problem-details error format; correlation IDs.

- Signed webhooks with event ID, version, occurred_at and retry documentation.

- OCTO-compatible external connectivity façade separated from internal admin API.

## Representative endpoints

| **Area**     | **Endpoints**                                                                                   |
|--------------|-------------------------------------------------------------------------------------------------|
| Availability | GET /v1/products; GET /v1/availability; POST /v1/holds; DELETE /v1/holds/{id}                   |
| Bookings     | POST /v1/bookings; GET/PATCH /v1/bookings/{id}; POST /confirm; POST /cancel; POST /change-quote |
| Passengers   | POST/PATCH /bookings/{id}/passengers; POST /check-ins; POST /waiver-signatures                   |
| Operations   | GET /departures/{id}/manifest; POST /assignments; POST /trip-events; GET /dispatch-board        |
| Partners     | GET /partner/products; POST /partner/bookings; GET /partner/statements                          |
| Finance      | POST /payment-sessions; POST /check-in-payments; POST /refunds; GET /invoices; POST /settlements  |
| Fleet        | GET /resources; POST /inspections; POST /fuel-logs; POST /incidents; POST /work-orders          |
| Integrations | POST /webhooks/{connector}; GET /reconciliation-issues; POST /sync-jobs                         |

# 12. Security, privacy and reliability

- Tenant isolation tests are mandatory; platform support access uses time-limited grants and impersonation banners.

- MFA for tenant administrators, finance and platform users; secure device/session management.

- Encrypt data in transit and at rest; field-level protection for high-risk identifiers and incident/medical notes.

- Use hosted/tokenized payment components; keep raw card data outside Zettaz systems.

- Least-privilege cloud identities, secret manager, key rotation and separate production/non-production credentials.

- Signed webhooks, replay protection, allowlists where practical and full integration audit logs.

- Configurable retention/anonymization for customer, waiver, GPS and incident data; legal/insurance review by operating country.

- Automated backups, point-in-time restore, tested recovery procedure and tenant export capability.

- Target 99.9% monthly availability after stabilization; graceful degradation if OTA, messaging or payment providers fail.

- Security logging must avoid card data, waiver signatures, secrets and unnecessary passenger/medical information.

## Minimum operational controls

| **Control** | **Launch requirement**                                                                     |
|-------------|--------------------------------------------------------------------------------------------|
| RPO / RTO   | Target RPO \<= 15 minutes; RTO \<= 4 hours, then improve with usage                        |
| Audit       | Immutable trail for privileged, booking, finance, capacity, safety and integration actions |
| Backups     | Automated encrypted backups plus quarterly restore test                                    |
| Incidents   | Severity classification, alert routing and evidence preservation                           |
| Data export | Permissioned tenant export with logged requester and expiry                                |
| Release     | CI checks, migrations, feature flags, rollback and environment separation                  |

# 13. UX specification by surface

## Cloud operations dashboard

- Today header: departures, guests, unassigned resources/staff, unsigned waivers, unpaid balances, delays and incidents.

- Calendar/list with product, time, capacity, pickup cluster, asset and crew filters.

- Departure drawer with manifest, assignments, route, documents, money and event timeline.

- Quick actions that respect permissions: add booking, send payment/waiver link, assign, move, cancel and message.

- Exception-first design; avoid reproducing the spreadsheet as a giant editable grid.

## Reservation workspace

- Single fast flow for phone/WhatsApp/walk-in with availability and price visible together.

- Customer lookup and duplicate warning; lead traveler and passenger separation.

- Structured pickup/accommodation/channel/payment fields plus internal notes.

- Quote summary shows retail, discount, tax/fees, paid, balance, commission and collector.

- Save draft/hold, send payment link, confirm using credit terms or collect later according to policy.

## Reseller portal

- Branded login, contract-aware inventory/rates and agent permissions.

- New booking, quote/hold, voucher, amendments/cancellations and passenger/pickup completion.

- Bookings list with travel date, guest, status, amount, commission/net and invoice state.

- Statements/invoices, downloadable documents, dispute workflow and support messaging.

## Staff mobile

- One-tap Today view, large status actions and strong offline indicator.

- Privacy-minimized manifest and route grouped by pickup stop.

- Readiness checklist before Start; QR/manual check-in optimized for sun/glare and wet conditions.

- Incident/emergency action always reachable; accidental completion/cancellation protected.

- Sync queue and clear conflict/retry feedback.

## Customer booking and portal

- Mobile-first availability and checkout, transparent currency/fees and pickup eligibility.

- Guest checkout with optional account after confirmation.

- Manage passengers, waiver, balance, pickup and allowed reschedule/cancel actions.

- Accessible forms, saved progress and fast low-bandwidth pages.

- Confirmation as responsive web page plus email/WhatsApp link; PDF only when needed.

# 14. Reporting definitions

| **Metric**           | **Definition**                                                                               |
|----------------------|----------------------------------------------------------------------------------------------|
| Gross booking value  | Sum of booking item prices, fees and tax before refunds; report by booking and travel date   |
| Collected            | Successful captured transactions less successful refunds in reporting period                 |
| Outstanding balance  | Booking amount due minus settled/cleared payments and credits                                |
| Commission expense   | Accrued partner commission according to contract trigger, including adjustments              |
| Net operator revenue | Gross value less discounts, refunds, commission and taxes/fees excluded by accounting policy |
| Load factor          | Confirmed/check-in passengers divided by sellable passenger capacity                         |
| Resource utilization | Assigned operating duration or trips divided by available duration/capacity                  |
| No-show rate         | No-show passengers/bookings divided by confirmed due-to-travel population                    |
| Channel sync health  | Successful freshness within SLA; errors, backlog age and reconciliation mismatches           |

Finance must approve final accounting definitions, tax treatment, exchange-rate source and whether reporting recognizes on booking, payment or completion. The platform should display each basis explicitly rather than one ambiguous Revenue number.

# 15. Delivery roadmap

| **Phase**                                                | **Indicative scope**                                                                                                              | **Exit criteria**                                                              |
|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| 0 - Discovery & foundation (2-3 weeks)                   | Workflow interviews, asset/route/product inventory, payment/gateway decision, data cleanup, tenant architecture and design system | Signed configuration workbook, integration access plan and prioritized backlog |
| 1 - Core reservations (6-8 weeks)                        | Tenant/auth, catalog, departures, availability, manual/direct bookings, customers, basic payments, notifications and import       | Rock Adventures can stop creating new daily spreadsheet sheets                 |
| 2 - Operations & mobile (6-8 weeks)                      | Assignments, dispatch, pickup routes, manifest, offline crew app, check-in, waivers and live trip events                          | A full operating week runs from system with rollback procedure                 |
| 3 - Reseller & finance (5-7 weeks)                       | Contracts/rates, portal, allocations, commission, invoices, statements, payment reconciliation                                    | Major hotel/Island Routes workflows processed end to end                       |
| 4 - Fleet & safety (4-6 weeks)                           | Inspections, maintenance, fuel, documents, incidents and utilization reporting                                                    | All active assets and mandatory checks tracked                                 |
| 5 - OTA/OCTO connectivity (parallel, approval dependent) | WP Travel Engine bridge, OCTO API, Viator/GetYourGuide certification/connectors and reconciliation                                | Approved channels pass contract tests and production monitoring                |
| 6 - Productization (4-6 weeks)                           | Self-serve tenant setup, white label, plans/features, onboarding/import, support and billing                                      | Second operator onboarded without a code fork                                  |

## Recommended launch sequence

Do not wait for direct OTA certification to replace the spreadsheet. Launch the canonical reservation and operations system first, with assisted channel import/reconciliation. Run a short parallel period, then make the platform the operational source of truth while connectors are certified.

# 16. Migration and rollout

35. Create controlled dictionaries for products, hotels/ships, pickup points, booking sources, payment states and partners.

36. Parse historical sheets into staging; never import spreadsheet comments directly into financial truth.

37. Flag ambiguous amounts, room numbers, phone numbers, duplicate guests and inconsistent passenger formulas for review.

38. Import useful future bookings first; historical data can follow as read-only/archive records.

39. Reconcile each imported future day against original manifest totals and channel vouchers.

40. Train reservations, dispatch, finance, crew and partners with role-specific scenarios.

41. Parallel-run for 7-14 operating days with a named go/no-go owner and rollback plan.

42. Freeze spreadsheet entry after cutover; retain the file as evidence and import reference.

## Migration acceptance checks

- Every future booking has a date/time, product, party size, source, status and pickup disposition.

- Daily totals reconcile or have documented exceptions.

- Paid/balance/invoice ownership is reviewed manually for every future booking.

- Partner/channel references are preserved.

- No asset/staff assignment conflicts exist for launch window.

- Customer communications are not sent during dry-run imports.

# 17. Testing and acceptance

## Test layers

- Unit tests for pricing, policy, commission, capacity and status transitions.

- Database integration tests for tenant isolation, locking and financial invariants.

- Contract tests for every connector and webhook signature/retry behavior.

- End-to-end tests for direct, manual, reseller and channel booking journeys.

- Offline/mobile tests for airplane mode, stale records, duplicate sync and interrupted media uploads.

- Load tests for simultaneous availability/holds and peak channel updates.

- Security tests for IDOR, privilege escalation, tenant leakage, webhook replay and export access.

- Migration reconciliation tests using anonymized workbook samples.

## Launch-blocking acceptance criteria

- No known path can double-confirm the same constrained capacity.

- Duplicate webhooks cannot create duplicate bookings, refunds or commissions.

- Crew can open assigned manifest and record check-ins offline.

- At check-in, staff can see the exact balance due, collect or record an allowed payment, and receive immediate confirmation that the booking balance is settled.

- Every required guest can sign the correct digital waiver on a customer or staff device, including a guardian workflow for minors.

- The system cannot mark a passenger cleared to board with an unpaid required balance or unsigned required waiver unless a specifically authorized, reasoned and audited exception is recorded.

- Offline check-in safely queues passenger status and waiver evidence without duplicating signatures or payments when synchronization retries.

- Finance can explain each booking amount, collected amount, balance, commission and invoice state.

- A cancelled/amended booking updates inventory and creates appropriate channel/reconciliation actions.

- A resource with an open critical defect cannot be assigned without authorized override.

- Every privileged or financial change identifies actor, time, tenant, before/after and reason.

# 18. Commercial productization

## Working product name

Use “Zettaz Tours & Charters” as a working name until brand and trademark screening. Architect branding as tenant configuration so Rock Adventures uses its own logo, colors, domains, email identity and customer-facing terminology.

## Suggested packaging

| **Edition** | **Best for**                               | **Modules**                                                                             |
|-------------|--------------------------------------------|-----------------------------------------------------------------------------------------|
| Essentials  | Small tour operators                       | Direct/manual booking, calendar, payments, manifest and basic reports                   |
| Operations  | Operators with vehicles, vessels and crews | Essentials plus dispatch, routes, staff mobile, waivers and resource management         |
| Growth      | Multi-channel/reseller businesses          | Operations plus reseller portal, commissions, invoicing and channel connectors          |
| Enterprise  | Multi-location/high-volume operators       | Advanced permissions, SLA, SSO, custom integrations, data warehouse and premium support |

Preserve Zettaz’s preference for value-based subscription pricing rather than revenue-share pricing. Charge separately for high-cost messaging, premium connectors, additional locations or unusually heavy support where appropriate. Validate competitive and Caribbean willingness-to-pay before publishing prices.

# 19. Decisions and discovery still required

| **Decision**                                                 | **Why it matters**                                              | **Owner / evidence**            |
|--------------------------------------------------------------|-----------------------------------------------------------------|---------------------------------|
| Current asset and staff inventory                            | Defines resource pools, capacity and maintenance setup          | Rock Adventures operations      |
| Exact products/options/prices/schedules                      | Configures catalog and migration mapping                        | Reservations + website          |
| Pickup rules and standard routes                             | Shapes dispatch, timing and paid pickup logic                   | Operations/driver interviews    |
| Reseller contracts and settlement models                     | Determines net/commission/invoice calculations                  | Owner + finance + contracts     |
| Launch payment gateway and merchant bank                     | Determines checkout, settlement, refunds and card-present scope | Owner + bank/gateway            |
| Viator/GetYourGuide supplier accounts and technical approval | Controls connector timeline and credentials                     | Owner + Zettaz integration lead |
| Waiver/retention/legal wording                               | Safety evidence and privacy retention                           | Insurer/legal advisor           |
| Accounting system and chart mapping                          | Defines exports, tax and recognition                            | Finance/accountant              |
| Mobile device mix and connectivity                           | Offline testing and deployment approach                         | Crew survey                     |
| GPS tracking policy and consent                              | Privacy, battery and operational value                          | Owner/legal/crew                |

# 20. AI coding-agent master prompt

> **How to use this**
>
> Provide this blueprint to the coding agent as the authoritative product context. Use the prompt below to start repository planning. Then implement one bounded epic at a time; require migrations, tests, documentation and acceptance evidence for every epic.

```text
You are the lead product engineer for “Zettaz Tours & Charters,” a multi-tenant SaaS platform for tour, charter, excursion and transport operators. Rock Adventures Antigua is the launch tenant, but no domain rule, label, product, channel, price, route, payment method or partner agreement may be hard-coded for that tenant.

Read the attached Product & Engineering Blueprint completely before proposing code. Treat it as the source of truth. First inspect the existing repository, AGENTS.md and established architecture. Do not replace working conventions without evidence.

Primary product surfaces:
1. Cloud admin and operations dashboard.
2. Staff mobile app with encrypted offline data and conflict-aware sync.
3. Reseller/agent portal with contract rates, allotments, commission and invoicing.
4. Customer booking and self-service portal.
5. Integration hub for website, OTA, reseller, payment and communication adapters.

Non-negotiable engineering rules:
- Multi-tenant isolation in database queries, storage, queues, caches, logs and tests.
- Modular domain boundaries: identity/tenant, catalog, availability, booking/customer, partner, finance, operations, fleet/safety, documents, notifications, integrations and reporting.
- Use a modular monolith initially; communicate between modules through explicit services/events and a transactional outbox.
- PostgreSQL is the system of record. Store currency as integer minor units plus ISO currency. Store UTC timestamps plus tenant timezone.
- Booking/payment/refund/channel writes are idempotent. Webhooks are signed, deduplicated, retried and quarantined on repeated failure.
- Financial events, signed waivers, incidents and audit history are append-only or versioned; corrections use reversals/superseding records.
- Capacity must account for passengers and constrained resources. Prevent overbooking and overlapping incompatible resource/staff assignments at the database/service boundary.
- Check-in must show the authoritative balance and waiver status, support collection of an allowed balance payment, capture required guest/guardian digital signatures, and prevent boarding clearance until both requirements are satisfied or an authorized audited exception exists.
- Mobile field commands must tolerate offline use, retries, stale state and media uploads that complete later.
- Never store raw card data. Minimize passenger data exposed to crew and cached on devices.
- Direct Viator/GetYourGuide integration is approval dependent. Build adapter interfaces, mapping and reconciliation without pretending credentials or certification exist. Provide assisted import/reconciliation until approved.
- Expose an OCTO-compatible connectivity façade without coupling the internal domain to external schemas.

For the first response, do not write application code. Produce:
A. Repository assessment and gaps.
B. Proposed module/package structure.
C. Architecture Decision Records needed.
D. Database schema plan with key constraints and indexes.
E. Event catalog and idempotency strategy.
F. API surface and authentication model.
G. Offline sync strategy.
H. Security/threat-model checklist.
I. Phased backlog of epics and vertical slices.
J. Exact first vertical slice, acceptance criteria and test plan.

The preferred first vertical slice is: create tenant -> configure a shared tour product and recurring departure -> query availability -> create a short inventory hold -> create a manual reservation -> record an offline/manual payment state -> confirm booking -> show it on the departure manifest -> audit every mutation. It must include migrations, API validation, permissions, concurrency tests, tenant-isolation tests and developer documentation.

Before implementing any slice, state assumptions and unresolved decisions. Use feature flags for unfinished external integrations. Keep generated code production-oriented, typed, tested, observable and migration-safe. Do not create placeholder business logic that silently becomes authoritative.
```

# 21. Initial epic backlog

| **Epic**                | **Core deliverable**                                                     | **Depends on**    |
|-------------------------|--------------------------------------------------------------------------|-------------------|
| E01 Tenant & identity   | Tenant provisioning, memberships, RBAC, audit and support access         | Foundation        |
| E02 Catalog             | Products, options, passenger categories, schedules, policies and pricing | E01               |
| E03 Availability        | Capacity pools, resources, holds, concurrency and waitlist base          | E02               |
| E04 Reservations        | Customer/passenger, manual booking, changes, cancellation and timeline   | E03               |
| E05 Direct checkout     | Booking UI, payment session, confirmation, portal and notifications      | E04               |
| E06 Operations          | Departure board, manifest, assignments, pickup route and readiness       | E04               |
| E07 Crew mobile         | Offline assigned trips, inspection, check-in, status and sync            | E06               |
| E08 Waivers/tickets     | Templates, signatures, QR and document evidence                          | E04/E07           |
| E09 Reseller            | Partners, contracts, rates, allotments, agent portal and vouchers        | E03/E04           |
| E10 Finance             | Ledger, balances, refunds, commissions, invoices and settlement          | E04/E09           |
| E11 Fleet/safety        | Assets, documents, maintenance, fuel, defects and incidents              | E06/E07           |
| E12 Integration hub     | Webhooks, adapters, mappings, sync jobs and reconciliation               | E03/E04           |
| E13 WP bridge           | WP Travel Engine webhooks/API transition                                 | E12               |
| E14 OCTO/OTA            | OCTO façade and approved OTA connectors                                  | E12 + approvals   |
| E15 Reporting           | Operational, sales, finance, channel and asset read models               | All domain events |
| E16 SaaS productization | Plans/features, onboarding, white label and second-tenant readiness      | Stable core       |

# 22. Sources and research notes

Official sources consulted (accessed September 2026):

- **Rock Adventures Antigua - homepage and product navigation:** https://www.rockadventuresantigua.com/homepage-update-design/

- **Rock Adventures Antigua - trip search and public product/pricing display:** https://www.rockadventuresantigua.com/trip-search-result/

- **WP Travel Engine - Webhooks and API:** https://docs.wptravelengine.com/article/webhooks-and-api/

- **Viator Reservation System API - technical documentation:** https://docs.viator.com/supplier-api/technical/

- **GetYourGuide API:** https://api.getyourguide.com/

- **OCTO open connectivity specification:** https://octo.travel/specification

- **FareHarbor official product overview:** https://fareharbor.com/

- **Bókun official product/channel manager overview:** https://www.bokun.io/

- **Rezdy booking software and resource management:** https://rezdy.com/booking-software/

- **Checkfront tour booking software:** https://www.checkfront.com/industries/tours/

- **Peek Pro official platform overview:** https://www.peekpro.com/

- **Ventrata official sightseeing and resource management:** https://ventrata.com/market/tours

- **Zaui official tour and transport platform:** https://www.zaui.com/

*Product claims and integration availability must be revalidated during implementation and commercial discussions. Competitor marketing pages describe capabilities, not guaranteed API access or fit for Rock Adventures. Pricing was intentionally excluded unless reliably public and decision-relevant.*
